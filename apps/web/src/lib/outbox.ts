// App -> Google Sheet. Every change made in the app is queued here. The script inside
// each sheet collects its queue about once a minute, writes the cells and reports back.
// Until a change is confirmed, data pushed from the sheet does not overwrite that row.
import type { Prisma, LogRow } from "@prisma/client";
import { prisma } from "./db";
import { LOG_COLS, logTabName } from "./sheetRules";

type Tx = Prisma.TransactionClient | typeof prisma;
export type SheetKind = "recruitment" | "broadcast" | "log";

export type SheetConfig = {
  secret: string;
  last?: Partial<Record<SheetKind, { at: string; tab: string; summary: string; url?: string }>>;
  lastSend?: Partial<Record<SheetKind, { at: string; ok: boolean; error?: string }>>;
};

export async function getSheetConfig(): Promise<SheetConfig> {
  const s = await prisma.setting.findUnique({ where: { key: "sheets" } });
  const v = (s?.value as SheetConfig | undefined) ?? null;
  if (v?.secret) return v;
  const fresh: SheetConfig = { secret: crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "") };
  await prisma.setting.upsert({ where: { key: "sheets" }, update: { value: fresh }, create: { key: "sheets", value: fresh } });
  return fresh;
}

export async function patchSheetConfig(fn: (c: SheetConfig) => void) {
  const c = await getSheetConfig();
  fn(c);
  await prisma.setting.update({ where: { key: "sheets" }, data: { value: c as never } });
  return c;
}

export async function enqueue(db: Tx, sheet: SheetKind, ref: string | null, op: Record<string, unknown>) {
  await db.sheetOutbox.create({ data: { sheet, ref, op: op as never } });
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Queue the full row so the sheet row matches the app. */
export async function queueLogRow(db: Tx, row: LogRow, isNew = false) {
  const date = iso(row.date);
  const ref = row.sheetRef ?? `log:${date}:${row.rowIndex}`;
  if (!row.sheetRef) await db.logRow.update({ where: { id: row.id }, data: { sheetRef: ref } });
  await enqueue(db, "log", ref, {
    type: "log.set",
    tab: logTabName(date),
    row: row.rowIndex + 2,
    isNew,
    values: LOG_COLS.map((k) => (row as Record<string, unknown>)[k] ?? ""),
  });
}

export async function queueLogRowsWhere(db: Tx, where: Prisma.LogRowWhereInput) {
  for (const r of await db.logRow.findMany({ where })) await queueLogRow(db, r);
}

/** Next free row on a day tab (rows the sheet already has are known from its pushes). */
export async function nextLogIndex(db: Tx, date: Date) {
  const last = await db.logRow.findFirst({ where: { date }, orderBy: { rowIndex: "desc" }, select: { rowIndex: true } });
  return last ? last.rowIndex + 1 : 0;
}

/**
 * The script inside a sheet asks for its waiting changes about once a minute.
 * Only the newest change per row is sent; older ones are closed with it.
 */
export async function pullOps(sheet: SheetKind) {
  const pending = await prisma.sheetOutbox.findMany({ where: { sheet, sentAt: null }, orderBy: { createdAt: "asc" }, take: 300 });
  const latest = new Map<string, (typeof pending)[number]>();
  for (const p of pending) latest.set(`${p.ref ?? p.id}|${(p.op as { type?: string }).type}`, p);
  return [...latest.values()].map((p) => ({ id: p.id, ...(p.op as object) }));
}

/** The script reports what it wrote. For a new log row it also says which sheet row it landed on. */
export async function ackOps(sheet: SheetKind, results: { id: string; ok: boolean; row?: number; error?: string }[]) {
  for (const r of results) {
    const item = await prisma.sheetOutbox.findUnique({ where: { id: r.id } });
    if (!item || item.sheet !== sheet) continue;
    if (!r.ok) {
      await prisma.sheetOutbox.update({
        where: { id: item.id },
        // After 20 failed tries the change is given up, so one bad row cannot block the sheet for ever.
        data: { tries: { increment: 1 }, lastError: (r.error ?? "failed").slice(0, 300), sentAt: item.tries >= 19 ? new Date() : null },
      });
      continue;
    }
    const type = (item.op as { type?: string }).type;
    await prisma.sheetOutbox.updateMany({
      where: { sheet, sentAt: null, ref: item.ref ?? undefined, createdAt: { lte: item.createdAt }, ...(item.ref ? {} : { id: item.id }) },
      data: { sentAt: new Date() },
    });
    if (type === "log.set" && item.ref && r.row) {
      const [, date, idx] = item.ref.split(":");
      const actual = r.row - 2;
      if (actual !== Number(idx)) {
        const newRef = `log:${date}:${actual}`;
        await prisma.logRow.deleteMany({ where: { sheetRef: newRef } });
        await prisma.logRow.updateMany({ where: { sheetRef: item.ref }, data: { sheetRef: newRef, rowIndex: actual } });
        await prisma.sheetOutbox.updateMany({ where: { ref: item.ref, sentAt: null }, data: { ref: newRef } });
      }
    }
  }
  await patchSheetConfig((c) => { (c.lastSend ??= {})[sheet] = { at: new Date().toISOString(), ok: results.every((r) => r.ok), error: results.find((r) => !r.ok)?.error }; });
}
