// One-time import of the existing Google Sheet data from a JSON snapshot
// (recruitment interviews, Banglalink broadcast panel, all log sheet day tabs).
// Usage: pnpm import:snapshot /path/to/snapshot.json
// Safe to re-run: rows are matched by sheetRef and updated, never duplicated.
// The snapshot holds business data, so it is NOT kept in this repository.
// Phase 2 replaces this with live two-way Google Sheets sync.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type RecRow = {
  co: string; country: string; date: string; details?: string; status?: string; work?: string;
  mplan?: number | string; pc?: number | string; usd?: number | string; bdt?: number | string; leads?: number | string; topup?: string;
};
type BlRow = { co: string; country: string; date: string; type?: string; v: [string | null, number, number][] };
type Snapshot = { recruitment: Record<string, RecRow[]>; broadcast: Record<string, BlRow[]>; log: Record<string, string[][]> };

const LOG_COLS = [
  "title", "deadline", "priority", "company", "mainCategory", "contentType", "scriptWriter", "scriptLink", "presenter",
  "cinematographer", "videoEditor", "status", "thumbnail", "rawFile", "finalOutput", "comments", "uploadFacebook",
  "uploadYoutube", "uploadTiktok", "platformFacebook", "platformYoutube", "platformTiktok", "finalComments",
] as const;

const day = (s: string) => new Date(s.slice(0, 10) + "T00:00:00Z");
/** Sheet cells can hold text like "1,200" or "N/A": keep only real numbers. */
const num = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && String(v).match(/\d/) ? n : null;
};
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: pnpm import:snapshot /path/to/snapshot.json");
  const snap = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  const companies = await prisma.company.findMany();
  const byName = new Map(companies.map((c) => [c.name, c]));

  let rec = 0;
  for (const [agency, rows] of Object.entries(snap.recruitment ?? {})) {
    const company = byName.get(agency);
    if (!company) { console.warn("Unknown agency", agency); continue; }
    const seen = new Map<string, number>();
    for (const r of rows) {
      if (!r.date) continue;
      const base = `rec:${company.short}:${r.date}:${key(r.co)}`;
      const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
      const sheetRef = n > 1 ? `${base}:${n}` : base;
      const data = {
        companyId: company.id,
        country: r.country.trim(),
        interviewDate: day(r.date),
        title: r.co.trim(),
        status: r.status || (day(r.date) < new Date() ? "Interview Done" : "Upcoming"),
        marketingPlanUsd: num(r.mplan),
        totalCostUsd: num(r.usd),
        totalCostBdt: num(r.bdt),
        passports: num(r.pc) != null ? Math.round(num(r.pc)!) : null,
        leads: num(r.leads) != null ? Math.round(num(r.leads)!) : null,
        topUpRequired: r.topup === "Required",
        notes: [r.work, r.details].filter(Boolean).join(" · ") || null,
      };
      await prisma.interview.upsert({ where: { sheetRef }, update: data, create: { ...data, sheetRef } });
      rec++;
    }
  }

  let bl = 0;
  for (const [agency, rows] of Object.entries(snap.broadcast ?? {})) {
    const company = byName.get(agency);
    if (!company) continue;
    for (const r of rows) {
      const sheetRef = `rec:${company.short}:${r.date}:${key(r.co)}`;
      let iv = await prisma.interview.findUnique({ where: { sheetRef } });
      if (!iv) {
        iv = await prisma.interview.create({
          data: { companyId: company.id, country: r.country.trim(), interviewDate: day(r.date), title: r.co.trim(), status: "Upcoming", sheetRef },
        });
      }
      for (let i = 0; i < r.v.length; i++) {
        const [d, received, missed] = r.v[i];
        if (!d) continue;
        const slot = `V${i + 1}`;
        const data = { callDate: day(d), receivedSent: !!received, missedSent: !!missed };
        await prisma.broadcastSlot.upsert({
          where: { interviewId_slot: { interviewId: iv.id, slot } },
          update: data,
          create: { interviewId: iv.id, slot, ...data },
        });
        bl++;
      }
    }
  }

  let logs = 0;
  for (const [d, rows] of Object.entries(snap.log ?? {})) {
    let sn = 0;
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i];
      if (!cells.some((c) => c && String(c).trim())) continue;
      const data: Record<string, unknown> = { date: day(d), rowIndex: i };
      LOG_COLS.forEach((k, j) => { data[k] = cells[j] ? String(cells[j]).trim() : null; });
      data.sn = data.title ? ++sn : null;
      const sheetRef = `log:${d}:${i}`;
      await prisma.logRow.upsert({ where: { sheetRef }, update: data, create: { ...(data as object), sheetRef } as never });
      logs++;
    }
  }

  console.log(`Imported ${rec} interviews, ${bl} broadcast slots, ${logs} log rows.`);
}

main().finally(() => prisma.$disconnect());
