// One person's location points for one day (Dhaka time). Attendance admins only.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = await getUser();
  if (!u?.has("attendance")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const q = new URL(req.url).searchParams;
  const userId = q.get("userId") ?? "";
  const day = q.get("date") ?? "";
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: "Person and date are needed" }, { status: 400 });
  const from = new Date(`${day}T00:00:00+06:00`);
  const to = new Date(from.getTime() + 86400_000);
  const [points, att] = await Promise.all([
    prisma.locationPoint.findMany({ where: { userId, at: { gte: from, lt: to } }, orderBy: { at: "asc" }, select: { at: true, lat: true, lng: true, acc: true }, take: 5000 }),
    prisma.attendance.findUnique({ where: { userId_date: { userId, date: new Date(day + "T00:00:00Z") } } }),
  ]);
  return NextResponse.json({
    points,
    checkIn: att?.checkIn ?? null, checkOut: att?.checkOut ?? null, method: att?.method ?? null,
    inAt: att?.inLat != null ? { lat: att.inLat, lng: att.inLng } : null,
    outAt: att?.outLat != null ? { lat: att.outLat, lng: att.outLng } : null,
    selfieIn: att?.selfieIn ? `/api/attendance/selfie/${att.id}?k=in` : null,
    selfieOut: att?.selfieOut ? `/api/attendance/selfie/${att.id}?k=out` : null,
  });
}
