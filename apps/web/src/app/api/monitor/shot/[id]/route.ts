// One screenshot picture. Work Monitor admins, and the person it belongs to (My time).
import { readFile } from "node:fs/promises";
import { getUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { shotPath } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return new Response("Not allowed", { status: 403 });
  const { id } = await ctx.params;
  const s = await prisma.screenshot.findUnique({ where: { id }, select: { file: true, userId: true } });
  if (!s || (!u.has("monitor") && s.userId !== u.id)) return new Response("Not found", { status: 404 });
  try {
    const buf = await readFile(shotPath(s.file));
    return new Response(new Uint8Array(buf), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
  } catch {
    return new Response("The picture file is missing", { status: 404 });
  }
}
