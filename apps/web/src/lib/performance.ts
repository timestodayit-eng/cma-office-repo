// Performance comes only from the Digital Media Solution Log Sheet: every content row names who
// wrote the script, presented, shot, edited and made the thumbnail. Nothing here is typed by hand.
import { FINISHED_STATUSES } from "@cma/core";
import { prisma } from "./db";

export const PERF_ROLES = [
  ["scriptWriter", "Script"], ["presenter", "Presenter"], ["cinematographer", "Camera"], ["videoEditor", "Editing"], ["thumbnail", "Thumbnail"],
] as const;
export type PerfRole = (typeof PERF_ROLES)[number][0];
const DROPPED = new Set(["Dropped", "Cancelled"]);

export type PerfLine = {
  userId: string | null; name: string; designation: string | null;
  total: number; finished: number; open: number; dropped: number; pct: number | null;
  byRole: Partial<Record<PerfRole, { total: number; finished: number }>>;
  days: number;
};

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
/** One letter added, removed or changed ("Solayman" = "Solaiman", "Mahadi" = "Mahdi"). */
function near(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

type Person = { id: string; name: string; shortName: string | null; designation: string | null };
/** The team member a name written in the sheet means, or null (a name that is not in the team list). */
export function matchPerson(sheetName: string, people: Person[]): Person | null {
  const n = norm(sheetName);
  if (!n) return null;
  const words = n.split(" ");
  const keys = (p: Person) => [...(p.shortName ? [norm(p.shortName)] : []), ...norm(p.name).split(" ").filter((w) => w.length > 2 && w !== "md")];
  return people.find((p) => norm(p.name) === n || (p.shortName && norm(p.shortName) === n))
    ?? people.find((p) => keys(p).some((k) => words.includes(k)))
    ?? people.find((p) => keys(p).some((k) => words.some((w) => near(w, k))))
    ?? null;
}

/** Everybody's log-sheet work in a month ("2026-11"). */
export async function performance(month: string): Promise<{ lines: PerfLine[]; unknown: PerfLine[]; rows: number }> {
  const [y, m] = month.split("-").map(Number);
  const [people, rows] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, shortName: true, designation: true } }),
    prisma.logRow.findMany({
      where: { date: { gte: new Date(Date.UTC(y, m - 1, 1)), lte: new Date(Date.UTC(y, m, 0)) }, title: { not: null } },
      select: { date: true, status: true, scriptWriter: true, presenter: true, cinematographer: true, videoEditor: true, thumbnail: true },
    }),
  ]);
  const cache = new Map<string, Person | null>();
  const lines = new Map<string, PerfLine & { _days: Set<number> }>();
  for (const r of rows) {
    const finished = !!r.status && FINISHED_STATUSES.has(r.status);
    const dropped = !!r.status && DROPPED.has(r.status);
    for (const [col] of PERF_ROLES) {
      const raw = r[col]?.trim();
      // a link or a tick in the thumbnail column is not a person's name
      if (!raw || /https?:|^(yes|no|done|ok|✓|✔|-)$/i.test(raw)) continue;
      for (const part of raw.split(/\s*(?:[,&/+]|\band\b)\s*/i).filter(Boolean)) {
        if (!cache.has(part)) cache.set(part, matchPerson(part, people));
        const p = cache.get(part)!;
        const key = p ? p.id : "?" + norm(part);
        const l = lines.get(key) ?? { userId: p?.id ?? null, name: p?.name ?? part, designation: p?.designation ?? null, total: 0, finished: 0, open: 0, dropped: 0, pct: null, byRole: {}, days: 0, _days: new Set<number>() };
        l.total++; if (finished) l.finished++; else if (dropped) l.dropped++; else l.open++;
        const b = (l.byRole[col] ??= { total: 0, finished: 0 }); b.total++; if (finished) b.finished++;
        l._days.add(r.date.getTime());
        lines.set(key, l);
      }
    }
  }
  const all = [...lines.values()].map(({ _days, ...l }) => ({ ...l, days: _days.size, pct: l.total - l.dropped > 0 ? Math.round((l.finished / (l.total - l.dropped)) * 100) : null }));
  // people with no rows this month still appear, with zeros
  for (const p of people) if (!all.some((l) => l.userId === p.id)) all.push({ userId: p.id, name: p.name, designation: p.designation, total: 0, finished: 0, open: 0, dropped: 0, pct: null, byRole: {}, days: 0 });
  const sort = (a: PerfLine, b: PerfLine) => b.finished - a.finished || b.total - a.total || a.name.localeCompare(b.name);
  return { lines: all.filter((l) => l.userId).sort(sort), unknown: all.filter((l) => !l.userId).sort(sort), rows: rows.length };
}
