"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { AttError, addOfficeWifi, checkIn, checkOut, clock, getAttRules, isLate, saveAttRules, timeFor, type Shot } from "@/lib/attendance";
import { DEFAULT_TRACK, deleteSelfieFile, setSharing, trackOrder } from "@/lib/location";
import { applyLeave, cancelLeave, decideLeave } from "@/lib/leave";

type Wifi = { bssid?: string; ssid?: string; error?: string } | null;
type Order = Awaited<ReturnType<typeof trackOrder>>;
const s = (f: FormData, k: string) => (f.get(k)?.toString() ?? "").trim();
const back = (tab: string, msg: { e?: string; ok?: string }): never =>
  redirect(`/attendance?tab=${tab}&${new URLSearchParams(msg as Record<string, string>)}`);

async function admin() {
  const u = await requireUser();
  if (!u.has("attendance")) throw new AttError("Only HR / admin can do this");
  return u;
}
const fail = (err: unknown) => {
  if (err instanceof AttError) return { e: err.message };
  console.error("attendance", err);
  return { e: "Something went wrong. Please try again." };
};

/** Check in or out. `wifi` comes from the mobile app, which reads the router's MAC ID;
 *  `shot` is the selfie + GPS when the rules ask for one. `track` tells the phone to start / stop live location. */
export async function attCheckAction(kind: "in" | "out", wifi: Wifi, shot: Shot = null): Promise<{ ok?: string; e?: string; track?: Order }> {
  try {
    const u = await requireUser();
    if (!u.can("attendance") || u.external) throw new AttError("Attendance is not turned on for you");
    const a = kind === "in" ? await checkIn(u.id, wifi, shot) : await checkOut(u.id, wifi, shot);
    if (kind === "out") await setSharing(u.id, "stopped", "Checked out");
    revalidatePath("/", "layout");
    const where = a.method === "field" ? " (field, away from the office)" : "";
    return {
      ok: kind === "in" ? `Checked in at ${clock(a.checkIn)}${a.late ? " (late)" : ""}${where}.` : `Checked out at ${clock(a.checkOut)}.`,
      track: await trackOrder(u.id),
    };
  } catch (err) { return fail(err); }
}

/** The phone answered the live-location notice: agreed (and started) or not. */
export async function locConsentAction(agreed: boolean, why?: string) {
  const u = await requireUser();
  await setSharing(u.id, agreed ? "agreed" : "declined", agreed ? undefined : (why ?? "").slice(0, 120) || undefined);
  revalidatePath("/attendance");
}

/** The person turned live location off themselves. The admin sees that it was turned off. */
export async function locStopAction() {
  const u = await requireUser();
  await setSharing(u.id, "declined", "Turned off by the person");
  revalidatePath("/attendance");
}

/** The person wants to share again: clears "turned off" and gives the phone a fresh order. */
export async function locResumeAction(): Promise<Order> {
  const u = await requireUser();
  await prisma.locationStatus.updateMany({ where: { userId: u.id }, data: { declinedAt: null } });
  return trackOrder(u.id);
}

/** Selfie + live-location rules (Attendance admins). */
export async function attSaveLocRulesAction(f: FormData) {
  try { await admin(); } catch { back("rules", { e: "Only HR / admin can do this" }); }
  const n = (k: string, lo: number, hi: number, d: number) => { const v = Math.round(Number(s(f, k))); return Number.isFinite(v) && s(f, k) !== "" ? Math.min(hi, Math.max(lo, v)) : d; };
  const selfie = s(f, "selfie");
  await saveAttRules({
    selfie: selfie === "in" || selfie === "inout" ? selfie : "off",
    field: f.getAll("field").map(String),
    track: {
      on: f.get("trackOn") === "on",
      who: s(f, "who") === "some" ? "some" : "all",
      people: f.getAll("trackPeople").map(String),
      everyMin: n("everyMin", 1, 30, DEFAULT_TRACK.everyMin),
      afterEndMin: n("afterEndMin", 0, 600, DEFAULT_TRACK.afterEndMin),
      keepDays: n("keepDays", 1, 365, DEFAULT_TRACK.keepDays),
    },
  });
  revalidatePath("/", "layout");
  back("rules", { ok: "Selfie and live location rules saved." });
}

export async function attAddWifiAction(wifi: Wifi): Promise<{ ok?: string; e?: string }> {
  try {
    await admin();
    const r = await addOfficeWifi(wifi ?? {});
    revalidatePath("/attendance");
    return { ok: `Saved. Office WiFi: ${r.wifi[r.wifi.length - 1].ssid} (${r.wifi[r.wifi.length - 1].bssid}).` };
  } catch (err) { return fail(err); }
}

export async function attRemoveWifiAction(f: FormData) {
  try { await admin(); } catch { back("rules", { e: "Only HR / admin can do this" }); }
  const r = await getAttRules();
  await saveAttRules({ wifi: r.wifi.filter((w) => w.bssid !== s(f, "bssid")) });
  back("rules", { ok: "Removed." });
}

export async function attSaveRulesAction(f: FormData) {
  try { await admin(); } catch { back("rules", { e: "Only HR / admin can do this" }); }
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!hhmm.test(s(f, "start")) || !hhmm.test(s(f, "end"))) back("rules", { e: "Write the office time like 09:00 and 18:00" });
  const grace = Math.min(120, Math.max(0, Math.round(Number(s(f, "graceMin")) || 0)));
  await saveAttRules({ start: s(f, "start"), end: s(f, "end"), graceMin: grace, weeklyOff: f.getAll("weeklyOff").map(Number).filter((n) => n >= 0 && n <= 6) });
  back("rules", { ok: "Rules saved." });
}

/** Own office time for one person (shift, shorter day, other off day), or back to the default. */
export async function attSavePersonAction(f: FormData) {
  try { await admin(); } catch { back("rules", { e: "Only HR / admin can do this" }); }
  const userId = s(f, "userId");
  const r = await getAttRules();
  const people = { ...(r.people ?? {}) };
  if (f.get("mode") === "default") {
    delete people[userId];
  } else {
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!userId || !hhmm.test(s(f, "start")) || !hhmm.test(s(f, "end"))) back("rules", { e: "Write the time like 14:00 and 22:00" });
    people[userId] = {
      start: s(f, "start"), end: s(f, "end"),
      graceMin: Math.min(120, Math.max(0, Math.round(Number(s(f, "graceMin")) || 0))),
      weeklyOff: f.getAll("weeklyOff").map(Number).filter((n) => n >= 0 && n <= 6),
    };
  }
  await saveAttRules({ people });
  revalidatePath("/", "layout");
  back("rules", { ok: f.get("mode") === "default" ? "Back to the default office time." : "Saved for this person." });
}

/** HR / admin corrects one person's day: present with times, leave, absent, or clear. */
export async function attAdminSetAction(f: FormData) {
  let me: Awaited<ReturnType<typeof admin>>;
  try { me = await admin(); } catch { back("team", { e: "Only HR / admin can do this" }); }
  const userId = s(f, "userId"), day = s(f, "date"), status = s(f, "status");
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) back("team", { e: "Person and date are needed" });
  const date = new Date(day + "T00:00:00Z");
  const where = { userId_date: { userId, date } };
  const tab = `team&day=${day}`;
  if (status === "CLEAR") {
    const old = await prisma.attendance.findUnique({ where, select: { selfieIn: true, selfieOut: true } });
    await prisma.attendance.deleteMany({ where: { userId, date } });
    await deleteSelfieFile(old?.selfieIn); await deleteSelfieFile(old?.selfieOut);
    back(tab, { ok: "Cleared." });
  }
  const at = (k: string) => (/^\d{2}:\d{2}$/.test(s(f, k)) ? new Date(`${day}T${s(f, k)}:00+06:00`) : null);
  const r = await getAttRules();
  const present = status === "PRESENT";
  const cin = present ? at("in") : null;
  if (present && !cin) back(tab, { e: "Write the check-in time, like 09:05" });
  const data = { status: present ? "PRESENT" : status === "LEAVE" ? "LEAVE" : "ABSENT", checkIn: cin, checkOut: present ? at("out") : null, late: cin ? isLate(cin, timeFor(r, userId)) : false, method: "admin", note: s(f, "note") || null, editedById: me!.id };
  await prisma.attendance.upsert({ where, update: data, create: { userId, date, ...data } });
  await prisma.auditLog.create({ data: { userId: me!.id, action: "attendance.set", entity: "attendance", data: { userId, day, status: data.status } } });
  revalidatePath("/", "layout");
  back(tab, { ok: "Saved." });
}

/** Leave application: anyone with attendance applies; HR / CEO approve (paid or unpaid) or reject. */
export async function leaveApplyAction(f: FormData) {
  let msg: { e?: string; ok?: string };
  try {
    const u = await requireUser();
    if (!u.can("attendance") || u.external) throw new AttError("Attendance is not turned on for you");
    const r = await applyLeave(u.id, { from: s(f, "from"), to: s(f, "to"), type: s(f, "type"), reason: s(f, "reason") });
    msg = { ok: `Sent. ${r.days} day${r.days > 1 ? "s" : ""} of leave asked. You will get a notification when it is answered.` };
  } catch (err) { msg = fail(err); }
  revalidatePath("/", "layout");
  back("leave", msg);
}

export async function leaveDecideAction(how: "paid" | "unpaid" | "reject", f: FormData) {
  let msg: { e?: string; ok?: string };
  try {
    const u = await admin();
    if (how !== "paid" && how !== "unpaid" && how !== "reject") throw new AttError("Choose approve or reject.");
    await decideLeave(s(f, "id"), u.id, { approve: how !== "reject", paid: how === "paid", note: s(f, "note") });
    msg = { ok: how === "reject" ? "Rejected. The person is told." : `Approved as ${how === "paid" ? "paid" : "unpaid"} leave. Attendance and payroll are updated.` };
  } catch (err) { msg = fail(err); }
  revalidatePath("/", "layout");
  back("leave", msg);
}

export async function leaveCancelAction(f: FormData) {
  let msg: { e?: string; ok?: string };
  try {
    const u = await requireUser();
    await cancelLeave(s(f, "id"), u.id, u.has("attendance"));
    msg = { ok: "Cancelled." };
  } catch (err) { msg = fail(err); }
  revalidatePath("/", "layout");
  back("leave", msg);
}
