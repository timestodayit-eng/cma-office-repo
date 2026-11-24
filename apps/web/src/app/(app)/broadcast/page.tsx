import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { fmtDay, todayDhaka } from "@/lib/format";
import { bcGroups, officerOf, groupSlots } from "@/lib/broadcast";
import { getSheetConfig } from "@/lib/outbox";
import { Flash } from "@/components/TaskCard";
import { BcCard, AgPill } from "@/components/BcCard";
import { NameCheck } from "@/components/NameCheck";
import { SyncBar } from "@/components/SyncBar";

const DAY = 86_400_000;

export default async function Broadcast({ searchParams }: { searchParams: Promise<{ tab?: string; e?: string; ok?: string }> }) {
  const u = await requireModule("broadcast");
  const sp = await searchParams;
  const tab = ["week", "plan"].includes(sp.tab ?? "") ? sp.tab! : "todo";
  const today = todayDhaka();
  const [groups, upcoming, companies, cfg] = await Promise.all([
    bcGroups(today, new Date(today.getTime() + 7 * DAY)),
    prisma.interview.findMany({
      where: { interviewDate: { gte: today }, broadcast: { some: {} } },
      include: { company: true, broadcast: { orderBy: { slot: "asc" } } },
      orderBy: { interviewDate: "asc" },
    }),
    prisma.company.findMany(),
    getSheetConfig(),
  ]);
  const officers = await officerOf(companies.map((c) => c.id));
  const open = groups.filter((g) => !g.done && g.date.getTime() <= today.getTime() + DAY);
  const week = groups.filter((g) => g.date.getTime() > today.getTime() + DAY);
  const canEdit = u.can("broadcast", "EDIT");
  const back = `/broadcast${tab === "todo" ? "" : `?tab=${tab}`}`;
  const card = (g: (typeof groups)[number]) => <BcCard key={g.key} g={g} today={today} officer={officers.get(g.company.id)} meId={u.id} canEdit={canEdit} back={back} />;
  const names = tab === "plan"
    ? (await prisma.interview.findMany({ select: { title: true, interviewDate: true, company: { select: { name: true } } } })).map((r) => ({ name: r.title ?? "", agency: r.company.name, row: fmtDay(r.interviewDate, { day: "numeric", month: "short", year: "2-digit" }) }))
    : [];
  return (
    <>
      <h1 className="h1">Call &amp; SMS Broadcast</h1>
      <SyncBar last={cfg.last?.broadcast} label="the Banglalink Call Broadcast Panel sheet" kind="broadcast" />
      <Flash sp={sp} />
      <div className="stats three">
        <div className="stat"><b style={{ color: open.length ? "var(--amber)" : undefined }}>{open.length}</b><span>To send now</span></div>
        <div className="stat"><b>{week.length}</b><span>Next 7 days</span></div>
        <div className="stat"><b>{upcoming.length}</b><span>Interviews</span></div>
      </div>
      <nav className="seg wide">
        <Link href="/broadcast" aria-current={tab === "todo" ? "page" : undefined}>To send{open.length > 0 && <i>{open.length}</i>}</Link>
        <Link href="/broadcast?tab=week" aria-current={tab === "week" ? "page" : undefined}>Next 7 days</Link>
        <Link href="/broadcast?tab=plan" aria-current={tab === "plan" ? "page" : undefined}>By interview</Link>
      </nav>
      {tab === "todo" && (open.length ? <div className="grid">{open.map(card)}</div> : <div className="empty"><b>Everything is sent</b>Nothing to send for today or tomorrow.</div>)}
      {tab === "week" && (week.length ? <div className="grid">{week.map(card)}</div> : <div className="empty">No calls planned in the next 7 days.</div>)}
      {tab === "plan" && (
        <>
          <NameCheck existing={names} />
          <div className="grid">
            {upcoming.map((iv) => {
              const gs = groupSlots(iv.broadcast.map((b) => ({ ...b, interview: iv })));
              const n = gs.filter((g) => g.done).length;
              const type = iv.broadcastType === "FIRST" ? "Bridge · first" : iv.broadcastType === "SECOND" ? "Bridge · second" : "Single";
              return (
                <div key={iv.id} className="task">
                  <div className="meta"><AgPill short={iv.company.short} name={iv.company.name} /><span className="pill p-grey">{type}</span>
                    <span style={{ marginLeft: "auto" }} className={`pill ${n === gs.length ? "p-good" : "p-pri"}`}>{n} of {gs.length} days sent</span></div>
                  <Link href={`/interviews/${iv.id}`} className="t">{(iv.title ?? "").replace(/\s+/g, " ")}</Link>
                  <div className="meta"><span>Interview {fmtDay(iv.interviewDate)}</span><span>·</span><span>{officers.get(iv.companyId)?.name ?? "No officer set"}</span></div>
                  <div className="row" style={{ gap: 6 }}>
                    {gs.map((g) => {
                      const t = g.date.getTime();
                      return <span key={g.key} className={`pill ${g.done ? "p-good" : t < today.getTime() ? "p-bad" : t <= today.getTime() + DAY ? "p-amber" : "p-grey"}`}>{g.slot} · {fmtDay(g.date)}{g.done ? " ✓" : ""}{g.sms ? " · SMS" : ""}</span>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      <p className="hint">Each interview gets calls on the 4 days before and on the interview day. The request for a call day is sent the day before. A tick here ticks the checkbox in the Google Sheet too.</p>
    </>
  );
}
