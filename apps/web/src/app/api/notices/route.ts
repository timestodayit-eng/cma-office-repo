// How many notices the signed-in person has not ticked yet. The open app asks this every few seconds,
// so a new notice pops up without a reload.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ unread: 0 }, { status: 401 });
  return NextResponse.json({ unread: await prisma.noticeRead.count({ where: { userId: u.id, readAt: null } }) });
}
