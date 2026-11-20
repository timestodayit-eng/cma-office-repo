"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteShots, getMonitorRules, saveMonitorRules, mb, shotPath, type MonitorRules } from "@/lib/monitor";
import { cutTime, getCats, saveCats, catKey, SLOT_MS, type Cat } from "@/lib/timetrack";
import { notify } from "@/lib/notify";
import { unlink } from "node:fs/promises";

const s = (f: FormData, k: string) => (f.get(k)?.toString() ?? "").trim();
const back = (q: Record<string, string>): never => redirect(`/monitor?${new URLSearchParams(q)}`);
const num = (v: string, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
/** Dhaka calendar day "2026-11-18" -> the UTC moment it starts. */
const dhakaStart = (d: string) => new Date(new Date(d + "T00:00:00Z").getTime() - 6 * 3600_000);

async function admin() {
  const u = await requireUser();
  if (!u.has("monitor")) redirect("/?denied=monitor");
  return u;
}

export async function monSaveRulesAction(f: FormData) {
  const u = await admin();
  const cur = await getMonitorRules();
  const minMin = num(s(f, "minMin"), 1, 60, cur.minMin);
  const maxMin = Math.max(minMin, num(s(f, "maxMin"), 1, 120, cur.maxMin));
  await saveMonitorRules({
    minMin, maxMin,
    idleMin: num(s(f, "idleMin"), 1, 60, cur.idleMin),
    keepDays: num(s(f, "keepDays"), 0, 365, cur.keepDays),
    live: s(f, "live") === "on",
    perTen: num(s(f, "perTen"), 0, 3, cur.perTen),
    blur: s(f, "blur") === "on",
    idleMode: (["ask", "keep", "discard"].includes(s(f, "idleMode")) ? s(f, "idleMode") : cur.idleMode) as MonitorRules["idleMode"],
    staffDelete: s(f, "staffDelete") === "on",
    manual: s(f, "manual") === "on",
  });
  await prisma.auditLog.create({ data: { userId: u.id, action: "monitor.rules", entity: "Setting", entityId: "monitor", data: { minMin, maxMin } as never } }).catch(() => {});
  revalidatePath("/monitor");
  back({ tab: "settings", ok: "Saved. The desktop apps pick up the new rules within a minute." });
}

export async function monDeleteAction(f: FormData) {
  const u = await admin();
  if (s(f, "sure") !== "on") back({ tab: "settings", e: "Tick the box to confirm the delete." });
  const userId = s(f, "userId") || undefined;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(s(f, "from")) ? dhakaStart(s(f, "from")) : undefined;
  const toDay = s(f, "to");
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toDay) ? new Date(dhakaStart(toDay).getTime() + 86_400_000) : undefined;
  if (!from && !to && !userId && s(f, "all") !== "on") back({ tab: "settings", e: "Choose dates or a person. To delete every screenshot, tick “Everything”." });
  const r = await deleteShots({ userId, from, to });
  await prisma.auditLog.create({ data: { userId: u.id, action: "monitor.delete", entity: "Screenshot", entityId: userId ?? "all", data: { from: s(f, "from"), to: toDay, n: r.n } as never } }).catch(() => {});
  revalidatePath("/monitor");
  const ret = s(f, "return");
  if (ret === "person" && userId) back({ user: userId, day: s(f, "from"), ok: `Deleted ${r.n} screenshots (${mb(r.bytes)}).` });
  back({ tab: "settings", ok: `Deleted ${r.n} screenshots and freed ${mb(r.bytes)}.` });
}

// ---------- time tracker ----------

const backTo = (path: string, q: Record<string, string>): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(q)}`);
/** Only same-site paths, so a form cannot send people elsewhere. */
const safePath = (v: string, d: string) => (/^\/(monitor|mytime)(\?[\w=&%.-]*)?$/.test(v) ? v : d);

/** Label an app or website Productive / Neutral / Unproductive, for everyone or for one team (department). */
export async function monSaveCatAction(f: FormData) {
  await admin();
  const name = s(f, "name").slice(0, 80);
  const cat = s(f, "cat") as Cat | "-";
  const dept = s(f, "dept");
  const ret = safePath(s(f, "return"), "/monitor?tab=apps");
  if (!name || !["P", "N", "U", "-"].includes(cat)) backTo(ret, { e: "Choose an app or site and a label." });
  const c = await getCats();
  const k = catKey(name);
  const table = dept ? { ...(c.dept[dept] ?? {}) } : { ...c.all };
  if (cat === "-") delete table[k]; else table[k] = cat;
  if (dept) c.dept[dept] = table; else c.all = table;
  await saveCats(c);
  revalidatePath("/monitor");
  backTo(ret, { ok: `${name}: ${cat === "-" ? "label removed" : { P: "Productive", N: "Neutral", U: "Unproductive" }[cat]}${dept ? ` for ${dept}` : ""}.` });
}

/** Approve or reject a manual time request. */
export async function monDecideManualAction(decision: "approve" | "reject", f: FormData) {
  const u = await admin();
  const id = s(f, "id");
  const approve = decision === "approve";
  const e = await prisma.timeEntry.findUnique({ where: { id } });
  if (!e || e.kind !== "MANUAL" || e.status !== "PENDING") backTo("/monitor?tab=approvals", { e: "This request was already decided." });
  if (e!.userId === u.id) backTo("/monitor?tab=approvals", { e: "You cannot approve your own time." });
  await prisma.timeEntry.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: u.id, decidedAt: new Date() } });
  await notify([e!.userId], {
    kind: "time",
    title: approve ? "Manual time approved" : "Manual time not approved",
    body: `${Math.round(e!.sec / 60)} min, ${e!.reason ?? ""}`.trim(),
    link: "/mytime",
  });
  revalidatePath("/monitor"); revalidatePath("/mytime");
  backTo("/monitor?tab=approvals", { ok: approve ? "Approved. The time is added to the timesheet." : "Rejected." });
}

/** An admin deletes one screenshot (the time stays). */
export async function monShotDeleteAction(f: FormData) {
  const u = await admin();
  const shot = await prisma.screenshot.findUnique({ where: { id: s(f, "id") } });
  const ret = safePath(s(f, "return"), "/monitor");
  if (!shot) backTo(ret, { e: "Already deleted." });
  await unlink(shotPath(shot!.file)).catch(() => {});
  await prisma.screenshot.delete({ where: { id: shot!.id } });
  await prisma.auditLog.create({ data: { userId: u.id, action: "monitor.shot.delete", entity: "Screenshot", entityId: shot!.id, data: { of: shot!.userId } as never } }).catch(() => {});
  revalidatePath("/monitor");
  backTo(ret, { ok: "Screenshot deleted." });
}

/** A person deletes their own screenshot: the 10 minutes around it leave their time (Hubstaff rule). */
export async function myShotDeleteAction(f: FormData) {
  const u = await requireUser();
  const rules = await getMonitorRules();
  const ret = safePath(s(f, "return"), "/mytime");
  if (!rules.staffDelete) backTo(ret, { e: "Deleting your own screenshots is turned off." });
  const shot = await prisma.screenshot.findUnique({ where: { id: s(f, "id") }, include: { session: true } });
  if (!shot || shot.userId !== u.id) backTo(ret, { e: "Screenshot not found." });
  const sess = shot!.session;
  const slot = Math.floor(shot!.takenAt.getTime() / SLOT_MS) * SLOT_MS;
  const a = new Date(Math.max(slot, sess.startedAt.getTime()));
  const b = new Date(Math.min(slot + SLOT_MS, (sess.endedAt ?? sess.lastBeatAt).getTime(), Date.now()));
  const sec = await cutTime(u.id, "CUT_SHOT", a, b > a ? b : new Date(a.getTime() + 1000), sess.id, "Screenshot deleted by the person");
  // cutTime removes every picture in that range; make sure this one is gone even if the range was empty
  if (await prisma.screenshot.findUnique({ where: { id: shot!.id } })) {
    await unlink(shotPath(shot!.file)).catch(() => {});
    await prisma.screenshot.delete({ where: { id: shot!.id } });
  }
  revalidatePath("/mytime"); revalidatePath("/monitor");
  backTo(ret, { ok: `Screenshot deleted. ${Math.round(sec / 60)} min removed from your time.` });
}

const hhmm = (v: string) => /^\d{2}:\d{2}$/.test(v);

/** Ask for manual time (worked away from the computer). A Work Monitor admin approves it. */
export async function myManualAction(f: FormData) {
  const u = await requireUser();
  const rules = await getMonitorRules();
  if (!rules.manual) backTo("/mytime", { e: "Manual time is turned off." });
  const day = s(f, "day"), from = s(f, "from"), to = s(f, "to"), reason = s(f, "reason").slice(0, 300);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !hhmm(from) || !hhmm(to)) backTo("/mytime", { e: "Write the day, start and end time." });
  if (!reason) backTo("/mytime", { e: "Write what you were doing." });
  // Dhaka times -> UTC
  const a = new Date(`${day}T${from}:00+06:00`), b = new Date(`${day}T${to}:00+06:00`);
  if (!(b > a)) backTo("/mytime", { e: "The end time must be after the start time." });
  if (b.getTime() > Date.now() + 60_000) backTo("/mytime", { e: "Manual time cannot be in the future." });
  if (Date.now() - a.getTime() > 31 * 86_400_000) backTo("/mytime", { e: "Only the last 31 days." });
  const sec = Math.round((b.getTime() - a.getTime()) / 1000);
  if (sec > 12 * 3600) backTo("/mytime", { e: "At most 12 hours at a time." });
  const overlap = await prisma.workSession.findFirst({ where: { userId: u.id, startedAt: { lt: b }, OR: [{ endedAt: null }, { endedAt: { gt: a } }] } });
  if (overlap) backTo("/mytime", { e: "Part of this time is already tracked by the desktop app. Choose time outside your work sessions." });
  await prisma.timeEntry.create({ data: { userId: u.id, kind: "MANUAL", from: a, to: b, sec, reason, status: "PENDING" } });
  const admins = await prisma.user.findMany({
    where: { active: true, id: { not: u.id }, OR: [{ level: "SUPER_ADMIN" }, { responsibilities: { some: { key: "monitor" } } }] },
    select: { id: true },
  });
  await notify(admins.map((x) => x.id), { kind: "time", title: `${u.name} asked for manual time`, body: `${day} ${from}–${to}: ${reason}`, link: "/monitor?tab=approvals" });
  revalidatePath("/mytime"); revalidatePath("/monitor");
  backTo("/mytime", { ok: "Sent. You will be told when it is approved." });
}

export async function myManualCancelAction(f: FormData) {
  const u = await requireUser();
  await prisma.timeEntry.updateMany({ where: { id: s(f, "id"), userId: u.id, kind: "MANUAL", status: "PENDING" }, data: { status: "CANCELLED" } });
  revalidatePath("/mytime");
  backTo("/mytime", { ok: "Request cancelled." });
}
