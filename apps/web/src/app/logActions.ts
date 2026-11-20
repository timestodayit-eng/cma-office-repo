"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { enqueue, queueLogRow, nextLogIndex } from "@/lib/outbox";
import { LOG_COLS } from "@/lib/sheetRules";

/** One cell typed in the Log Sheet grid. A blank row becomes a real row on its first cell. */
export async function saveLogCell(input: { id?: string; date: string; rowIndex: number; field: string; value: string }) {
  const u = await requireUser();
  if (!u.can("logsheet", "EDIT")) return { error: "No edit access" };
  if (!(LOG_COLS as readonly string[]).includes(input.field) || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "Unknown column" };
  const value = input.value.trim() || null;
  const date = new Date(input.date);
  let row;
  if (input.id) {
    row = await prisma.logRow.update({ where: { id: input.id }, data: { [input.field]: value } });
    await queueLogRow(prisma, row);
  } else {
    if (!value) return { ok: true as const };
    const taken = await prisma.logRow.findFirst({ where: { date, rowIndex: input.rowIndex }, select: { id: true } });
    const rowIndex = taken ? await nextLogIndex(prisma, date) : input.rowIndex;
    row = await prisma.logRow.create({ data: { date, rowIndex, [input.field]: value } });
    await queueLogRow(prisma, row, true);
  }
  // SN follows the titled rows in order, like the sheet.
  const titled = await prisma.logRow.findMany({ where: { date: row.date, title: { not: null } }, orderBy: { rowIndex: "asc" }, select: { id: true, sn: true } });
  await Promise.all(titled.map((t, i) => (t.sn === i + 1 ? null : prisma.logRow.update({ where: { id: t.id }, data: { sn: i + 1 } }))));
  await prisma.auditLog.create({ data: { userId: u.id, action: input.id ? "update" : "create", entity: "logrow", entityId: row.id, data: { field: input.field } } });
  revalidatePath("/logsheet");
  return { ok: true as const, id: row.id, rowIndex: row.rowIndex };
}

/** Tick one call day. A bridge day covers two interviews, so several slots can be ticked together. */
export async function tickBroadcastAction(f: FormData) {
  const u = await requireUser();
  const backTo = (f.get("back")?.toString() || "/broadcast").replace(/[?&](e|ok)=[^&]*/g, "");
  const say = (k: "e" | "ok", m: string): never => redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`);
  if (!u.can("broadcast", "EDIT")) say("e", "No edit access");
  const ids = f.get("ids")!.toString().split(",").filter(Boolean);
  const field = f.get("field")!.toString();
  const slots = await prisma.broadcastSlot.findMany({ where: { id: { in: ids } }, include: { interview: { include: { company: true } } } });
  const now = new Date();
  let early = 0;
  if (field === "received" && slots.some((b) => !b.missedSent)) say("e", "Send the Missed call first");
  for (const b of slots) {
    const on = field === "missed" ? !b.missedSent : field === "received" ? !b.receivedSent : !b.smsSent;
    // Missed cannot be taken back while Received is ticked.
    if (field === "missed" && !on && b.receivedSent) continue;
    const data =
      field === "missed" ? { missedSent: on, missedAt: on ? now : null }
      : field === "received" ? { receivedSent: on, receivedAt: on ? now : null }
      : { smsSent: on };
    const nb = await prisma.broadcastSlot.update({ where: { id: b.id }, data: { ...data, sentById: u.id } });
    // Missed ticked in the Google Sheet has no time, so the 3 hour check is skipped for it.
    if (field === "received" && on && b.missedAt) early = Math.max(early, 3 - (now.getTime() - b.missedAt.getTime()) / 3_600_000);
    if (field !== "sms") {
      await enqueue(prisma, "broadcast", `bc:${b.interviewId}:${b.slot}`, {
        type: "bc.tick", tab: b.interview.company.sheetTab ?? b.interview.company.name,
        co: b.interview.title, date: b.interview.interviewDate.toISOString().slice(0, 10), slot: Number(b.slot.slice(1)),
        received: nb.receivedSent, missed: nb.missedSent,
      });
    }
    await prisma.auditLog.create({ data: { userId: u.id, action: field, entity: "broadcast", entityId: b.id } });
  }
  revalidatePath("/", "layout");
  if (early > 0) say("e", `Saved, but Received was sent less than 3 hours after Missed (rule: 3+ hours)`);
  say("ok", "Saved");
}
