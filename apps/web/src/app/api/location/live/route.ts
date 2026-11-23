// Live map data for Attendance admins: everyone checked in today, their last point and their check-in selfie.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { todayDhaka } from "@/lib/format";
import { getAttRules } from "@/lib/attendance";
import { trackRules, tracksUser } from "@/lib/location";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await getUser();
  if (!u?.has("attendance")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const rules = await getAttRules();
  const t = trackRules(rules);
  const [people, att, st] = await Promise.all([
    prisma.user.findMany({ where: { active: true, external: false }, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true } }),
    prisma.attendance.findMany({ where: { date: todayDhaka() } }),
    prisma.locationStatus.findMany(),
  ]);
  const a = new Map(att.map((x) => [x.userId, x]));
  const s = new Map(st.map((x) => [x.userId, x]));
  return NextResponse.json({
    rules: { on: t.on, everyMin: t.everyMin },
    now: Date.now(),
    people: people.map((p) => {
      const x = a.get(p.id), y = s.get(p.id);
      return {
        id: p.id, name: p.name, designation: p.designation,
        tracked: tracksUser(t, p.id),
        status: x?.status ?? null, checkIn: x?.checkIn ?? null, checkOut: x?.checkOut ?? null, late: x?.late ?? false, method: x?.method ?? null,
        selfieIn: x?.selfieIn ? `/api/attendance/selfie/${x.id}?k=in` : null,
        selfieOut: x?.selfieOut ? `/api/attendance/selfie/${x.id}?k=out` : null,
        inAt: x?.inLat != null ? { lat: x.inLat, lng: x.inLng, acc: x.inAcc } : null,
        sharing: y?.sharing ?? false, note: y?.note ?? null,
        declined: !!(y?.declinedAt && (!y.consentAt || y.declinedAt > y.consentAt)),
        last: y?.lastAt && y.lat != null ? { at: y.lastAt, lat: y.lat, lng: y.lng, acc: y.acc } : null,
      };
    }),
  });
}
