"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteShots, getMonitorRules, saveMonitorRules, mb } from "@/lib/monitor";

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
