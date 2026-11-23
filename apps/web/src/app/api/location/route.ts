// The door the CMA Office phone app uses to send live location (Bearer token from the page, see lib/location.ts).
// Points are saved only while the person should be sharing (checked in, rules on, not turned off);
// otherwise the answer is { track: false } and the phone stops and removes its notification.
import { NextResponse } from "next/server";
import { cleanOldPoints, locUserId, savePoints, setSharing, trackNow } from "@/lib/location";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const userId = await locUserId(req);
  if (!userId) return NextResponse.json({ track: false, error: "Log in again in the CMA Office app." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { points?: unknown; stop?: string };
  if (typeof b.stop === "string") {
    // The phone stopped by itself (Location turned off, permission removed): show that to the admin.
    await setSharing(userId, "stopped", b.stop.slice(0, 120) || "Stopped on the phone");
    return NextResponse.json({ track: false });
  }
  const t = await trackNow(userId);
  if (!t.ok) {
    await setSharing(userId, "stopped", t.why);
    return NextResponse.json({ track: false, why: t.why });
  }
  const saved = await savePoints(userId, Array.isArray(b.points) ? b.points : []);
  cleanOldPoints().catch((e) => console.error("location clean", e));
  return NextResponse.json({ track: true, everyMin: t.everyMin, saved });
}
