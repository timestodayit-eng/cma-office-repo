"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { enqueue, queueLogRow, nextLogIndex } from "@/lib/outbox";

const FIELDS = ["title", "deadline", "priority", "company", "mainCategory", "contentType", "scriptWriter", "scriptLink", "presenter",
  "cinematographer", "videoEditor", "status", "thumbnail", "rawFile", "finalOutput", "comments", "uploadFacebook", "uploadYoutube",
  "uploadTiktok", "finalComments"] as const;

function read(f: FormData) {
  return Object.fromEntries(FIELDS.map((k) => [k, (f.get(k)?.toString() ?? "").trim() || null]));
}

export async function addLogRowAction(f: FormData) {
  const u = await requireUser();
  const day = f.get("day")!.toString();
  if (!u.can("logsheet", "EDIT")) redirect(`/logsheet?day=${day}&e=No edit access`);
  const date = new Date(day);
  const data = read(f);
  const rowIndex = await nextLogIndex(prisma, date);
  // SN is set automatically when a title is filled, like the sheet.
  const sn = data.title ? (await prisma.logRow.count({ where: { date, title: { not: null } } })) + 1 : null;
  const row = await prisma.logRow.create({ data: { ...data, date, rowIndex, sn } });
  await queueLogRow(prisma, row, true);
  await prisma.auditLog.create({ data: { userId: u.id, action: "create", entity: "logrow" } });
  revalidatePath("/logsheet");
  redirect(`/logsheet?day=${day}&ok=Row added`);
}

export async function saveLogRowAction(f: FormData) {
  const u = await requireUser();
  const day = f.get("day")!.toString();
  if (!u.can("logsheet", "EDIT")) redirect(`/logsheet?day=${day}&e=No edit access`);
  const id = f.get("id")!.toString();
  await queueLogRow(prisma, await prisma.logRow.update({ where: { id }, data: read(f) }));
  await prisma.auditLog.create({ data: { userId: u.id, action: "update", entity: "logrow", entityId: id } });
  revalidatePath("/logsheet");
  redirect(`/logsheet?day=${day}&ok=Saved`);
}

export async function tickBroadcastAction(f: FormData) {
  const u = await requireUser();
  if (!u.can("broadcast", "EDIT")) redirect("/broadcast?e=No edit access");
  const id = f.get("id")!.toString();
  const field = f.get("field")!.toString();
  const b = await prisma.broadcastSlot.findUniqueOrThrow({ where: { id }, include: { interview: { include: { company: true } } } });
  const tick = (received: boolean, missed: boolean) =>
    enqueue(prisma, "broadcast", `bc:${b.interviewId}:${b.slot}`, {
      type: "bc.tick", tab: b.interview.company.sheetTab ?? b.interview.company.name,
      co: b.interview.title, date: b.interview.interviewDate.toISOString().slice(0, 10), slot: Number(b.slot.slice(1)), received, missed,
    });
  const now = new Date();
  if (field === "missed") {
    await prisma.broadcastSlot.update({ where: { id }, data: { missedSent: true, missedAt: now, sentById: u.id } });
    await tick(b.receivedSent, true);
  }
  if (field === "sms") await prisma.broadcastSlot.update({ where: { id }, data: { smsSent: true, sentById: u.id } });
  if (field === "received") {
    if (!b.missedSent) redirect("/broadcast?e=Send the Missed call first");
    // Missed ticked in the Google Sheet has no time, so the 3 hour check is skipped for it.
    const hours = b.missedAt ? (now.getTime() - b.missedAt.getTime()) / 3_600_000 : 99;
    await prisma.broadcastSlot.update({ where: { id }, data: { receivedSent: true, receivedAt: now, sentById: u.id } });
    await tick(true, true);
    revalidatePath("/broadcast");
    if (hours < 3) redirect(`/broadcast?e=Saved, but only ${hours.toFixed(1)} hours after Missed (rule: 3+ hours)`);
  }
  await prisma.auditLog.create({ data: { userId: u.id, action: field, entity: "broadcast", entityId: id } });
  revalidatePath("/broadcast");
  redirect("/broadcast?ok=Saved");
}
