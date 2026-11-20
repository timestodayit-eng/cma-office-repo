// Timesheet as a CSV file (opens in Excel / Google Sheets). Only Work Monitor admins.
import { getUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { todayDhaka } from "@/lib/format";
import { workedByDay, sumDays, pct, isoDay, parseDay, addDays } from "@/lib/timetrack";

export const dynamic = "force-dynamic";

const cell = (v: string | number) => {
  const s = String(v);
  // keep spreadsheet formulas out, quote commas and quotes
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const hours = (sec: number) => (sec / 3600).toFixed(2);

export async function GET(req: Request) {
  const u = await getUser();
  if (!u?.has("monitor")) return new Response("Not allowed", { status: 403 });
  const q = new URL(req.url).searchParams;
  const today = todayDhaka();
  let from = parseDay(q.get("from")) ?? addDays(today, -6);
  let to = parseDay(q.get("to")) ?? today;
  if (to > today) to = today;
  if (from > to) from = to;
  if ((to.getTime() - from.getTime()) / 86_400_000 > 92) from = addDays(to, -92);
  const [people, totals] = await Promise.all([
    prisma.user.findMany({ where: { active: true, external: false }, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true, department: true } }),
    workedByDay(from, to),
  ]);
  const days: Date[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const lines = [["Name", "Designation", "Team", ...days.map(isoDay), "Total hours", "Activity %", "Manual hours", "Removed hours"].map(cell).join(",")];
  for (const p of people) {
    const m = totals.get(p.id);
    const t = sumDays(m);
    lines.push([p.name, p.designation ?? "", p.department ?? "", ...days.map((d) => hours(m?.get(isoDay(d))?.sec ?? 0)), hours(t.sec), pct(t) ?? "", hours(t.manual), hours(t.cut)].map(cell).join(","));
  }
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="timesheet-${isoDay(from)}-to-${isoDay(to)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
