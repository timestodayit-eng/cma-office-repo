// One attendance selfie. Attendance admins, and the person it belongs to.
import { readFile } from "node:fs/promises";
import { getUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { shotPath } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return new Response("Not allowed", { status: 403 });
  const { id } = await ctx.params;
  const a = await prisma.attendance.findUnique({ where: { id }, select: { userId: true, selfieIn: true, selfieOut: true } });
  if (!a || (!u.has("attendance") && a.userId !== u.id)) return new Response("Not found", { status: 404 });
  const file = new URL(req.url).searchParams.get("k") === "out" ? a.selfieOut : a.selfieIn;
  if (!file) return new Response("Not found", { status: 404 });
  try {
    const buf = await readFile(shotPath(file));
    return new Response(new Uint8Array(buf), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
  } catch {
    return new Response("The picture file is missing", { status: 404 });
  }
}
