// Attendance rules and check-in. The office is recognised by the router's MAC ID (BSSID),
// not by the WiFi name, because a name can be copied. Only the mobile app can read the MAC.
import { prisma } from "./db";
import { todayDhaka } from "./format";
import { saveSelfie, selfieFor, type TrackRules } from "./location";

export type OfficeWifi = { bssid: string; ssid: string; addedAt: string };
export type PersonTime = { start: string; end: string; graceMin: number; weeklyOff: number[] };
/** `people` holds the office time of anyone whose time differs from the default (shift, 6-hour, own off day). */
/** selfie: off / at check in / at check in and out. field: people who may check in away from the office WiFi
 *  (with a selfie + the phone's GPS). track: live location while checked in (see lib/location.ts). */
export type AttRules = PersonTime & {
  wifi: OfficeWifi[]; people: Record<string, PersonTime>;
  selfie?: "off" | "in" | "inout"; field?: string[]; track?: Partial<TrackRules>;
};
export const DEFAULT_RULES: AttRules = { start: "09:00", end: "18:00", graceMin: 15, weeklyOff: [5], wifi: [], people: {}, selfie: "off", field: [] };
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export class AttError extends Error {}

export async function getAttRules(): Promise<AttRules> {
  const s = await prisma.setting.findUnique({ where: { key: "attendance" } });
  return { ...DEFAULT_RULES, ...((s?.value as Partial<AttRules> | undefined) ?? {}) };
}
export async function saveAttRules(patch: Partial<AttRules>) {
  const value = { ...(await getAttRules()), ...patch };
  await prisma.setting.upsert({ where: { key: "attendance" }, update: { value: value as never }, create: { key: "attendance", value: value as never } });
  return value;
}

/** This person's office time: their own if one is set, otherwise the default. */
export function timeFor(r: AttRules, userId: string): PersonTime {
  const p = r.people?.[userId];
  return p ?? { start: r.start, end: r.end, graceMin: r.graceMin, weeklyOff: r.weeklyOff };
}

/** aa-bb-cc-dd-ee-ff / AABB.CCDD.EEFF -> aa:bb:cc:dd:ee:ff; null when it is not a real router MAC. */
export function normBssid(v: unknown): string | null {
  const h = String(v ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
  if (h.length !== 12 || h === "000000000000" || h === "020000000000") return null; // 02:00:.. = phone hid it (no location permission)
  return h.match(/../g)!.join(":");
}

/** Minutes after midnight in Dhaka for a moment in time. */
export function dhakaMinutes(d: Date) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).split(":").map(Number);
  return (h % 24) * 60 + m;
}
const mins = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };
export const isLate = (at: Date, r: PersonTime) => dhakaMinutes(at) > mins(r.start) + r.graceMin;
export const clock = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", hour: "numeric", minute: "2-digit" }).format(d) : "";

type Wifi = { bssid?: unknown; error?: unknown } | null;
/** A selfie and the phone's GPS from the mobile app. */
export type Shot = { photo?: unknown; lat?: unknown; lng?: unknown; acc?: unknown } | null;

function officeOrThrow(r: AttRules, wifi: Wifi) {
  if (!r.wifi.length) throw new AttError("The office WiFi is not set yet. An admin must set it once from the mobile app, in the office.");
  const b = normBssid(wifi?.bssid);
  if (!b) throw new AttError(typeof wifi?.error === "string" && wifi.error ? wifi.error : "The app could not read the WiFi. Connect to the office WiFi and allow Location for the app, then try again.");
  if (!r.wifi.some((w) => w.bssid === b)) throw new AttError("You are not on the office WiFi. Connect to the office WiFi and try again.");
  return b;
}

const gpsOf = (shot: Shot) => {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const lat = n(shot?.lat), lng = n(shot?.lng), acc = n(shot?.acc);
  return lat != null && lng != null && !(lat === 0 && lng === 0) ? { lat, lng, acc: acc != null ? Math.round(acc) : null } : null;
};

/** Office WiFi, or (field staff only) anywhere with a selfie + GPS. Selfie when the rules ask for one. */
async function verify(r: AttRules, userId: string, kind: "in" | "out", wifi: Wifi, shot: Shot) {
  const need = selfieFor(r, userId);
  const gps = gpsOf(shot);
  let bssid: string | null = null;
  let method = "wifi";
  try {
    bssid = officeOrThrow(r, wifi);
  } catch (e) {
    if (!need.field) throw e;
    if (!gps) throw new AttError("Field check " + kind + " needs the phone's location. Turn on Location and allow it for CMA Office, then try again.");
    method = "field";
  }
  const wantSelfie = kind === "in" ? need.in : need.out;
  if (wantSelfie && !shot?.photo) throw new AttError("Take a selfie to check " + kind + ". If the camera does not open, update the CMA Office app.");
  const selfie = shot?.photo ? await saveSelfie(userId, shot.photo, kind) : null;
  return { bssid, method, selfie, gps };
}

export async function checkIn(userId: string, wifi: Wifi, shot: Shot = null) {
  const r = await getAttRules();
  const date = todayDhaka();
  const ex = await prisma.attendance.findUnique({ where: { userId_date: { userId, date } } });
  if (ex?.checkIn) throw new AttError(`You already checked in at ${clock(ex.checkIn)}.`);
  const v = await verify(r, userId, "in", wifi, shot);
  const now = new Date();
  const data = {
    checkIn: now, late: isLate(now, timeFor(r, userId)), method: v.method, status: "PRESENT", bssid: v.bssid,
    selfieIn: v.selfie, inLat: v.gps?.lat ?? null, inLng: v.gps?.lng ?? null, inAcc: v.gps?.acc ?? null,
  };
  return prisma.attendance.upsert({ where: { userId_date: { userId, date } }, update: data, create: { userId, date, ...data } });
}

export async function checkOut(userId: string, wifi: Wifi, shot: Shot = null) {
  const r = await getAttRules();
  const date = todayDhaka();
  const ex = await prisma.attendance.findUnique({ where: { userId_date: { userId, date } } });
  if (!ex?.checkIn) throw new AttError("Check in first.");
  if (ex.checkOut) throw new AttError(`You already checked out at ${clock(ex.checkOut)}.`);
  const v = await verify(r, userId, "out", wifi, shot);
  return prisma.attendance.update({
    where: { id: ex.id },
    data: { checkOut: new Date(), selfieOut: v.selfie, outLat: v.gps?.lat ?? null, outLng: v.gps?.lng ?? null, outAcc: v.gps?.acc ?? null },
  });
}

/** Admin, standing in the office with the phone on the office WiFi. */
export async function addOfficeWifi(wifi: { bssid?: unknown; ssid?: unknown }) {
  const b = normBssid(wifi.bssid);
  if (!b) throw new AttError("The app could not read the WiFi. Connect to the office WiFi and allow Location for the app, then try again.");
  const r = await getAttRules();
  if (r.wifi.some((w) => w.bssid === b)) throw new AttError("This WiFi is already saved as office WiFi.");
  const ssid = String(wifi.ssid ?? "").replace(/^"|"$/g, "").slice(0, 60) || "Office WiFi";
  return saveAttRules({ wifi: [...r.wifi, { bssid: b, ssid, addedAt: new Date().toISOString() }] });
}
