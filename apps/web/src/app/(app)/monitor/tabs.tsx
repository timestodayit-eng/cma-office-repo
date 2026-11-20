// Work Monitor admin tabs for the time tracker: Timesheet, Apps & sites, Approvals.
import Link from "next/link";
import { prisma } from "@/lib/db";
import { todayDhaka, initials } from "@/lib/format";
import { SILENT_MS, dur } from "@/lib/monitor";
import {
  workedByDay, sumDays, pct, hm, isoDay, parseDay, weekStartOf, monthStartOf, addDays, getCats,
} from "@/lib/timetrack";
import { UsageList, actPill } from "@/components/TimeTracker";
import { monDecideManualAction } from "@/app/monitorActions";

const tm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
const dayName = (d: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(d);
const monthName = (d: Date) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);

export type Range = "day" | "week" | "month";
/** The days a range covers, never past today. */
export function rangeOf(range: Range, anchor: Date) {
  const today = todayDhaka();
  const from = range === "day" ? anchor : range === "week" ? weekStartOf(anchor) : monthStartOf(anchor);
  const end = range === "day" ? anchor : range === "week" ? addDays(from, 6) : addDays(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)), -1);
  return { from, to: end > today ? today : end, end };
}
function shiftAnchor(range: Range, anchor: Date, by: number) {
  if (range === "day") return addDays(anchor, by);
  if (range === "week") return addDays(anchor, 7 * by);
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + by, 1));
}

function RangeBar({ tab, range, anchor, extra = "" }: { tab: string; range: Range; anchor: Date; extra?: string }) {
  const { from, end } = rangeOf(range, anchor);
  const href = (r: Range, a: Date) => `/monitor?tab=${tab}&range=${r}&date=${isoDay(a)}${extra}`;
  const label = range === "day" ? dayName(from) : range === "week" ? `${dayName(from)} – ${dayName(end)}` : monthName(from);
  const next = shiftAnchor(range, anchor, 1);
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <div className="chips">
        {(["day", "week", "month"] as const).map((r) => <Link key={r} className="chip" href={href(r, anchor)} aria-current={range === r ? "page" : undefined}>{r === "day" ? "Day" : r === "week" ? "Week" : "Month"}</Link>)}
      </div>
      <Link className="btn sm" href={href(range, shiftAnchor(range, anchor, -1))}>‹</Link>
      <b>{label}</b>
      {rangeOf(range, next).from <= todayDhaka() && <Link className="btn sm" href={href(range, next)}>›</Link>}
    </div>
  );
}

export function readRange(sp: { range?: string; date?: string }, d: Range = "week"): { range: Range; anchor: Date } {
  const range = (["day", "week", "month"].includes(sp.range ?? "") ? sp.range : d) as Range;
  const anchor = parseDay(sp.date) ?? todayDhaka();
  return { range, anchor: anchor > todayDhaka() ? todayDhaka() : anchor };
}

// ---------- Timesheet ----------

export async function TimesheetTab({ sp }: { sp: { range?: string; date?: string } }) {
  const { range, anchor } = readRange(sp);
  const { from, to } = rangeOf(range, anchor);
  const [people, totals, open, pending] = await Promise.all([
    prisma.user.findMany({ where: { active: true, external: false }, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true } }),
    workedByDay(from, to),
    prisma.workSession.findMany({ where: { endedAt: null, lastBeatAt: { gte: new Date(Date.now() - SILENT_MS) } }, select: { userId: true, startedAt: true } }),
    prisma.timeEntry.count({ where: { kind: "MANUAL", status: "PENDING" } }),
  ]);
  const openBy = new Map(open.map((o) => [o.userId, o]));
  const days: Date[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const rows = people.map((p) => ({ p, m: totals.get(p.id), t: sumDays(totals.get(p.id)) })).sort((a, b) => b.t.sec - a.t.sec || a.p.name.localeCompare(b.p.name));
  const all = rows.reduce((a, r) => ({ sec: a.sec + r.t.sec, actSum: a.actSum + r.t.actSum, actN: a.actN + r.t.actN }), { sec: 0, actSum: 0, actN: 0 });
  const tracked = rows.filter((r) => r.t.sec > 0);
  const csv = `/api/monitor/timesheet?from=${isoDay(from)}&to=${isoDay(to)}`;
  return (
    <>
      <RangeBar tab="timesheet" range={range} anchor={anchor} />
      <div className="stats">
        <div className="stat"><b>{open.length}</b><span>Tracking now</span></div>
        <div className="stat"><b>{hm(all.sec)}</b><span>Total worked</span></div>
        <div className="stat"><b>{pct(all) == null ? "—" : `${pct(all)}%`}</b><span>Average activity</span></div>
        <div className="stat"><b>{tracked.length ? hm(all.sec / tracked.length) : "—"}</b><span>Per person who worked</span></div>
        <Link href="/monitor?tab=approvals" className="stat"><b>{pending}</b><span>Manual time waiting</span></Link>
      </div>
      <div className="tsheet">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              {range === "week" && days.map((d) => <th key={d.getTime()} className="n">{dayName(d)}</th>)}
              {range !== "week" && <><th className="n">Days worked</th><th className="n">Avg / day</th></>}
              <th className="n">Total</th><th className="n">Activity</th><th className="n">Manual</th><th>Now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, m, t }) => {
              const o = openBy.get(p.id);
              const worked = m ? [...m.values()].filter((x) => x.sec > 0).length : 0;
              return (
                <tr key={p.id}>
                  <td><Link href={`/monitor?user=${p.id}&day=${isoDay(range === "day" ? from : to)}`}><span className="av sm" style={{ marginRight: 8 }}>{initials(p.name)}</span>{p.name}</Link></td>
                  {range === "week" && days.map((d) => {
                    const x = m?.get(isoDay(d));
                    return <td key={d.getTime()} className="n">{x && x.sec ? <Link href={`/monitor?user=${p.id}&day=${isoDay(d)}`}>{hm(x.sec)}</Link> : <span className="muted">—</span>}</td>;
                  })}
                  {range !== "week" && <><td className="n">{worked || "—"}</td><td className="n">{worked ? hm(t.sec / worked) : "—"}</td></>}
                  <td className="n"><b>{t.sec ? hm(t.sec) : "—"}</b></td>
                  <td className="n">{actPill(pct(t))}</td>
                  <td className="n">{t.manual ? hm(t.manual) : ""}</td>
                  <td>{o ? <span className="pill p-good">Since {tm(o.startedAt)}</span> : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <a className="btn sm" href={csv}>⬇ Download CSV (Excel)</a>
        <span className="small muted">Worked = time in work sessions, minus idle time people removed and screenshots they deleted, plus approved manual time.</span>
      </div>
    </>
  );
}

// ---------- Apps & sites ----------

export async function AppsTab({ sp }: { sp: { range?: string; date?: string; who?: string; dept?: string } }) {
  const { range, anchor } = readRange(sp);
  const { from, to } = rangeOf(range, anchor);
  const [people, cats] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, department: true } }),
    getCats(),
  ]);
  const depts = [...new Set(people.map((p) => p.department).filter(Boolean) as string[])].sort();
  const person = people.find((p) => p.id === sp.who);
  const dept = !person && sp.dept && depts.includes(sp.dept) ? sp.dept : null;
  const extra = `${person ? `&who=${person.id}` : ""}${dept ? `&dept=${encodeURIComponent(dept)}` : ""}`;
  const back = `/monitor?tab=apps&range=${range}&date=${isoDay(anchor)}${extra}`;
  return (
    <>
      <RangeBar tab="apps" range={range} anchor={anchor} extra={extra} />
      <form className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <input type="hidden" name="tab" value="apps" /><input type="hidden" name="range" value={range} /><input type="hidden" name="date" value={isoDay(anchor)} />
        <select name="who" defaultValue={person?.id ?? ""} className="inp" style={{ width: "auto" }}>
          <option value="">Everyone</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {depts.length > 0 && (
          <select name="dept" defaultValue={dept ?? ""} className="inp" style={{ width: "auto" }}>
            <option value="">All teams</option>
            {depts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <button className="btn sm">Show</button>
      </form>
      {dept && <p className="hint">Labels you set now are for the <b>{dept}</b> team only (for example Facebook is productive for Marketing). Choose “All teams” to set the label for everyone.</p>}
      <UsageList
        from={from} to={to} cats={cats} admin back={back} limit={40}
        userId={person?.id}
        userIds={dept ? people.filter((p) => p.department === dept).map((p) => p.id) : undefined}
        dept={person ? person.department ?? null : dept}
      />
    </>
  );
}

// ---------- Approvals (manual time) ----------

export async function ApprovalsTab({ meId }: { meId: string }) {
  const [pending, recent] = await Promise.all([
    prisma.timeEntry.findMany({ where: { kind: "MANUAL", status: "PENDING" }, orderBy: { from: "asc" }, include: { user: { select: { name: true, designation: true } } } }),
    prisma.timeEntry.findMany({ where: { kind: "MANUAL", status: { in: ["APPROVED", "REJECTED"] } }, orderBy: { decidedAt: "desc" }, take: 30, include: { user: { select: { name: true } } } }),
  ]);
  const deciders = new Map((await prisma.user.findMany({ where: { id: { in: recent.map((r) => r.decidedById).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  const when = (e: { from: Date; to: Date }) => `${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short" }).format(e.from)}, ${tm(e.from)} – ${tm(e.to)}`;
  return (
    <>
      <div className="card" style={{ gap: 0, padding: 0 }}>
        <div style={{ padding: "12px 14px" }}><b>Manual time waiting</b> <span className="pill p-amber">{pending.length}</span>
          <p className="hint">Time people worked away from their computer (for example a shoot). Approved time is added to the timesheet, without screenshots or activity.</p>
        </div>
        {pending.length === 0 && <p className="hint" style={{ padding: "0 14px 12px" }}>Nothing waiting.</p>}
        {pending.map((e) => (
          <div key={e.id} className="leave-item">
            <div className="grow">
              <b>{e.user.name} <span className="small muted">· {e.user.designation ?? ""}</span></b>
              <span className="small">{when(e)} · <b>{dur(e.sec)}</b></span>
              {e.reason && <div className="leave-reason">{e.reason}</div>}
            </div>
            {e.userId === meId ? <span className="small muted">Your own request: the other admin decides.</span> : (
              <form className="leave-actions">
                <input type="hidden" name="id" value={e.id} />
                <button className="btn sm primary" formAction={monDecideManualAction.bind(null, "approve")}>Approve</button>
                <button className="btn sm bad" formAction={monDecideManualAction.bind(null, "reject")}>Reject</button>
              </form>
            )}
          </div>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="card">
          <b>Decided lately</b>
          {recent.map((e) => (
            <div key={e.id} className="row small" style={{ gap: 8, flexWrap: "wrap" }}>
              <span className={`pill ${e.status === "APPROVED" ? "p-good" : "p-bad"}`}>{e.status === "APPROVED" ? "Approved" : "Rejected"}</span>
              <b>{e.user.name}</b><span className="muted">{when(e)} · {dur(e.sec)}</span>
              {e.decidedById && <span className="muted">by {deciders.get(e.decidedById) ?? "—"}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
