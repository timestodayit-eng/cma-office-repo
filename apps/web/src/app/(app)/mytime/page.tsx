// My time: each person's own tracked hours, activity, screenshots and manual time requests.
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { todayDhaka } from "@/lib/format";
import { Flash } from "@/components/TaskCard";
import { getMonitorRules, dur } from "@/lib/monitor";
import { workedByDay, sumDays, pct, hm, isoDay, parseDay, weekStartOf, monthStartOf, addDays, getCats } from "@/lib/timetrack";
import { Timeline, UsageList } from "@/components/TimeTracker";
import { myManualAction, myManualCancelAction } from "@/app/monitorActions";

const DL = "https://github.com/timestodayit-eng/cma-office-repo/releases/tag/desktop-latest";
const tm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
const dd = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short" }).format(d);

export default async function MyTime({ searchParams }: { searchParams: Promise<{ day?: string; e?: string; ok?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const today = todayDhaka();
  const pick = parseDay(sp.day);
  const day = pick && pick <= today ? pick : today;
  const ms = monthStartOf(today);
  const ws = weekStartOf(today);
  const first = ms < ws ? ms : ws;
  const [rules, totals, requests, cats, ever] = await Promise.all([
    getMonitorRules(),
    workedByDay(first, today, [u.id]),
    prisma.timeEntry.findMany({ where: { userId: u.id, kind: "MANUAL" }, orderBy: { from: "desc" }, take: 15 }),
    getCats(),
    prisma.workSession.count({ where: { userId: u.id } }),
  ]);
  const m = totals.get(u.id);
  const tToday = sumDays(m, today, today);
  const tWeek = sumDays(m, ws, today);
  const tMonth = sumDays(m, ms, today);
  const back = `/mytime?day=${isoDay(day)}`;
  return (
    <>
      <h1 className="h1">My time</h1>
      <Flash sp={sp} />
      <div className="stats">
        <div className="stat"><b>{hm(tToday.sec)}</b><span>Today</span></div>
        <div className="stat"><b>{hm(tWeek.sec)}</b><span>This week (from Saturday)</span></div>
        <div className="stat"><b>{hm(tMonth.sec)}</b><span>This month</span></div>
        <div className="stat"><b>{pct(tWeek) == null ? "—" : `${pct(tWeek)}%`}</b><span>Activity this week</span></div>
      </div>
      {!ever && (
        <div className="card">
          <b>Start tracking from the CMA Office desktop app</b>
          <p className="hint">Your time is counted only while you press Start work in the desktop app on your office computer. <a href={DL} target="_blank" rel="noreferrer">Download the desktop app ↗</a></p>
        </div>
      )}
      <p className="hint">Only you and the Work Monitor admins see this. Time is counted only while your timer is on. Activity % = the share of seconds in which the mouse or keyboard moved; which keys you press is never recorded.</p>
      <form className="row" style={{ gap: 8 }}>
        <Link className="btn sm" href={`/mytime?day=${isoDay(addDays(day, -1))}`}>‹</Link>
        <input type="date" name="day" defaultValue={isoDay(day)} max={isoDay(today)} className="inp" style={{ width: "auto" }} />
        <button className="btn sm">Show</button>
        {day < today && <Link className="btn sm" href={`/mytime?day=${isoDay(addDays(day, 1))}`}>›</Link>}
      </form>
      <Timeline userId={u.id} day={day} mode="own" staffDelete={rules.staffDelete} back={back} />
      <UsageList from={day} to={day} userId={u.id} cats={cats} admin={false} back={back} limit={12} />
      {rules.manual && (
        <form action={myManualAction} className="card">
          <b>Ask for manual time</b>
          <p className="hint">For work away from your computer, for example a shoot or a client visit. A Work Monitor admin approves it; then it is added to your hours.</p>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <label className="field">Day<input type="date" name="day" defaultValue={isoDay(today)} max={isoDay(today)} className="inp" required /></label>
            <label className="field">From<input type="time" name="from" className="inp" required /></label>
            <label className="field">To<input type="time" name="to" className="inp" required /></label>
          </div>
          <label className="field">What were you doing?<input name="reason" maxLength={300} className="inp" required placeholder="Outdoor shoot for Coastal Manpower" /></label>
          <button className="btn primary" style={{ alignSelf: "flex-start" }}>Send for approval</button>
        </form>
      )}
      {requests.length > 0 && (
        <div className="card">
          <b>My manual time requests</b>
          {requests.map((r) => (
            <div key={r.id} className="row small" style={{ gap: 8, flexWrap: "wrap" }}>
              <span className="mono">{dd(r.from)}, {tm(r.from)} – {tm(r.to)}</span>
              <span>{dur(r.sec)}</span>
              {r.status === "PENDING" ? <span className="pill p-amber">Waiting</span>
                : r.status === "APPROVED" ? <span className="pill p-good">Approved</span>
                : r.status === "REJECTED" ? <span className="pill p-bad">Not approved</span>
                : <span className="pill p-grey">Cancelled</span>}
              <span className="muted grow">{r.reason}</span>
              {r.status === "PENDING" && (
                <form action={myManualCancelAction}><input type="hidden" name="id" value={r.id} /><button className="linkbtn">Cancel</button></form>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
