// Work Monitor: work sessions from the desktop app, screenshots on the server's disk, live screen view.
// Only people with the "Work Monitor admin" duty (and super admins) can see any of it.
import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { mkdir, writeFile, unlink, rm, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";

export type MonitorRules = {
  /** Screenshot every minMin..maxMin minutes, at a random moment. */
  minMin: number;
  maxMin: number;
  /** No mouse or keyboard for this many minutes = idle. */
  idleMin: number;
  /** Delete screenshots older than this many days (0 = keep until deleted by hand). */
  keepDays: number;
  /** Admins may open a live view of a working person's screen. */
  live: boolean;
};

export const DEFAULT_RULES: MonitorRules = { minMin: 5, maxMin: 10, idleMin: 5, keepDays: 30, live: true };

export async function getMonitorRules(): Promise<MonitorRules> {
  const v = (await prisma.setting.findUnique({ where: { key: "monitor" } }))?.value as Partial<MonitorRules> | undefined;
  return { ...DEFAULT_RULES, ...(v ?? {}) };
}
export async function saveMonitorRules(r: MonitorRules) {
  await prisma.setting.upsert({ where: { key: "monitor" }, update: { value: r as never }, create: { key: "monitor", value: r as never } });
}

/** Where screenshots live on the server. Docker mounts a volume here. */
export const SHOTS_DIR = process.env.SHOTS_DIR || path.join(process.cwd(), ".shots");

export function shotPath(file: string) {
  const full = path.resolve(SHOTS_DIR, file);
  if (!full.startsWith(path.resolve(SHOTS_DIR) + path.sep)) throw new Error("bad path");
  return full;
}

export async function saveShotFile(file: string, buf: Buffer) {
  const full = shotPath(file);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf);
}

// ---------- desktop app token ----------
// The desktop app gets its own token from the logged-in web page, so it can send screenshots
// without the browser cookie. It only opens the /api/monitor/agent door.

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return new TextEncoder().encode(s);
}

export async function agentToken(userId: string) {
  return new SignJWT({ sub: userId, typ: "desk" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("60d")
    .sign(secret());
}

export async function agentUser(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!tok) return null;
  try {
    const { payload } = await jwtVerify(tok, secret());
    if (payload.typ !== "desk" || !payload.sub) return null;
    const u = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, name: true, active: true } });
    return u?.active ? u : null;
  } catch {
    return null;
  }
}

// ---------- sessions ----------

/** The app reports at least every minute; after this much silence the session counts as ended. */
export const SILENT_MS = 5 * 60_000;

/** Close sessions whose app went silent (PC turned off, internet gone, app killed). */
export async function closeSilentSessions() {
  const cut = new Date(Date.now() - SILENT_MS);
  const open = await prisma.workSession.findMany({ where: { endedAt: null, lastBeatAt: { lt: cut } }, select: { id: true, lastBeatAt: true } });
  for (const s of open) {
    await prisma.workSession.update({ where: { id: s.id }, data: { endedAt: s.lastBeatAt, endReason: "silent" } });
  }
}

export async function openSession(userId: string) {
  return prisma.workSession.findFirst({ where: { userId, endedAt: null, lastBeatAt: { gte: new Date(Date.now() - SILENT_MS) } }, orderBy: { startedAt: "desc" } });
}

// ---------- live view ----------
// Kept in memory only (one server). Frames are never saved to disk.

type Frame = { buf: Buffer; at: number };
const g = globalThis as unknown as { __cmaLive?: { want: Map<string, number>; frames: Map<string, Frame> } };
const live = (g.__cmaLive ??= { want: new Map(), frames: new Map() });

/** An admin's live page asks for frames; the request lasts 20 seconds and is renewed while the page is open. */
export function wantLive(userId: string) {
  live.want.set(userId, Date.now());
}
export function liveWanted(userId: string) {
  const t = live.want.get(userId);
  return !!t && Date.now() - t < 20_000;
}
export function stopLive(userId: string) {
  live.want.delete(userId);
  live.frames.delete(userId);
}
export function putFrame(userId: string, buf: Buffer) {
  live.frames.set(userId, { buf, at: Date.now() });
}
export function getFrame(userId: string) {
  const f = live.frames.get(userId);
  return f && Date.now() - f.at < 15_000 ? f : null;
}

// ---------- storage ----------

export async function deleteShots(where: { userId?: string; from?: Date; to?: Date }) {
  const takenAt: { gte?: Date; lt?: Date } = {};
  if (where.from) takenAt.gte = where.from;
  if (where.to) takenAt.lt = where.to;
  const filter = { ...(where.userId ? { userId: where.userId } : {}), ...(where.from || where.to ? { takenAt } : {}) };
  let n = 0;
  let bytes = 0;
  // In batches, so a big delete does not hold everything in memory.
  for (;;) {
    const rows = await prisma.screenshot.findMany({ where: filter, select: { id: true, file: true, bytes: true }, take: 500 });
    if (!rows.length) break;
    for (const r of rows) {
      await unlink(shotPath(r.file)).catch(() => {});
      bytes += r.bytes;
    }
    await prisma.screenshot.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    n += rows.length;
  }
  await pruneEmptyDirs();
  return { n, bytes };
}

async function pruneEmptyDirs() {
  const root = path.resolve(SHOTS_DIR);
  const walk = async (dir: string): Promise<boolean> => {
    let names: string[];
    try { names = await readdir(dir); } catch { return false; }
    let empty = true;
    for (const name of names) {
      const p = path.join(dir, name);
      const st = await stat(p).catch(() => null);
      if (st?.isDirectory()) { if (!(await walk(p))) empty = false; } else empty = false;
    }
    if (empty && dir !== root) await rm(dir, { recursive: true }).catch(() => {});
    return empty;
  };
  await walk(root);
}

let lastAuto = 0;
/** Auto-delete old screenshots, at most once an hour (called when screenshots arrive). */
export async function autoDelete() {
  if (Date.now() - lastAuto < 60 * 60_000) return;
  lastAuto = Date.now();
  const r = await getMonitorRules();
  if (r.keepDays > 0) await deleteShots({ to: new Date(Date.now() - r.keepDays * 86_400_000) });
  // Activity rows are small, but keep them no longer than a year.
  await prisma.activitySample.deleteMany({ where: { at: { lt: new Date(Date.now() - 365 * 86_400_000) } } });
}

export function mb(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
export function dur(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
