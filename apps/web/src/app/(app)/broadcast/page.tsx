import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { fmtDay, fmtTime, todayDhaka } from "@/lib/format";
import { Flash } from "@/components/TaskCard";
import { tickBroadcastAction } from "@/app/logActions";

export default async function Broadcast({ searchParams }: { searchParams: Promise<{ tab?: string; e?: string; ok?: string }> }) {
  const u = await requireModule("broadcast");
  const sp = await searchParams;
  const tab = sp.tab ?? "send";
  const today = todayDhaka();
  const end = new Date(today); end.setUTCDate(end.getUTCDate() + (tab === "week" ? 7 : 1));
  const mine = await prisma.companyRole.findMany({ where: { userId: u.id, role: "broadcast_officer" } });
  const slots = await prisma.broadcastSlot.findMany({
    where: { callDate: { gte: today, lte: end } },
    include: { interview: { include: { company: true } } },
    orderBy: [{ callDate: "asc" }, { slot: "asc" }],
  });
  const canEdit = u.can("broadcast", "EDIT");
  return (
    <>
      <h1 className="h1">Call &amp; SMS Broadcast</h1>
      <p className="hint">Missed call first, Received at least 3 hours later. Received and Missed are never merged. {mine.length ? "Your companies are marked." : ""}</p>
      <Flash sp={sp} />
      <nav className="seg">
        <Link href="/broadcast" aria-current={tab === "send" ? "page" : undefined}>Today &amp; tomorrow</Link>
        <Link href="/broadcast?tab=week" aria-current={tab === "week" ? "page" : undefined}>Next 7 days</Link>
      </nav>
      {slots.length === 0 && <div className="empty">No call days in this period.</div>}
      <div className="grid">
        {slots.map((b) => {
          const isMine = mine.some((m) => m.companyId === b.interview.companyId);
          return (
            <div key={b.id} className={`task${isMine ? " mine" : ""}`}>
              <span className="t">{b.interview.company.short} · {b.interview.title}</span>
              <span className="meta"><span className="pill p-pri">{b.slot}</span>{fmtDay(b.callDate, { weekday: "short", day: "numeric", month: "short" })} · interview {fmtDay(b.interview.interviewDate)} · hotline {b.interview.company.hotlines.join("/")}</span>
              <form action={tickBroadcastAction} className="row">
                <input type="hidden" name="id" value={b.id} />
                <button className={`btn sm ${b.missedSent ? "good" : ""}`} name="field" value="missed" disabled={!canEdit || b.missedSent}>1. Missed sent {b.missedSent ? `✓ ${fmtTime(b.missedAt)}` : ""}</button>
                <button className={`btn sm ${b.receivedSent ? "good" : ""}`} name="field" value="received" disabled={!canEdit || b.receivedSent || !b.missedSent}>2. Received sent {b.receivedSent ? `✓ ${fmtTime(b.receivedAt)}` : ""}</button>
                <button className={`btn sm ${b.smsSent ? "good" : ""}`} name="field" value="sms" disabled={!canEdit || b.smsSent}>SMS {b.smsSent ? "✓" : ""}</button>
              </form>
            </div>
          );
        })}
      </div>
    </>
  );
}
