"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canSendNotice } from "@/lib/notices";
import { notify } from "@/lib/notify";

const back = (msg: { e?: string; ok?: string }): never => redirect(`/notices?${new URLSearchParams(msg as Record<string, string>)}`);

export async function sendNoticeAction(f: FormData) {
  const me = await requireUser();
  if (!canSendNotice(me)) back({ e: "Only the CEO and the admin can send a notice" });
  const title = (f.get("title")?.toString() ?? "").trim().slice(0, 120);
  const body = (f.get("body")?.toString() ?? "").trim().slice(0, 4000);
  if (!title || !body) back({ e: "Write a heading and the notice" });
  const all = f.get("all") === "on";
  const depts = f.getAll("dept").map(String), companies = f.getAll("company").map(String), picked = f.getAll("user").map(String);
  if (!all && !depts.length && !companies.length && !picked.length) back({ e: "Choose who gets the notice" });

  const people = await prisma.user.findMany({
    where: {
      active: true, id: { not: me.id },
      ...(all ? {} : { OR: [{ department: { in: depts } }, { companyRoles: { some: { companyId: { in: companies } } } }, { id: { in: picked } }] }),
    },
    select: { id: true, name: true },
  });
  if (!people.length) back({ e: "Nobody matches that choice" });
  const coNames = companies.length ? (await prisma.company.findMany({ where: { id: { in: companies } }, select: { short: true } })).map((c) => c.short) : [];
  const only = picked.length ? people.filter((p) => picked.includes(p.id)).map((p) => p.name.split(" ")[0]) : [];
  const audience = all ? "Everyone" : [...depts.map((d) => `${d} team`), ...coNames.map((c) => `${c} people`), ...(only.length > 3 ? [`${only.length} people`] : only)].join(", ");

  const n = await prisma.notice.create({ data: { senderId: me.id, title, body, audience, reads: { create: people.map((p) => ({ userId: p.id })) } } });
  await prisma.auditLog.create({ data: { userId: me.id, action: "notice.send", entity: "notice", entityId: n.id, data: { to: people.length } } });
  await notify(people.map((p) => p.id), { kind: "hr", title: `Notice: ${title}`, body: body.slice(0, 200), link: "/notices" });
  revalidatePath("/", "layout");
  back({ ok: `Notice sent to ${people.length} ${people.length === 1 ? "person" : "people"}.` });
}

/** The person ticks "Yes, I have read it". */
export async function readNoticeAction(noticeId: string) {
  const me = await requireUser();
  await prisma.noticeRead.updateMany({ where: { noticeId, userId: me.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

export async function deleteNoticeAction(f: FormData) {
  const me = await requireUser();
  if (!canSendNotice(me)) back({ e: "Only the CEO and the admin can remove a notice" });
  await prisma.notice.deleteMany({ where: { id: f.get("id")?.toString() ?? "" } });
  revalidatePath("/", "layout");
  back({ ok: "Notice removed." });
}
