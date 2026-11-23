// Live location + selfie attendance.
//
// Live location is the open, Play-Store-compliant kind:
//  - only from the CMA Office Android app, only while the person is CHECKED IN
//    (it stops at check out, or some time after their office end if they forget),
//  - the phone shows a notification the whole time ("sharing your location"),
//  - the person agrees on a full-screen notice first, and can turn it off; the admin then sees "turned off",
//  - only Attendance admins (CEO + HR) see the map and the history; old points are deleted after `keepDays`.
import path from "node:path";
import { unlink } from "node:fs/promises";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./db";
import { todayDhaka } from "./format";
import { getAttRules, dhakaMinutes, timeFor, AttError, type AttRules } from "./attendance";
import { saveShotFile, shotPath } from "./monitor";

export type TrackRules = { on: boolean; who: "all" | "some"; people: string[]; everyMin: number; afterEndMin: number; keepDays: number };
export const DEFAULT_TRACK: TrackRules = { on: false, who: "all", people: [], everyMin: 5, afterEndMin: 120, keepDays: 60 };
export const trackRules = (r: AttRules): TrackRules => ({ ...DEFAULT_TRACK, ...(r.track ?? {}) });
export const tracksUser = (t: TrackRules, userId: string) => t.on && (t.who === "all" || t.people.includes(userId));

/** "in" = selfie at check in, "inout" = at check in and check out. Field staff always take one. */
export function selfieFor(r: AttRules, userId: string): { in: boolean; out: boolean; field: boolean } {
  const field = (r.field ?? []).includes(userId);
  const mode = r.selfie ?? "off";
  return { in: field || mode !== "off", out: field || mode === "inout", field };
}

const mins = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };

/** Should this person's phone be sending its location right now? */
export async function trackNow(userId: string, rules?: AttRules): Promise<{ ok: true; everyMin: number } | { ok: false; why: string }> {
  const r = rules ?? (await getAttRules());
  const t = trackRules(r);
  if (!tracksUser(t, userId)) return { ok: false, why: "Live location is off for this person" };
  const [att, st] = await Promise.all([
    prisma.attendance.findUnique({ where: { userId_date: { userId, date: todayDhaka() } }, select: { checkIn: true, checkOut: true, status: true } }),
    prisma.locationStatus.findUnique({ where: { userId }, select: { consentAt: true, declinedAt: true } }),
  ]);
  if (!att?.checkIn || att.status !== "PRESENT") return { ok: false, why: "Not checked in" };
  if (att.checkOut) return { ok: false, why: "Checked out" };
  if (st?.declinedAt && (!st.consentAt || st.declinedAt > st.consentAt)) return { ok: false, why: "Turned off by the person" };
  const pt = timeFor(r, userId);
  // Forgot to check out: stop some time after the office end (not for night shifts that end after midnight).
  if (mins(pt.end) > mins(pt.start) && dhakaMinutes(new Date()) > mins(pt.end) + t.afterEndMin) return { ok: false, why: "Office time is over" };
  return { ok: true, everyMin: t.everyMin };
}

// ---------- phone token ----------
// The page inside the app hands the phone a token, so the phone can send points in the background
// without the browser cookie. It only opens /api/location.
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return new TextEncoder().encode(s);
}
export async function locToken(userId: string) {
  return new SignJWT({ sub: userId, typ: "loc" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2d").sign(secret());
}
export async function locUserId(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!tok) return null;
  try {
    const { payload } = await jwtVerify(tok, secret());
    if (payload.typ !== "loc" || !payload.sub) return null;
    const u = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, active: true } });
    return u?.active ? u.id : null;
  } catch {
    return null;
  }
}

/** What the page tells the phone: start sending (with a token) or stop. */
export async function trackOrder(userId: string, rules?: AttRules) {
  const t = await trackNow(userId, rules);
  return t.ok ? { on: true as const, token: await locToken(userId), everyMin: t.everyMin } : { on: false as const, why: t.why };
}

export async function setSharing(userId: string, how: "agreed" | "declined" | "stopped", note?: string) {
  const now = new Date();
  const data =
    how === "agreed" ? { consentAt: now, sharing: true, note: null }
      : how === "declined" ? { declinedAt: now, sharing: false, note: note ?? "Did not agree to share location" }
      : { sharing: false, note: note ?? null };
  await prisma.locationStatus.upsert({ where: { userId }, update: data, create: { userId, ...data } });
}

type Pt = { at?: unknown; lat?: unknown; lng?: unknown; acc?: unknown };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Save the points one phone sent. Points closer than 20 seconds apart are skipped. */
export async function savePoints(userId: string, raw: Pt[]) {
  const now = Date.now();
  const pts = raw.slice(0, 200).map((p) => {
    const lat = num(p.lat), lng = num(p.lng);
    const at = new Date(typeof p.at === "number" || typeof p.at === "string" ? p.at : now);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
    if (isNaN(at.getTime()) || at.getTime() > now + 5 * 60_000 || at.getTime() < now - 24 * 3600_000) return null;
    const acc = num(p.acc);
    return { userId, at, lat, lng, acc: acc != null ? Math.round(acc) : null };
  }).filter((p): p is NonNullable<typeof p> => !!p).sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!pts.length) return 0;
  const last = await prisma.locationPoint.findFirst({ where: { userId }, orderBy: { at: "desc" }, select: { at: true } });
  let prev = last?.at.getTime() ?? 0;
  const keep = pts.filter((p) => { if (p.at.getTime() - prev < 20_000) return false; prev = p.at.getTime(); return true; });
  if (keep.length) await prisma.locationPoint.createMany({ data: keep });
  const newest = pts[pts.length - 1];
  await prisma.locationStatus.upsert({
    where: { userId },
    update: { sharing: true, lastAt: newest.at, lat: newest.lat, lng: newest.lng, acc: newest.acc, note: null },
    create: { userId, sharing: true, lastAt: newest.at, lat: newest.lat, lng: newest.lng, acc: newest.acc },
  });
  return keep.length;
}

// ---------- selfies ----------
const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** A selfie from the app ("data:image/jpeg;base64,...") saved as a file; returns its name. */
export async function saveSelfie(userId: string, dataUrl: unknown, kind: "in" | "out") {
  const m = typeof dataUrl === "string" ? /^data:image\/jpe?g;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl) : null;
  const buf = m ? Buffer.from(m[1], "base64") : null;
  if (!buf || !isJpeg(buf)) throw new AttError("The selfie did not come through. Take it again.");
  if (buf.length > 3 * 1024 * 1024) throw new AttError("The selfie is too big. Update the CMA Office app and try again.");
  const d = new Date();
  const file = path.posix.join("selfies", d.toISOString().slice(0, 7), `${userId}-${kind}-${d.getTime()}.jpg`);
  await saveShotFile(file, buf);
  return file;
}

// ---------- clean up ----------
let lastClean = 0;
/** Delete points older than keepDays (at most once an hour). Selfies stay with the attendance record. */
export async function cleanOldPoints() {
  if (Date.now() - lastClean < 3600_000) return;
  lastClean = Date.now();
  const t = trackRules(await getAttRules());
  await prisma.locationPoint.deleteMany({ where: { at: { lt: new Date(Date.now() - Math.max(1, t.keepDays) * 86400_000) } } });
}

export async function deleteSelfieFile(file: string | null | undefined) {
  if (!file) return;
  try { await unlink(shotPath(file)); } catch { /* already gone */ }
}

/** Metres between two points (for the history list). */
export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, toR = (x: number) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
