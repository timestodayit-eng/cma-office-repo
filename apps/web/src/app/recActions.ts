"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { enqueue } from "@/lib/outbox";
import { companyByName, recRef } from "@/lib/dataImport";
import { recCols, recKeyCols, dayLabel, isIsoDate, type Cell } from "@/lib/recCols";
import { recRowRef } from "@/lib/recSheet";

type OpCell = { c: number; v: Cell; t?: string };
type RecOp = { type: "rec.row"; tab: string; row: number; isNew?: boolean; expect: { coCol: number; dateCol: number; co: string; date: string }; cells: OpCell[] };

/**
 * One cell typed in the sheet-style Interview List. It is saved here, sent to the same cell
 * of the Google Sheet within about a minute, and the interview itself is updated too.
 * Finance columns and the Day column are never written by the app.
 */
export async function saveRecCell(input: { tab: string; row: number; col: number; value: string }) {
  const u = await requireUser();
  if (!u.can("interviews", "EDIT") && !u.can("recruitment", "EDIT")) return { error: "No edit access" };
  const { tab, row, col } = input;
  if (!Number.isInteger(row) || row < 2 || !Number.isInteger(col) || col < 0) return { error: "Unknown cell" };
  const [head, found, last] = await Promise.all([
    prisma.recSheetRow.findUnique({ where: { tab_row: { tab, row: 1 } } }),
    prisma.recSheetRow.findUnique({ where: { tab_row: { tab, row } } }),
    prisma.recSheetRow.findFirst({ where: { tab }, orderBy: { row: "desc" }, select: { row: true } }),
  ]);
  if (!head) return { error: "This tab is not in the app yet. Wait for the next sync, then try again." };
  // One of the empty rows under the last row: it becomes a new row of the sheet (agency name filled in column A).
  const isNewRow = !found && !!last && row > last.row && row <= last.row + 10;
  if (!found && !isNewRow) return { error: "This row is not in the sheet yet. Wait for the next sync, then try again." };
  const cur = found ?? (await prisma.recSheetRow.create({ data: { tab, row, cells: [] as never } }));
  const header = head.cells as Cell[];
  const def = recCols(tab, header, { money: true }).find((d) => d.i === col);
  if (!def?.edit) return { error: "This column is filled in the Google Sheet only" };

  const raw = input.value.trim();
  let v: Cell = raw || null;
  if (def.kind === "check") v = raw === "true";
  else if (def.kind === "date") {
    if (raw && !isIsoDate(raw)) return { error: "Pick a date" };
  } else if (def.kind === "money" && raw && /^[\d,.\s]+$/.test(raw)) v = Number(raw.replace(/[,\s]/g, ""));

  const cells = [...(cur.cells as Cell[])];
  while (cells.length <= col) cells.push(null);
  const keys = recKeyCols(header);
  const before = { co: String(cells[keys.co] ?? "").trim(), date: String(cells[keys.date] ?? "") };
  if (cells[col] === v || (cells[col] == null && v == null)) return { ok: true as const, cells };
  cells[col] = v;
  const changes: OpCell[] = [{ c: col + 1, v, t: def.kind === "date" ? "date" : undefined }];
  if (!String(cells[0] ?? "").trim() && col !== 0 && v != null) { cells[0] = tab; changes.push({ c: 1, v: tab }); }
  const dayCol = header.findIndex((h) => String(h ?? "").toLowerCase().trim() === "day");
  if (col === keys.date && dayCol >= 0) {
    while (cells.length <= dayCol) cells.push(null);
    cells[dayCol] = v ? dayLabel(String(v)) : null;
    changes.push({ c: dayCol + 1, v: cells[dayCol] });
  }

  const ref = recRowRef(tab, row);
  await prisma.$transaction(async (tx) => {
    await tx.recSheetRow.update({ where: { id: cur.id }, data: { cells: cells as never } });
    // Only the newest change of a row goes to the sheet, so it carries every cell changed since the sheet last took one,
    // and the row as the sheet still has it (to find it again if rows moved there).
    const waiting = await tx.sheetOutbox.findFirst({ where: { sheet: "recruitment", ref, sentAt: null }, orderBy: { createdAt: "desc" } });
    const prev = waiting?.op as RecOp | undefined;
    const merged = new Map<number, OpCell>((prev?.cells ?? []).map((c) => [c.c, c]));
    for (const c of changes) merged.set(c.c, c);
    const op: RecOp = {
      type: "rec.row", tab, row, isNew: prev ? prev.isNew : isNewRow,
      expect: prev?.expect ?? { coCol: keys.co + 1, dateCol: keys.date + 1, co: before.co, date: before.date },
      cells: [...merged.values()],
    };
    await enqueue(tx, "recruitment", ref, op);
  });

  // The interview behind the row follows at once (tasks, broadcast and reports use it).
  const company = await companyByName(tab);
  if (company && before.co && isIsoDate(before.date)) {
    const iv = await prisma.interview.findUnique({ where: { sheetRef: recRef(company.short, before.date, before.co) } });
    if (iv) {
      const label = def.label.toLowerCase();
      const data: Record<string, unknown> = {};
      if (col === keys.co && v) data.title = String(v);
      else if (col === keys.date && v) data.interviewDate = new Date(String(v) + "T00:00:00Z");
      else if (label.includes("country")) data.country = String(v ?? "");
      else if (label.includes("work type")) data.workType = v == null ? null : String(v);
      else if (label.includes("detail")) data.details = v == null ? null : String(v);
      else if (label === "status") data.status = v == null ? "Upcoming" : String(v).trim();
      else if (label.includes("marketing plan")) data.marketingPlanUsd = typeof v === "number" ? v : null;
      else if (label.includes("top")) data.topUpRequired = v === "Required";
      if (data.title || data.interviewDate) {
        const next = recRef(company.short, String(cells[keys.date]), String(cells[keys.co]).trim());
        if (!(await prisma.interview.findUnique({ where: { sheetRef: next }, select: { id: true } }))) data.sheetRef = next;
      }
      if (Object.keys(data).length) await prisma.interview.update({ where: { id: iv.id }, data });
    }
  }
  await prisma.auditLog.create({ data: { userId: u.id, action: "update", entity: "recsheet", entityId: cur.id, data: { tab, row, col: def.label } } });
  revalidatePath("/interviews");
  revalidatePath("/recruitment");
  return { ok: true as const, cells };
}
