"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { AttError, addOfficeWifi, checkIn, checkOut, clock, getAttRules, isLate, saveAttRules, timeFor } from "@/lib/attendance";

type Wifi = { bssid?: string; ssid?: string } | null;
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

/** Check in or out. `wifi` comes from the mobile app, which reads the router's MAC ID. */
export async function attCheckAction(kind: "in" | "out", wifi: Wifi): Promise<{ ok?: string; e?: string }> {
  try {
    const u = await requireUser();
    if (!u.can("attendance") || u.external) throw new AttError("Attendance is not turned on for you");
    const a = kind === "in" ? await checkIn(u.id, wifi) : await checkOut(u.id, wifi);
    revalidatePath("/", "layout");
    return { ok: kind === "in" ? `Checked in at ${clock(a.checkIn)}${a.late ? " (late)" : ""}.` : `Checked out at ${clock(a.checkOut)}.` };
  } catch (err) { return fail(err); }
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
    await prisma.attendance.deleteMany({ where: { userId, date } });
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
