// Time tracker (Hubstaff style) on top of Work Monitor work sessions.
//   worked time = time in work sessions − cuts (discarded idle, self-deleted screenshots) + approved manual time
//   activity %  = seconds with mouse/keyboard input ÷ tracked seconds (counts only, never which keys)
// Everything here is about tracked time only: nothing is recorded while the timer is off.
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { todayDhaka } from "./format";
import { unlink } from "node:fs/promises";
import { shotPath } from "./monitor";

const H6 = 6 * 3600_000;
const DAY = 86_400_000;
export const SLOT_MS = 10 * 60_000;

/** Dhaka calendar day (UTC midnight Date) -> the UTC moment it starts. */
export const dayStart = (day: Date) => new Date(day.getTime() - H6);
/** UTC moment -> its Dhaka day as "2026-11-21". */
export const dayKey = (at: Date) => new Date(at.getTime() + H6).toISOString().slice(0, 10);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const parseDay = (v: unknown): Date | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T00:00:00Z") : null);
/** The Saturday that starts the week of this Dhaka day (Bangladesh weeks start on Saturday). */
export const weekStartOf = (day: Date) => new Date(day.getTime() - ((day.getUTCDay() + 1) % 7) * DAY);
export const monthStartOf = (day: Date) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

// ---------- websites from browser window titles ----------

const BROWSER = /chrome|edge|firefox|opera|brave|vivaldi|browser|safari/i;
const SUFFIX = /\s[-–—|]\s(google chrome|microsoft edge|mozilla firefox|firefox|opera|brave|vivaldi|yandex|safari)$/i;
/** Well-known sites by words that appear in their page titles. Order matters (Docs before Google). */
const KNOWN: [RegExp, string][] = [
  [/youtube/i, "youtube.com"],
  [/facebook|messenger|meta business|ads manager/i, "facebook.com"],
  [/instagram/i, "instagram.com"],
  [/tiktok/i, "tiktok.com"],
  [/whatsapp/i, "web.whatsapp.com"],
  [/google sheets|- sheets$/i, "sheets.google.com"],
  [/google docs|- docs$/i, "docs.google.com"],
  [/google slides/i, "slides.google.com"],
  [/google drive|- drive$|my drive/i, "drive.google.com"],
  [/gmail|inbox \(\d+\)/i, "mail.google.com"],
  [/google search|- google search$/i, "google.com"],
  [/canva/i, "canva.com"],
  [/chatgpt/i, "chatgpt.com"],
  [/claude/i, "claude.ai"],
  [/linkedin/i, "linkedin.com"],
  [/bdjobs/i, "bdjobs.com"],
  [/netflix/i, "netflix.com"],
  [/cma office/i, "CMA Office"],
];

export function isBrowser(app: string | null | undefined) {
  return !!app && BROWSER.test(app);
}

/** "Inbox (3) - someone@gmail.com - Gmail - Google Chrome" -> "mail.google.com".
 *  Browsers do not show the address in the title, so this is a best guess from the page name. */
export function siteOf(app: string | null | undefined, title: string | null | undefined): string | null {
  if (!isBrowser(app) || !title) return null;
  let t = title.trim();
  for (let i = 0; i < 3 && SUFFIX.test(t); i++) t = t.replace(SUFFIX, "");
  t = t.replace(/\s[-–—]\s(profile \d+|personal|work)$/i, "").trim();
  if (!t || /^new tab$/i.test(t)) return null;
  for (const [re, site] of KNOWN) if (re.test(t)) return site;
  const dom = t.match(/\b([a-z0-9-]+\.)+(com|net|org|io|ai|bd|co|gov|edu)(\.[a-z]{2})?\b/i);
  if (dom) return dom[0].toLowerCase();
  // Most sites end their titles with their own name: "Some article - BBC News".
  const parts = t.split(/\s[-–—|·]\s/).map((x) => x.trim()).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return last ? last.slice(0, 60) : null;
}

// ---------- productive / unproductive ----------

export type Cat = "P" | "N" | "U";
export type Cats = { all: Record<string, Cat>; dept: Record<string, Record<string, Cat>> };
export const CAT_LABEL: Record<Cat, string> = { P: "Productive", N: "Neutral", U: "Unproductive" };

export async function getCats(): Promise<Cats> {
  const v = (await prisma.setting.findUnique({ where: { key: "monitorCats" } }))?.value as Partial<Cats> | undefined;
  return { all: v?.all ?? {}, dept: v?.dept ?? {} };
}
export async function saveCats(c: Cats) {
  await prisma.setting.upsert({ where: { key: "monitorCats" }, update: { value: c as never }, create: { key: "monitorCats", value: c as never } });
}
export const catKey = (s: string) => s.trim().toLowerCase();
/** A team's own label wins over the label for everyone. Unlabelled = Neutral. */
export function catOf(c: Cats, name: string, dept?: string | null): Cat {
  const k = catKey(name);
  return (dept ? c.dept[dept]?.[k] : undefined) ?? c.all[k] ?? "N";
}

// ---------- worked time ----------

export type DayTotal = { sec: number; actSum: number; actN: number; manual: number; cut: number };
export const pct = (t: { actSum: number; actN: number }) => (t.actN ? Math.round((t.actSum / (t.actN * 60)) * 100) : null);
const blank = (): DayTotal => ({ sec: 0, actSum: 0, actN: 0, manual: 0, cut: 0 });

/** Worked seconds and activity per person per Dhaka day, for days in [fromDay, toDay]. */
export async function workedByDay(fromDay: Date, toDay: Date, userIds?: string[]) {
  const from = dayStart(fromDay);
  const to = dayStart(addDays(toDay, 1));
  const who = userIds ? { userId: { in: userIds } } : {};
  const [sessions, entries, acts] = await Promise.all([
    prisma.workSession.findMany({ where: { startedAt: { gte: from, lt: to }, ...who }, select: { userId: true, startedAt: true, activeSec: true, idleSec: true } }),
    prisma.timeEntry.findMany({ where: { status: "APPROVED", from: { gte: from, lt: to }, ...who }, select: { userId: true, from: true, sec: true, kind: true } }),
    prisma.$queryRaw<{ userId: string; d: string; a: number; n: number }[]>`
      SELECT "userId", to_char("at" + interval '6 hours', 'YYYY-MM-DD') AS d, COALESCE(SUM("act"), 0)::int AS a, COUNT("act")::int AS n
      FROM "ActivitySample"
      WHERE "at" >= ${from} AND "at" < ${to} ${userIds ? Prisma.sql`AND "userId" IN (${Prisma.join(userIds.length ? userIds : [""])})` : Prisma.empty}
      GROUP BY 1, 2`,
  ]);
  const out = new Map<string, Map<string, DayTotal>>();
  const get = (u: string, d: string) => {
    let m = out.get(u);
    if (!m) out.set(u, (m = new Map()));
    let t = m.get(d);
    if (!t) m.set(d, (t = blank()));
    return t;
  };
  for (const s of sessions) get(s.userId, dayKey(s.startedAt)).sec += s.activeSec + s.idleSec;
  for (const e of entries) {
    const t = get(e.userId, dayKey(e.from));
    if (e.kind === "MANUAL") { t.sec += e.sec; t.manual += e.sec; } else { t.sec -= e.sec; t.cut += e.sec; }
  }
  for (const r of acts) { const t = get(r.userId, r.d); t.actSum += Number(r.a); t.actN += Number(r.n); }
  for (const m of out.values()) for (const t of m.values()) t.sec = Math.max(0, t.sec);
  return out;
}

export function sumDays(m: Map<string, DayTotal> | undefined, fromDay?: Date, toDay?: Date): DayTotal {
  const t = blank();
  if (!m) return t;
  const a = fromDay ? isoDay(fromDay) : "", b = toDay ? isoDay(toDay) : "9999";
  for (const [d, x] of m) if (d >= a && d <= b) { t.sec += x.sec; t.actSum += x.actSum; t.actN += x.actN; t.manual += x.manual; t.cut += x.cut; }
  return t;
}

/** Today's and this week's worked seconds of one person (for the desktop timer). */
export async function myTotals(userId: string) {
  const today = todayDhaka();
  const ws = weekStartOf(today);
  const m = (await workedByDay(ws, today, [userId])).get(userId);
  return { todaySec: sumDays(m, today, today).sec, weekSec: sumDays(m).sec };
}

// ---------- one day as 10-minute slots ----------

export type Slot = {
  at: Date; min: number; actSum: number; actN: number; idleMin: number;
  app: string | null; site: string | null; title: string | null;
  shots: { id: string; takenAt: Date; app: string | null; title: string | null; screen: number }[];
};

export async function daySlots(userId: string, day: Date) {
  const from = dayStart(day);
  const to = new Date(from.getTime() + DAY);
  const [samples, shots, entries, sessions] = await Promise.all([
    prisma.activitySample.findMany({ where: { userId, at: { gte: from, lt: to } }, orderBy: { at: "asc" }, select: { at: true, app: true, title: true, site: true, idle: true, act: true } }),
    prisma.screenshot.findMany({ where: { userId, takenAt: { gte: from, lt: to } }, orderBy: { takenAt: "asc" }, select: { id: true, takenAt: true, app: true, title: true, screen: true } }),
    prisma.timeEntry.findMany({ where: { userId, from: { gte: from, lt: to } }, orderBy: { from: "asc" } }),
    prisma.workSession.findMany({ where: { userId, startedAt: { gte: from, lt: to } }, orderBy: { startedAt: "asc" } }),
  ]);
  const slots = new Map<number, Slot & { apps: Map<string, number> }>();
  const slotOf = (at: Date) => {
    const k = Math.floor((at.getTime() - from.getTime()) / SLOT_MS);
    let s = slots.get(k);
    if (!s) slots.set(k, (s = { at: new Date(from.getTime() + k * SLOT_MS), min: 0, actSum: 0, actN: 0, idleMin: 0, app: null, site: null, title: null, shots: [], apps: new Map() }));
    return s;
  };
  for (const x of samples) {
    const s = slotOf(x.at);
    s.min++;
    if (x.idle) s.idleMin++;
    if (x.act != null) { s.actSum += x.act; s.actN++; }
    if (!x.idle && (x.site || x.app)) {
      const key = JSON.stringify([x.app ?? "", x.site ?? "", x.title ?? ""]);
      s.apps.set(key, (s.apps.get(key) ?? 0) + 1);
    }
  }
  for (const x of shots) slotOf(x.takenAt).shots.push(x);
  const list = [...slots.values()].sort((a, b) => a.at.getTime() - b.at.getTime()).map(({ apps, ...s }) => {
    let best = ""; let n = 0;
    for (const [k, v] of apps) if (v > n) { best = k; n = v; }
    if (best) { const [a, si, ti] = JSON.parse(best) as string[]; s.app = a || null; s.site = si || null; s.title = ti || null; }
    return s;
  });
  return { slots: list, entries, sessions };
}

// ---------- apps & websites ----------

export type Usage = { name: string; kind: "site" | "app"; min: number; cat: Cat };

/** Active (not idle) minutes per website, and per app for everything that is not a browser. */
export async function usage(fromDay: Date, toDay: Date, opts: { userId?: string; userIds?: string[]; dept?: string | null; cats: Cats }) {
  const rows = await prisma.activitySample.groupBy({
    by: ["app", "site"],
    where: { idle: false, at: { gte: dayStart(fromDay), lt: dayStart(addDays(toDay, 1)) }, ...(opts.userId ? { userId: opts.userId } : opts.userIds ? { userId: { in: opts.userIds } } : {}) },
    _count: { _all: true },
  });
  const m = new Map<string, Usage>();
  for (const r of rows) {
    const name = r.site || (isBrowser(r.app) ? `${r.app} (other pages)` : r.app) || "Unknown";
    const kind = r.site ? "site" : "app";
    const u = m.get(name) ?? { name, kind, min: 0, cat: catOf(opts.cats, name, opts.dept) };
    u.min += r._count._all;
    m.set(name, u);
  }
  return [...m.values()].sort((a, b) => b.min - a.min);
}

// ---------- cuts (discarded idle, self-deleted screenshots) ----------

/** Seconds of [a, b) not already covered by this person's approved cuts. */
async function uncovered(userId: string, a: Date, b: Date) {
  const cuts = await prisma.timeEntry.findMany({ where: { userId, status: "APPROVED", kind: { startsWith: "CUT" }, from: { lt: b }, to: { gt: a } }, select: { from: true, to: true } });
  // walk the free pieces of [a, b)
  const spans = cuts.map((c) => [Math.max(a.getTime(), c.from.getTime()), Math.min(b.getTime(), c.to.getTime())]).sort((x, y) => x[0] - y[0]);
  let covered = 0; let end = a.getTime();
  for (const [s, e] of spans) { if (e <= end) continue; covered += e - Math.max(s, end); end = e; }
  return Math.max(0, Math.round((b.getTime() - a.getTime() - covered) / 1000));
}

/** Remove [a, b) from someone's tracked time: a cut row, plus its screenshots and activity minutes. */
export async function cutTime(userId: string, kind: "CUT_IDLE" | "CUT_SHOT", a: Date, b: Date, sessionId: string | null, reason: string) {
  if (b <= a) return 0;
  const sec = await uncovered(userId, a, b);
  const shots = await prisma.screenshot.findMany({ where: { userId, takenAt: { gte: a, lt: b } }, select: { id: true, file: true } });
  for (const s of shots) await unlink(shotPath(s.file)).catch(() => {});
  await prisma.$transaction([
    prisma.screenshot.deleteMany({ where: { id: { in: shots.map((s) => s.id) } } }),
    prisma.activitySample.deleteMany({ where: { userId, at: { gte: a, lt: b } } }),
    ...(sec > 0 ? [prisma.timeEntry.create({ data: { userId, kind, from: a, to: b, sec, sessionId, reason, status: "APPROVED", decidedAt: new Date() } })] : []),
  ]);
  return sec;
}

export function hm(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}
