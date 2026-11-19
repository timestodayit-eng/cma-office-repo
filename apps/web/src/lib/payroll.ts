// Payroll: each person's pay is set separately; the month is worked out from attendance,
// an admin can change it, and "Finalise" freezes it.
import { prisma } from "./db";
import { getAttRules, timeFor, type AttRules } from "./attendance";
import { todayDhaka } from "./format";

export type PersonPay = { basic: number; allowance: number; note?: string };
export type PayRules = {
  /** A day's pay = basic / this. */
  daysInMonth: number;
  /** Cut pay for days with no attendance. */
  cutAbsent: boolean;
  /** This many late days cut one day's pay. 0 = late days cut nothing. */
  latesPerDay: number;
  /** Absence is counted only from this day on (the day attendance really started). "" = from the first check-in in the app. */
  countFrom: string;
  /** Working hours of one day; one overtime hour is paid basic / daysInMonth / this. */
  hoursPerDay: number;
  people: Record<string, PersonPay>;
};
export const DEFAULT_PAY: PayRules = { daysInMonth: 30, cutAbsent: true, latesPerDay: 3, countFrom: "", hoursPerDay: 8, people: {} };

export async function getPayRules(): Promise<PayRules> {
  const s = await prisma.setting.findUnique({ where: { key: "payroll" } });
  return { ...DEFAULT_PAY, ...((s?.value as Partial<PayRules> | undefined) ?? {}) };
}
export async function savePayRules(patch: Partial<PayRules>) {
  const value = { ...(await getPayRules()), ...patch };
  await prisma.setting.upsert({ where: { key: "payroll" }, update: { value: value as never }, create: { key: "payroll", value: value as never } });
  return value;
}

export type PayLine = {
  userId: string; name: string; designation: string | null;
  basic: number; allowance: number; hasPay: boolean;
  workDays: number; present: number; late: number; leave: number; absent: number;
  autoUnpaid: number; unpaidDays: number; edited: boolean;
  otHours: number; hourRate: number; otPay: number;
  dayRate: number; cut: number; bonus: number; deduction: number; net: number;
  note: string | null; status: "DRAFT" | "FINAL";
};

export const monthOf = (d: Date) => d.toISOString().slice(0, 7);
export const validMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const round = (n: number) => Math.round(n);

/** Pure sum, so the edit form and the saved slip always agree. */
export function sumLine(basic: number, allowance: number, unpaidDays: number, bonus: number, deduction: number, daysInMonth: number, otHours = 0, hoursPerDay = 8) {
  const dayRate = daysInMonth > 0 ? basic / daysInMonth : 0;
  const hourRate = hoursPerDay > 0 ? dayRate / hoursPerDay : 0;
  const cut = round(dayRate * unpaidDays);
  const otPay = round(hourRate * otHours);
  return { dayRate: round(dayRate), hourRate: Math.round(hourRate * 100) / 100, cut, otPay, net: round(basic + allowance + bonus + otPay - cut - deduction) };
}

/** Working days of the month for one person, up to `until`, starting at `from`. */
function workDays(month: string, off: number[], from: Date, until: Date) {
  const [y, m] = month.split("-").map(Number);
  const out: number[] = [];
  for (let d = new Date(Date.UTC(y, m - 1, 1)); d.getUTCMonth() === m - 1; d = new Date(d.getTime() + 86400_000)) {
    if (d < from || d > until) continue;
    if (!off.includes(d.getUTCDay())) out.push(d.getTime());
  }
  return out;
}

/** The pay sheet of a month. Pass userId for one person's slip. */
export async function paySheet(month: string, onlyUserId?: string): Promise<{ lines: PayLine[]; rules: PayRules; att: AttRules; countFrom: Date | null }> {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const today = todayDhaka();
  const until = end < today ? end : today;
  const [rules, att, people, rows, slips, first] = await Promise.all([
    getPayRules(), getAttRules(),
    prisma.user.findMany({ where: { active: true, external: false, ...(onlyUserId ? { id: onlyUserId } : {}) }, orderBy: { name: "asc" } }),
    prisma.attendance.findMany({ where: { date: { gte: start, lte: end }, ...(onlyUserId ? { userId: onlyUserId } : {}) } }),
    prisma.payslip.findMany({ where: { month, ...(onlyUserId ? { userId: onlyUserId } : {}) } }),
    // demo days do not start the absence count
    prisma.attendance.findFirst({ where: { OR: [{ note: null }, { note: { not: "DEMO" } }] }, orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  const countFrom = /^\d{4}-\d{2}-\d{2}$/.test(rules.countFrom) ? new Date(rules.countFrom + "T00:00:00Z") : first?.date ?? null;
  const lines = people.map((p): PayLine => {
    const slip = slips.find((s) => s.userId === p.id);
    if (slip?.status === "FINAL" && slip.final) return { otHours: 0, hourRate: 0, otPay: 0, ...(slip.final as unknown as Partial<PayLine>), status: "FINAL" } as PayLine;
    const pay = rules.people[p.id];
    const mine = rows.filter((r) => r.userId === p.id);
    const days = countFrom ? workDays(month, timeFor(att, p.id).weeklyOff, countFrom, until) : [];
    const byDay = new Map(mine.map((r) => [r.date.getTime(), r]));
    const present = mine.filter((r) => r.status === "PRESENT").length;
    const late = mine.filter((r) => r.late).length;
    const leave = mine.filter((r) => r.status === "LEAVE").length;
    // days marked absent, plus working days with no entry at all since attendance started
    const absent = mine.filter((r) => r.status === "ABSENT").length + days.filter((d) => !byDay.get(d)).length;
    const autoUnpaid = (rules.cutAbsent ? absent : 0) + (rules.latesPerDay > 0 ? Math.floor(late / rules.latesPerDay) : 0);
    const unpaidDays = slip?.unpaidDays != null ? Number(slip.unpaidDays) : autoUnpaid;
    const basic = pay?.basic ?? 0, allowance = pay?.allowance ?? 0;
    const bonus = Number(slip?.bonus ?? 0), deduction = Number(slip?.deduction ?? 0), otHours = Number(slip?.overtimeHours ?? 0);
    return {
      userId: p.id, name: p.name, designation: p.designation, basic, allowance, hasPay: !!pay,
      workDays: days.length, present, late, leave, absent, autoUnpaid, unpaidDays, edited: slip?.unpaidDays != null,
      otHours, ...sumLine(basic, allowance, unpaidDays, bonus, deduction, rules.daysInMonth, otHours, rules.hoursPerDay), bonus, deduction,
      note: slip?.note ?? null, status: "DRAFT",
    };
  });
  return { lines, rules, att, countFrom };
}
