"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getPayRules, savePayRules, paySheet, validMonth } from "@/lib/payroll";
import { getAttRules, timeFor } from "@/lib/attendance";
import { todayDhaka } from "@/lib/format";

const DEMO = "DEMO";

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
    hoursPerDay: Math.min(24, Math.max(1, Number(s(f, "hoursPerDay")) || 8)),
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
  const ot = Math.min(744, Math.max(0, Math.round(Number(s(f, "overtimeHours")) * 2) / 2 || 0));
  const data = { unpaidDays: unpaid, overtimeHours: ot, bonus: money(f, "bonus"), deduction: money(f, "deduction"), note: s(f, "note") || null };
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
    await prisma.payslip.upsert({ where: { userId_month: { userId: l.userId, month } }, update: data, create: { userId: l.userId, month, bonus: l.bonus, deduction: l.deduction, overtimeHours: l.otHours, ...data } });
  }
  await prisma.auditLog.create({ data: { userId: me.id, action: "payroll.finalise", entity: "payslip", data: { month, people: todo.length } } });
  revalidatePath("/payroll");
  back(q, { ok: `Final for ${todo.length} ${todo.length === 1 ? "person" : "people"}. Each person can now see their pay slip.` });
}

/**
 * Demo month so the salary sheet and the Google Sheet can be looked at before real figures exist:
 * everyone without a salary gets 10,000, everyone is present on time, and the admin who presses the button
 * is the example with 3 absent days, 2 late days and 40 overtime hours. Everything made here is marked DEMO.
 */
export async function payDemoAction(f: FormData) {
  const me = await admin("tab=setup");
  const r = await getPayRules();
  const people = { ...r.people };
  if (f.get("mode") === "clear") {
    for (const [id, p] of Object.entries(people)) if (p.note === DEMO) delete people[id];
    await savePayRules({ people });
    const gone = await prisma.attendance.deleteMany({ where: { note: DEMO } });
    await prisma.payslip.deleteMany({ where: { demo: true } });
    await prisma.auditLog.create({ data: { userId: me.id, action: "payroll.demo.clear", entity: "payroll", data: {} } });
    revalidatePath("/", "layout");
    back("tab=setup", { ok: `Demo data removed (${gone.count} demo attendance days). Real salaries and real check-ins were not touched.` });
  }
  const month = s(f, "month");
  if (!validMonth(month)) back("tab=setup", { e: "Choose the month for the demo" });
  const att = await getAttRules();
  const staff = await prisma.user.findMany({ where: { active: true, external: false }, orderBy: { name: "asc" }, select: { id: true } });
  const today = todayDhaka();
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)), end = new Date(Date.UTC(y, m, 1));
  const until = end < today ? end : today;
  const have = new Set((await prisma.attendance.findMany({ where: { date: { gte: first, lt: end } }, select: { userId: true, date: true } })).map((a) => a.userId + a.date.getTime()));
  const rows: Prisma.AttendanceCreateManyInput[] = [];
  const at = (day: Date, hhmm: string, plusMin = 0) => { const [h, mi] = hhmm.split(":").map(Number); return new Date(day.getTime() + ((h - 6) * 60 + mi + plusMin) * 60_000); };
  staff.forEach((p, i) => {
    people[p.id] ??= { basic: 10000, allowance: 0, note: DEMO };
    const t = timeFor(att, p.id);
    let n = 0;
    for (let d = first; d < until; d = new Date(d.getTime() + 86400_000)) {
      if (t.weeklyOff.includes(d.getUTCDay())) continue;
      n++;
      if (have.has(p.id + d.getTime())) continue;
      const absent = p.id === me.id && [3, 10, 17].includes(n), late = p.id === me.id && [6, 13].includes(n);
      rows.push(absent
        ? { userId: p.id, date: d, status: "ABSENT", method: "admin", note: DEMO, editedById: me.id }
        : { userId: p.id, date: d, status: "PRESENT", method: "admin", note: DEMO, editedById: me.id, late, checkIn: at(d, t.start, late ? t.graceMin + 12 : -((i * 3 + n) % 9)), checkOut: at(d, t.end, (i + n) % 8) });
    }
  });
  await savePayRules({ people });
  if (rows.length) await prisma.attendance.createMany({ data: rows, skipDuplicates: true });
  if (staff.some((p) => p.id === me.id) && !(await prisma.payslip.findUnique({ where: { userId_month: { userId: me.id, month } } }))) {
    await prisma.payslip.create({ data: { userId: me.id, month, overtimeHours: 40, demo: true, note: "DEMO: 40 hours overtime" } });
  }
  await prisma.auditLog.create({ data: { userId: me.id, action: "payroll.demo.fill", entity: "payroll", data: { month, days: rows.length } } });
  revalidatePath("/", "layout");
  redirect(`/payroll?month=${month}&${new URLSearchParams({ ok: `Demo month ready: ${rows.length} demo attendance days. You are the example with 3 absent days, 2 late days and 40 overtime hours.` })}`);
}
