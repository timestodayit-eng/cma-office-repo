// Live view of one person's screen. The admin page calls this every second or two:
// each call keeps the request alive (the desktop app sends pictures only while it is) and returns the newest picture.
// Works only while that person is in a work session. Only Work Monitor admins.
import { getUser } from "@/lib/auth";
import { getMonitorRules, openSession, wantLive, getFrame, stopLive } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  const u = await getUser();
  if (!u?.has("monitor")) return new Response("Not allowed", { status: 403 });
  const { userId } = await ctx.params;
  const rules = await getMonitorRules();
  if (!rules.live) return Response.json({ state: "off" }, { status: 409 });
  if (new URL(req.url).searchParams.get("stop")) { stopLive(userId); return Response.json({ state: "stopped" }); }
  const s = await openSession(userId);
  if (!s) { stopLive(userId); return Response.json({ state: "not-working" }, { status: 409 }); }
  wantLive(userId);
  const f = getFrame(userId);
  if (!f) return new Response(null, { status: 204 });
  return new Response(new Uint8Array(f.buf), { headers: { "content-type": "image/jpeg", "cache-control": "no-store", "x-frame-at": String(f.at) } });
}
