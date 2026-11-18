"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getPayRules, savePayRules, paySheet, validMonth } from "@/lib/payroll";

const s = (f: FormData, k: string) => (f.get(k)?.toString() ?? "").trim();
const money = (f: FormData, k: string) => Math.max(0, Math.round(Number(s(f, k).replace(/,/g, "")) || 0));
const back = (q: string, msg: { e?: string; ok?: string }): never => redirect(`/payroll?${q}&${new URLSearchParams(msg as Record<string, string>)}`);

/** Only the people with the "Payroll admin" duty (and super admins). */
async function admin(q: string) {
  const u = await requireUser();
  if (!u.has("payroll")) back(q, { e: "Only payroll admins can do this" });
  return u;
}

export async function paySavePersonAction(f: FormData) {
  const me = await admin("tab=setup");
  const userId = s(f, "userId");
  if (!userId) back("tab=setup", { e: "Choose a person" });
  const r = await getPayRules();
  const people = { ...r.people };
  if (f.get("mode") === "clear") delete people[userId];
  else people[userId] = { basic: money(f, "basic"), allowance: money(f, "allowance"), note: s(f, "note") || undefined };
  await savePayRules({ people });
  await prisma.auditLog.create({ data: { userId: me.id, action: "payroll.salary", entity: "user", data: { userId } } });
  revalidatePath("/payroll");
  back("tab=setup", { ok: "Salary saved." });
}

export async function paySaveRulesAction(f: FormData) {
  await admin("tab=setup");
  const from = s(f, "countFrom");
  await savePayRules({
    daysInMonth: Math.min(31, Math.max(1, Math.round(Number(s(f, "daysInMonth")) || 30))),
    cutAbsent: f.get("cutAbsent") === "on",
    latesPerDay: Math.min(31, Math.max(0, Math.round(Number(s(f, "latesPerDay")) || 0))),
    countFrom: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : "",
  });
  revalidatePath("/payroll");
  back("tab=setup", { ok: "Rules saved." });
}

/** Change one person's month: unpaid days, bonus, deduction, note. */
export async function payEditLineAction(f: FormData) {
  await admin("");
  const month = s(f, "month"), userId = s(f, "userId");
  const q = `month=${month}`;
  if (!validMonth(month) || !userId) back("", { e: "Month and person are needed" });
  const ex = await prisma.payslip.findUnique({ where: { userId_month: { userId, month } } });
  if (ex?.status === "FINAL") back(q, { e: "This month is final for this person. Reopen it first." });
  const raw = s(f, "unpaidDays");
  const unpaid = raw === "" || f.get("mode") === "auto" ? null : Math.min(31, Math.max(0, Math.round(Number(raw) * 2) / 2 || 0));
  const data = { unpaidDays: unpaid, bonus: money(f, "bonus"), deduction: money(f, "deduction"), note: s(f, "note") || null };
  await prisma.payslip.upsert({ where: { userId_month: { userId, month } }, update: data, create: { userId, month, ...data } });
  revalidatePath("/payroll");
  back(q, { ok: "Saved." });
}

/** Freeze the month for everyone who has a salary set, or open it again. */
export async function payFinaliseAction(f: FormData) {
  const me = await admin("");
  const month = s(f, "month");
  const q = `month=${month}`;
  if (!validMonth(month)) back("", { e: "Choose a month" });
  if (f.get("mode") === "reopen") {
    await prisma.payslip.updateMany({ where: { month, status: "FINAL" }, data: { status: "DRAFT", final: Prisma.DbNull, finalizedAt: null, finalizedById: null } });
    await prisma.auditLog.create({ data: { userId: me.id, action: "payroll.reopen", entity: "payslip", data: { month } } });
    revalidatePath("/payroll");
    back(q, { ok: "Month opened again." });
  }
  const { lines } = await paySheet(month);
  const todo = lines.filter((l) => l.hasPay && l.status !== "FINAL");
  if (!todo.length) back(q, { e: "Nobody has a salary set yet. Set salaries in Salary setup first." });
  for (const l of todo) {
    const data = { status: "FINAL", final: { ...l, status: "FINAL" } as never, finalizedAt: new Date(), finalizedById: me.id };
    await prisma.payslip.upsert({ where: { userId_month: { userId: l.userId, month } }, update: data, create: { userId: l.userId, month, bonus: l.bonus, deduction: l.deduction, ...data } });
  }
  await prisma.auditLog.create({ data: { userId: me.id, action: "payroll.finalise", entity: "payslip", data: { month, people: todo.length } } });
  revalidatePath("/payroll");
  back(q, { ok: `Final for ${todo.length} ${todo.length === 1 ? "person" : "people"}. Each person can now see their pay slip.` });
}
