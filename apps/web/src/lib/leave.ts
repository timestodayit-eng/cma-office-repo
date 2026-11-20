// Leave applications. Staff ask for leave from one day to another; HR / CEO (the "attendance"
// duty or super admin) approve or reject it and decide paid or unpaid. Approved leave becomes
// LEAVE days in Attendance, and payroll cuts unpaid leave days.
import { prisma } from "./db";
import { notify } from "./notify";
import { getAttRules, timeFor, AttError } from "./attendance";
import { fmtDay, todayDhaka } from "./format";

export const LEAVE_TYPES: Record<string, string> = {
  CASUAL: "Casual leave",
  SICK: "Sick leave",
  EMERGENCY: "Emergency / family",
  UNPAID: "Unpaid leave",
  OTHER: "Other",
};
const DAY = 86400_000;
const isoDay = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T00:00:00Z") : null);
export const rangeLabel = (a: Date, b: Date) =>
  a.getTime() === b.getTime() ? fmtDay(a, { weekday: "short", day: "numeric", month: "short" })
    : `${fmtDay(a, { day: "numeric", month: "short" })} – ${fmtDay(b, { day: "numeric", month: "short" })}`;

/** Working days of this person between two dates (their weekly off days are left out). */
export async function leaveDays(userId: string, from: Date, to: Date) {
  const off = timeFor(await getAttRules(), userId).weeklyOff;
  const out: Date[] = [];
  for (let d = from; d <= to; d = new Date(d.getTime() + DAY)) if (!off.includes(d.getUTCDay())) out.push(d);
  return out;
}

/** People who approve leave: super admins and the "Attendance admin" duty (Khalid Sir, Jamil). */
export async function leaveApprovers() {
  return prisma.user.findMany({
    where: { active: true, OR: [{ level: "SUPER_ADMIN" }, { responsibilities: { some: { key: "attendance" } } }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function applyLeave(userId: string, f: { from: string; to: string; type: string; reason: string }) {
  const from = isoDay(f.from), to = isoDay(f.to || f.from);
  if (!from || !to) throw new AttError("Choose the first and the last day of the leave.");
  if (to < from) throw new AttError("The last day cannot be before the first day.");
  if ((to.getTime() - from.getTime()) / DAY > 60) throw new AttError("One application can be at most 60 days.");
  if (from.getTime() < todayDhaka().getTime() - 31 * DAY) throw new AttError("Leave older than one month cannot be applied for. Ask HR to correct it.");
  if (!LEAVE_TYPES[f.type]) throw new AttError("Choose the type of leave.");
  const reason = f.reason.trim().slice(0, 1000);
  if (reason.length < 3) throw new AttError("Write the reason for the leave.");
  const days = (await leaveDays(userId, from, to)).length;
  if (!days) throw new AttError("These days are all your weekly off days. No leave is needed.");
  const clash = await prisma.leaveRequest.findFirst({
    where: { userId, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: to }, toDate: { gte: from } },
  });
  if (clash) throw new AttError(`You already have a leave application for ${rangeLabel(clash.fromDate, clash.toDate)}.`);
  const req = await prisma.leaveRequest.create({ data: { userId, fromDate: from, toDate: to, days, type: f.type, reason } });
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const approvers = (await leaveApprovers()).map((a) => a.id).filter((id) => id !== userId);
  await notify(approvers, {
    kind: "hr",
    title: `${me?.name ?? "Someone"} asks for leave: ${rangeLabel(from, to)} (${days} day${days > 1 ? "s" : ""})`,
    body: `${LEAVE_TYPES[f.type]}. Reason: ${reason}`,
    link: "/attendance?tab=leave",
  });
  return req;
}

/** Approve (paid or unpaid) or reject. Approving writes LEAVE into each working day. */
export async function decideLeave(id: string, by: string, d: { approve: boolean; paid: boolean; note: string }) {
  const req = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!req) throw new AttError("This application was not found.");
  if (req.status !== "PENDING") throw new AttError("This application was already answered.");
  if (req.userId === by) throw new AttError("You cannot approve your own leave. The other approver will do it.");
  const note = d.note.trim().slice(0, 500) || null;
  const paid = d.approve ? d.paid : null;
  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id }, data: { status: d.approve ? "APPROVED" : "REJECTED", paid, decidedById: by, decidedAt: new Date(), decisionNote: note } });
    if (!d.approve) return;
    const days = await leaveDays(req.userId, req.fromDate, req.toDate);
    const existing = await tx.attendance.findMany({ where: { userId: req.userId, date: { in: days } } });
    for (const date of days) {
      // a day the person really came to the office stays as it is
      if (existing.some((e) => e.date.getTime() === date.getTime() && e.checkIn)) continue;
      const data = { status: "LEAVE", checkIn: null, checkOut: null, late: false, method: "leave", leaveId: id, paidLeave: d.paid, note: `${LEAVE_TYPES[req.type] ?? "Leave"} (${d.paid ? "paid" : "unpaid"})`, editedById: by };
      await tx.attendance.upsert({ where: { userId_date: { userId: req.userId, date } }, update: data, create: { userId: req.userId, date, ...data } });
    }
  });
  const who = await prisma.user.findUnique({ where: { id: by }, select: { name: true } });
  await notify([req.userId], {
    kind: "hr",
    title: d.approve
      ? `Your leave ${rangeLabel(req.fromDate, req.toDate)} is approved (${d.paid ? "paid" : "unpaid"})`
      : `Your leave ${rangeLabel(req.fromDate, req.toDate)} is not approved`,
    body: [`By ${who?.name ?? "HR"}`, note].filter(Boolean).join(". "),
    link: "/attendance?tab=leave",
  });
  await prisma.auditLog.create({ data: { userId: by, action: d.approve ? "leave.approve" : "leave.reject", entity: "leave", data: { id, paid } } });
}

/** The person takes back a waiting application; HR / CEO can also cancel an approved one. */
export async function cancelLeave(id: string, by: string, isAdmin: boolean) {
  const req = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!req) throw new AttError("This application was not found.");
  const own = req.userId === by;
  if (req.status === "PENDING" && !own && !isAdmin) throw new AttError("Only the person or HR can cancel this.");
  if (req.status === "APPROVED" && !isAdmin) throw new AttError("Approved leave can be cancelled only by HR / CEO.");
  if (req.status !== "PENDING" && req.status !== "APPROVED") throw new AttError("This application is already closed.");
  await prisma.$transaction([
    prisma.attendance.deleteMany({ where: { leaveId: id } }),
    prisma.leaveRequest.update({ where: { id }, data: { status: "CANCELLED", decidedById: req.status === "APPROVED" ? by : req.decidedById, decidedAt: new Date() } }),
  ]);
  if (!own) await notify([req.userId], { kind: "hr", title: `Your leave ${rangeLabel(req.fromDate, req.toDate)} was cancelled by HR`, link: "/attendance?tab=leave" });
}
