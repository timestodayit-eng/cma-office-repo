// Writing sheet data into the app's database. Used by the live Google Sheets sync
// (each sheet's script pushes its tabs here) and by the one-time snapshot upload.
// Rows are matched by sheetRef, so running it again updates and never duplicates.
import type { Company } from "@prisma/client";
import { prisma } from "./db";
import { attachChain } from "./workflow";
import { LOG_COLS } from "./sheetRules";

export type RecRow = {
  co: string; country: string; date: string; details?: string; status?: string; work?: string;
  mplan?: number | string; pc?: number | string; usd?: number | string; bdt?: number | string; leads?: number | string; topup?: string;
};
export type BlRow = { co: string; country: string; date: string; type?: string; v: [string | null, unknown, unknown][] };

const day = (s: string) => new Date(s.slice(0, 10) + "T00:00:00Z");
/** Sheet cells can hold text like "1,200" or "N/A": keep only real numbers. */
export const num = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && String(v).match(/\d/) ? n : null;
};
const int = (v: unknown) => (num(v) != null ? Math.round(num(v)!) : null);
export const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export const recRef = (short: string, date: string, co: string) => `rec:${short}:${date}:${nameKey(co)}`;
const dhakaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());

/** Refs with a change made in the app that is not in the sheet yet: the sheet must not overwrite them. */
async function pendingRefs() {
  const rows = await prisma.sheetOutbox.findMany({ where: { sentAt: null, ref: { not: null } }, select: { ref: true } });
  return new Set(rows.map((r) => r.ref!));
}

export async function companyByName(name: string) {
  const companies = await prisma.company.findMany();
  const k = nameKey(name);
  return (
    companies.find((c) => nameKey(c.name) === k || nameKey(c.sheetTab ?? "") === k) ??
    companies.find((c) => k.includes(nameKey(c.name).split(" ")[0]))
  );
}

/**
 * One recruitment tab. `full` = the whole tab was sent, so interviews that came from
 * this tab and are gone from it (and have no work started) are removed.
 */
export async function importRecruitment(company: Company, rows: RecRow[], opts: { full?: boolean; chains?: boolean } = {}) {
  const skip = await pendingRefs();
  // A row edited in the Interview List and not in the sheet yet: the sheet still has its old name/date,
  // so neither the old nor the new key may be created, changed or removed from this push.
  const tab = company.sheetTab ?? company.name;
  const waiting = await prisma.sheetOutbox.findMany({ where: { sheet: "recruitment", sentAt: null, ref: { startsWith: `recrow:${tab}:` } } });
  for (const w of waiting) {
    const op = w.op as { row?: number; expect?: { co: string; date: string; coCol: number; dateCol: number } };
    if (!op.expect) continue;
    skip.add(recRef(company.short, op.expect.date, op.expect.co));
    const now = await prisma.recSheetRow.findUnique({ where: { tab_row: { tab, row: op.row ?? 0 } } });
    const c = (now?.cells as unknown[] | undefined) ?? [];
    if (c.length) skip.add(recRef(company.short, String(c[op.expect.dateCol - 1] ?? ""), String(c[op.expect.coCol - 1] ?? "")));
  }
  const seen = new Map<string, number>();
  const refs: string[] = [];
  let created = 0, updated = 0;
  const today = dhakaToday();
  for (const r of rows) {
    if (!r.date || !r.co?.trim()) continue;
    const base = recRef(company.short, r.date, r.co);
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    const sheetRef = n > 1 ? `${base}:${n}` : base;
    refs.push(sheetRef);
    if (skip.has(sheetRef)) continue;
    const data = {
      companyId: company.id,
      country: (r.country ?? "").trim(),
      interviewDate: day(r.date),
      title: r.co.trim(),
      status: r.status?.trim() || (r.date < today ? "Interview Done" : "Upcoming"),
      marketingPlanUsd: num(r.mplan),
      totalCostUsd: num(r.usd),
      totalCostBdt: num(r.bdt),
      passports: int(r.pc),
      leads: int(r.leads),
      topUpRequired: r.topup === "Required",
      workType: r.work?.trim() || null,
      details: r.details?.trim() || null,
      notes: [r.work, r.details].filter(Boolean).join(" · ") || null,
    };
    const existing = await prisma.interview.findUnique({ where: { sheetRef }, select: { id: true } });
    if (existing) {
      await prisma.interview.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      const iv = await prisma.interview.create({ data: { ...data, sheetRef } });
      created++;
      // A new future interview typed in the sheet starts its video timeline, like one made in the app.
      if (opts.chains && r.date > today) await attachChain(iv.id, { fromSheet: true });
    }
  }
  let removed = 0;
  if (opts.full) {
    const gone = await prisma.interview.findMany({
      where: { companyId: company.id, sheetRef: { startsWith: `rec:${company.short}:`, notIn: refs }, tasks: { none: {} } },
      select: { id: true, sheetRef: true },
    });
    const del = gone.filter((g) => !skip.has(g.sheetRef!)).map((g) => g.id);
    if (del.length) removed = (await prisma.interview.deleteMany({ where: { id: { in: del } } })).count;
  }
  return { created, updated, removed };
}

/** One Banglalink panel tab: V1..V7 call days with Received / Missed ticks. */
export async function importBroadcast(company: Company, rows: BlRow[]) {
  const skip = await pendingRefs();
  let slots = 0;
  for (const r of rows) {
    if (!r.date || !r.co?.trim()) continue;
    const sheetRef = recRef(company.short, r.date, r.co);
    let iv = await prisma.interview.findUnique({ where: { sheetRef } });
    if (!iv) {
      iv = await prisma.interview.create({
        data: { companyId: company.id, country: (r.country ?? "").trim(), interviewDate: day(r.date), title: r.co.trim(), status: "Upcoming", sheetRef },
      });
    }
    if (r.type && r.type !== iv.broadcastType) await prisma.interview.update({ where: { id: iv.id }, data: { broadcastType: r.type } });
    for (let i = 0; i < r.v.length; i++) {
      const [d, received, missed] = r.v[i];
      const slot = `V${i + 1}`;
      if (skip.has(`bc:${iv.id}:${slot}`)) continue;
      if (!d) {
        await prisma.broadcastSlot.deleteMany({ where: { interviewId: iv.id, slot } });
        continue;
      }
      const data = { callDate: day(d), receivedSent: !!received, missedSent: !!missed };
      await prisma.broadcastSlot.upsert({
        where: { interviewId_slot: { interviewId: iv.id, slot } },
        update: data,
        create: { interviewId: iv.id, slot, ...data },
      });
      slots++;
    }
  }
  return { slots };
}

/** One log sheet day tab. Row i of the data = sheet row i+2. Empty rows are removed. */
export async function importLogDay(date: string, rows: unknown[][], opts: { full?: boolean } = {}) {
  const skip = await pendingRefs();
  let sn = 0, saved = 0;
  const keep: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (!cells.some((c) => c != null && String(c).trim())) continue;
    keep.push(i);
    const sheetRef = `log:${date}:${i}`;
    const data: Record<string, unknown> = { date: day(date), rowIndex: i };
    LOG_COLS.forEach((k, j) => { data[k] = cells[j] != null && String(cells[j]).trim() ? String(cells[j]).trim() : null; });
    data.sn = data.title ? ++sn : null;
    if (skip.has(sheetRef)) continue;
    await prisma.logRow.upsert({ where: { sheetRef }, update: data, create: { ...(data as object), sheetRef } as never });
    saved++;
  }
  let removed = 0;
  if (opts.full) {
    const gone = await prisma.logRow.findMany({
      where: { date: day(date), sheetRef: { startsWith: `log:${date}:` }, rowIndex: { notIn: keep } },
      select: { id: true, sheetRef: true },
    });
    const del = gone.filter((g) => !skip.has(g.sheetRef!)).map((g) => g.id);
    if (del.length) removed = (await prisma.logRow.deleteMany({ where: { id: { in: del } } })).count;
  }
  return { saved, removed };
}

/** The JSON snapshot of 18 Nov (recruitment, broadcast, all log day tabs). */
export async function importSnapshot(snap: { recruitment?: Record<string, RecRow[]>; broadcast?: Record<string, BlRow[]>; log?: Record<string, string[][]> }) {
  const out = { interviews: 0, slots: 0, logRows: 0, unknown: [] as string[] };
  for (const [agency, rows] of Object.entries(snap.recruitment ?? {})) {
    const c = await companyByName(agency);
    if (!c) { out.unknown.push(agency); continue; }
    const r = await importRecruitment(c, rows, { chains: false });
    out.interviews += r.created + r.updated;
  }
  for (const [agency, rows] of Object.entries(snap.broadcast ?? {})) {
    const c = await companyByName(agency);
    if (!c) continue;
    out.slots += (await importBroadcast(c, rows)).slots;
  }
  for (const [d, rows] of Object.entries(snap.log ?? {})) out.logRows += (await importLogDay(d, rows)).saved;
  return out;
}
