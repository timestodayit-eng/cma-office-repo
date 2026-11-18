// The logged-in page inside the desktop app asks for a token here and hands it to the app,
// so the app can send screenshots for this person. Works only with the normal login cookie.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { agentToken, getMonitorRules } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function POST() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  return NextResponse.json({ token: await agentToken(u.id), userId: u.id, name: u.name, rules: await getMonitorRules() });
}
