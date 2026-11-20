// The door the CMA Office desktop app uses (Bearer token from /api/monitor/token).
//   device  register this computer + report last-online and area (runs even when not working)
//   start   Start work: opens a work session, answers the screenshot rules
//   beat    every minute: activity (app in front, idle) + "is an admin watching live?"
//   ping    every few seconds: only "is an admin watching live?"
//   shot    one compressed screenshot (JPEG)
//   frame   one live-view picture (kept in memory only, while an admin watches)
//   stop    Stop work (or PC locked / app closed)
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import {
  agentUser, getMonitorRules, openSession, closeSilentSessions, saveShotFile, autoDelete,
  liveWanted, putFrame, stopLive, SILENT_MS,
} from "@/lib/monitor";
import { clientIp, recordDevice } from "@/lib/device";

export const dynamic = "force-dynamic";

const MAX_SHOT = 2 * 1024 * 1024;
const MAX_FRAME = 1024 * 1024;
const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

type Sample = { at?: string; app?: string; title?: string; idle?: boolean };

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;

  // ping is called often: check the token only, no database.
  if (action === "ping") {
    const id = await tokenUserId(req);
    if (!id) return bad("Log in again in the CMA Office app.", 401);
    const rules = await getMonitorRules();
    return NextResponse.json({ live: rules.live && liveWanted(id) });
  }

  const u = await agentUser(req);
  if (!u) return bad("Log in again in the CMA Office app.", 401);
  const rules = await getMonitorRules();

  // Device report: the desktop app registers itself and its last-online + area,
  // whether or not a work session is running. Disclosed IT asset tracking.
  if (action === "device") {
    const b = (await req.json().catch(() => ({}))) as {
      deviceId?: string; machineName?: string; platform?: string; osVersion?: string; appVersion?: string; reportedIp?: string;
    };
    const deviceId = clip(b.deviceId, 100);
    if (!deviceId) return bad("No device id");
    // Prefer the IP the proxy forwarded (trusted). In direct mode there is no
    // proxy header, so fall back to the IP the app reports about itself.
    const ip = clientIp(req) ?? clip(b.reportedIp, 60);
    await recordDevice({
      deviceId,
      userId: u.id,
      machineName: clip(b.machineName, 100),
      platform: clip(b.platform, 40),
      osVersion: clip(b.osVersion, 80),
      appVersion: clip(b.appVersion, 40),
      ip,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "start") {
    const body = (await req.json().catch(() => ({}))) as { device?: string };
    await prisma.workSession.updateMany({ where: { userId: u.id, endedAt: null }, data: { endedAt: new Date(), endReason: "restart" } });
    const s = await prisma.workSession.create({ data: { userId: u.id, device: clip(body.device, 80) } });
    await closeSilentSessions();
    return NextResponse.json({ sessionId: s.id, startedAt: s.startedAt, rules });
  }

  if (action === "shot") {
    const form = await req.formData().catch(() => null);
    if (!form) return bad("Expected a form");
    const sessionId = String(form.get("sessionId") ?? "");
    const s = await liveSession(u.id, sessionId);
    if (!s) return NextResponse.json({ ended: true });
    const file = form.get("image");
    if (!(file instanceof Blob) || file.size > MAX_SHOT) return bad("No picture, or the picture is too big");
    const buf = Buffer.from(await file.arrayBuffer());
    if (!isJpeg(buf)) return bad("Only JPEG pictures");
    const takenAt = new Date(String(form.get("takenAt") ?? ""));
    const at = isNaN(takenAt.getTime()) || Math.abs(Date.now() - takenAt.getTime()) > 10 * 60_000 ? new Date() : takenAt;
    const row = await prisma.screenshot.create({
      data: {
        sessionId: s.id, userId: u.id, takenAt: at, file: "pending", bytes: buf.length,
        screen: Math.max(0, Math.min(9, Number(form.get("screen")) || 0)),
        app: clip(form.get("app"), 80), title: clip(form.get("title"), 200),
      },
    });
    const name = `${at.toISOString().slice(0, 10)}/${u.id}/${row.id}.jpg`;
    try {
      await saveShotFile(name, buf);
    } catch (e) {
      await prisma.screenshot.delete({ where: { id: row.id } });
      return bad("Could not save the picture on the server: " + (e as Error).message, 500);
    }
    await prisma.screenshot.update({ where: { id: row.id }, data: { file: name } });
    await prisma.workSession.update({ where: { id: s.id }, data: { lastBeatAt: new Date() } });
    autoDelete().catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "frame") {
    const sessionId = req.headers.get("x-session") ?? "";
    if (!rules.live || !liveWanted(u.id)) return NextResponse.json({ live: false });
    const s = await liveSession(u.id, sessionId);
    if (!s) return NextResponse.json({ live: false, ended: true });
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length > MAX_FRAME || !isJpeg(buf)) return bad("Bad frame");
    putFrame(u.id, buf);
    return NextResponse.json({ live: true });
  }

  const body = (await req.json().catch(() => ({}))) as { sessionId?: string; samples?: Sample[]; activeSec?: number; idleSec?: number; reason?: string };

  if (action === "beat") {
    const s = await liveSession(u.id, body.sessionId ?? "");
    if (!s) return NextResponse.json({ ended: true, rules });
    const samples = (Array.isArray(body.samples) ? body.samples : []).slice(0, 120).map((x) => {
      const at = new Date(x.at ?? "");
      return { sessionId: s.id, userId: u.id, at: isNaN(at.getTime()) ? new Date() : at, app: clip(x.app, 80), title: clip(x.title, 200), idle: !!x.idle };
    });
    const sec = (n: unknown) => Math.max(0, Math.min(3600, Math.round(Number(n) || 0)));
    await prisma.$transaction([
      ...(samples.length ? [prisma.activitySample.createMany({ data: samples })] : []),
      prisma.workSession.update({
        where: { id: s.id },
        data: { lastBeatAt: new Date(), activeSec: { increment: sec(body.activeSec) }, idleSec: { increment: sec(body.idleSec) } },
      }),
    ]);
    return NextResponse.json({ ok: true, live: rules.live && liveWanted(u.id), rules });
  }

  if (action === "stop") {
    const reason = ["stop", "lock", "quit", "logout"].includes(body.reason ?? "") ? body.reason! : "stop";
    await prisma.workSession.updateMany({ where: { userId: u.id, endedAt: null }, data: { endedAt: new Date(), endReason: reason } });
    stopLive(u.id);
    return NextResponse.json({ ok: true });
  }

  return bad("Unknown action", 404);
}

/** The person's open session with this id, if the app has not been silent too long. */
async function liveSession(userId: string, id: string) {
  if (!id) return null;
  const s = await openSession(userId);
  if (!s || s.id !== id) return null;
  return Date.now() - s.lastBeatAt.getTime() < SILENT_MS ? s : null;
}

async function tokenUserId(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  const s = process.env.SESSION_SECRET;
  if (!tok || !s) return null;
  try {
    const { payload } = await jwtVerify(tok, new TextEncoder().encode(s));
    return payload.typ === "desk" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
