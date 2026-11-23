// The Recruitment sheet's agency tabs kept cell for cell, for the sheet-style Interview List.
// The sheet pushes whole tabs; rows with an app change the sheet has not taken yet are kept.
import type { Interview } from "@prisma/client";
import { prisma } from "./db";
import { REC_DEFAULT_HEADER, dayLabel, type Cell } from "./recCols";

export const recRowRef = (tab: string, row: number) => `recrow:${tab}:${row}`;

const clean = (c: unknown): Cell =>
  c == null ? null : typeof c === "number" || typeof c === "boolean" ? c : String(c) === "" ? null : String(c);
const filled = (cells: Cell[]) => cells.some((c) => c != null && c !== "" && c !== false);

/** One whole tab from the sheet (row 1 first). */
export async function saveRecSheetTab(tab: string, values: unknown[][]) {
  const pending = new Set(
    (await prisma.sheetOutbox.findMany({ where: { sheet: "recruitment", sentAt: null, ref: { startsWith: `recrow:${tab}:` } }, select: { ref: true } }))
      .map((p) => Number(p.ref!.split(":").pop())),
  );
  const data: { tab: string; row: number; cells: Cell[] }[] = [];
  values.forEach((r, i) => {
    const cells = (Array.isArray(r) ? r : []).map(clean);
    while (cells.length && (cells[cells.length - 1] == null)) cells.pop();
    if ((i === 0 || filled(cells)) && !pending.has(i + 1)) data.push({ tab, row: i + 1, cells });
  });
  await prisma.$transaction([
    prisma.recSheetRow.deleteMany({ where: { tab, row: { notIn: [...pending] } } }),
    prisma.recSheetRow.createMany({ data: data.map((d) => ({ ...d, cells: d.cells as never })) }),
  ]);
  return data.length;
}

export type RecTab = { tab: string; header: Cell[]; rows: { row: number; cells: Cell[] }[]; fromSheet: boolean };

/** A tab as the sheet last sent it; before the first sync, built from the app's interviews. */
export async function loadRecTab(tab: string, companyId: string | undefined): Promise<RecTab> {
  const rows = await prisma.recSheetRow.findMany({ where: { tab }, orderBy: { row: "asc" } });
  if (rows.length) {
    const head = rows.find((r) => r.row === 1);
    return {
      tab, fromSheet: true,
      header: (head?.cells as Cell[] | undefined) ?? REC_DEFAULT_HEADER,
      rows: rows.filter((r) => r.row > 1).map((r) => ({ row: r.row, cells: r.cells as Cell[] })),
    };
  }
  const list = companyId ? await prisma.interview.findMany({ where: { companyId }, orderBy: { interviewDate: "asc" } }) : [];
  return { tab, fromSheet: false, header: REC_DEFAULT_HEADER, rows: list.map((iv, n) => ({ row: n + 2, cells: fromInterview(tab, iv) })) };
}

const N = (v: unknown) => (v == null ? null : Number(v));
function fromInterview(tab: string, iv: Interview): Cell[] {
  const date = iv.interviewDate.toISOString().slice(0, 10);
  const pc = iv.passports, bdt = N(iv.totalCostBdt), leads = iv.leads;
  return [
    tab, iv.title, iv.country, date, dayLabel(date), null, iv.workType, iv.details, false, null,
    N(iv.marketingPlanUsd), iv.status, iv.topUpRequired ? "Required" : null,
    pc, N(iv.totalCostUsd), bdt, pc && bdt ? Math.round((bdt / pc) * 100) / 100 : null, leads, pc && leads ? (pc / leads) * 100 : null,
  ];
}

/** Company names that appear more than once across the three tabs (the sheet marks them red). */
export function duplicateNames(tabs: RecTab[]) {
  const count = new Map<string, number>();
  for (const t of tabs) {
    const i = t.header.findIndex((h) => String(h ?? "").toLowerCase().trim() === "company name");
    for (const r of t.rows) {
      const k = String(r.cells[i < 0 ? 1 : i] ?? "").trim().toLowerCase();
      if (k) count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  return [...count.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}
