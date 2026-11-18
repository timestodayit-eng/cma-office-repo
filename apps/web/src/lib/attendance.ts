// Attendance rules and check-in. The office is recognised by the router's MAC ID (BSSID),
// not by the WiFi name, because a name can be copied. Only the mobile app can read the MAC.
import { prisma } from "./db";
import { todayDhaka } from "./format";

export type OfficeWifi = { bssid: string; ssid: string; addedAt: string };
export type PersonTime = { start: string; end: string; graceMin: number; weeklyOff: number[] };
/** `people` holds the office time of anyone whose time differs from the default (shift, 6-hour, own off day). */
export type AttRules = PersonTime & { wifi: OfficeWifi[]; people: Record<string, PersonTime> };
export const DEFAULT_RULES: AttRules = { start: "09:00", end: "18:00", graceMin: 15, weeklyOff: [5], wifi: [], people: {} };
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

function officeOrThrow(r: AttRules, wifi: { bssid?: unknown } | null) {
  if (!r.wifi.length) throw new AttError("The office WiFi is not set yet. An admin must set it once from the mobile app, in the office.");
  const b = normBssid(wifi?.bssid);
  if (!b) throw new AttError("The app could not read the WiFi. Connect to the office WiFi and allow Location for the app, then try again.");
  if (!r.wifi.some((w) => w.bssid === b)) throw new AttError("You are not on the office WiFi. Connect to the office WiFi and try again.");
  return b;
}

export async function checkIn(userId: string, wifi: { bssid?: unknown } | null) {
  const r = await getAttRules();
  const bssid = officeOrThrow(r, wifi);
  const date = todayDhaka();
  const now = new Date();
  const ex = await prisma.attendance.findUnique({ where: { userId_date: { userId, date } } });
  if (ex?.checkIn) throw new AttError(`You already checked in at ${clock(ex.checkIn)}.`);
  const data = { checkIn: now, late: isLate(now, timeFor(r, userId)), method: "wifi", status: "PRESENT", bssid };
  return prisma.attendance.upsert({ where: { userId_date: { userId, date } }, update: data, create: { userId, date, ...data } });
}

export async function checkOut(userId: string, wifi: { bssid?: unknown } | null) {
  const r = await getAttRules();
  officeOrThrow(r, wifi);
  const date = todayDhaka();
  const ex = await prisma.attendance.findUnique({ where: { userId_date: { userId, date } } });
  if (!ex?.checkIn) throw new AttError("Check in first.");
  if (ex.checkOut) throw new AttError(`You already checked out at ${clock(ex.checkOut)}.`);
  return prisma.attendance.update({ where: { id: ex.id }, data: { checkOut: new Date() } });
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
