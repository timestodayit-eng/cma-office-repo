import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { fmtDay, todayDhaka, initials } from "@/lib/format";
import { getAttRules, clock, dhakaMinutes, timeFor, DAY_NAMES } from "@/lib/attendance";
import { Flash } from "@/components/TaskCard";
import { AttButtons, MyLocation, SetOfficeWifi } from "@/components/AttButtons";
import { LiveMap } from "@/components/LiveMap";
import { attAdminSetAction, attRemoveWifiAction, attSaveRulesAction, attSavePersonAction, attSaveLocRulesAction, leaveApplyAction, leaveCancelAction, leaveDecideAction } from "@/app/attActions";
import { selfieFor, trackNow, trackRules, tracksUser } from "@/lib/location";
import { LEAVE_TYPES, leaveApprovers, rangeLabel } from "@/lib/leave";
import { workedByDay, sumDays, hm, pct } from "@/lib/timetrack";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const hhmm = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "");

export default async function Attendance({ searchParams }: { searchParams: Promise<{ tab?: string; day?: string; e?: string; ok?: string }> }) {
  const u = await requireModule("attendance");
  const sp = await searchParams;
  // Team view, corrections, rules and office WiFi: only the people with the "Attendance admin" duty (and super admins).
  const admin = u.has("attendance");
  const tab = sp.tab === "leave" ? "leave" : (sp.tab === "team" || sp.tab === "rules" || sp.tab === "map") && admin ? sp.tab : "me";
  const today = todayDhaka();
  const rules = await getAttRules();
  const waiting = admin ? await prisma.leaveRequest.count({ where: { status: "PENDING", userId: { not: u.id } } }) : 0;
  const Tabs = (
    <div className="chips" style={{ marginBottom: 4 }}>
      <Link className="chip" href="/attendance" aria-current={tab === "me" ? "page" : undefined}>My day</Link>
      <Link className="chip" href="/attendance?tab=leave" aria-current={tab === "leave" ? "page" : undefined}>Leave{waiting ? <span className="badge">{waiting}</span> : null}</Link>
      {admin && <Link className="chip" href="/attendance?tab=team" aria-current={tab === "team" ? "page" : undefined}>Team today</Link>}
      {admin && <Link className="chip" href="/attendance?tab=map" aria-current={tab === "map" ? "page" : undefined}>Live map</Link>}
      {admin && <Link className="chip" href="/attendance?tab=rules" aria-current={tab === "rules" ? "page" : undefined}>Rules</Link>}
    </div>
  );

  if (tab === "map") {
    const t = trackRules(rules);
    return (
      <>
        <h1 className="h1">Attendance</h1>
        <Flash sp={sp} />
        {Tabs}
        {!t.on && <div className="warn">Live location is off. Turn it on in <Link href="/attendance?tab=rules#location">Rules → Selfie &amp; live location</Link>. Check-in places and selfies still show here.</div>}
        <LiveMap today={iso(today)} everyMin={t.everyMin} />
      </>
    );
  }

  if (tab === "team") {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? new Date(sp.day + "T00:00:00Z") : today;
    const [people, rows, tracked] = await Promise.all([
      prisma.user.findMany({ where: { active: true, external: false }, orderBy: { name: "asc" } }),
      prisma.attendance.findMany({ where: { date: day } }),
      workedByDay(day, day),
    ]);
    const by = new Map(rows.map((r) => [r.userId, r]));
    const off = rules.weeklyOff.includes(day.getUTCDay());
    const n = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
    return (
      <>
        <h1 className="h1">Attendance</h1>
        <Flash sp={sp} />
        {Tabs}
        <form className="row" style={{ gap: 8 }}>
          <input type="hidden" name="tab" value="team" />
          <input type="date" name="day" defaultValue={iso(day)} max={iso(today)} className="inp" style={{ width: "auto" }} />
          <button className="btn sm">Show</button>
          {off && <span className="pill p-grey">Weekly off day</span>}
        </form>
        <div className="stats">
          <div className="stat"><b>{n((r) => r.status === "PRESENT")}</b><span>Present</span></div>
          <div className="stat"><b>{n((r) => r.late)}</b><span>Late</span></div>
          <div className="stat"><b>{n((r) => r.status === "LEAVE")}</b><span>On leave</span></div>
          <div className="stat"><b>{people.length - n((r) => r.status === "PRESENT" || r.status === "LEAVE")}</b><span>{off ? "Not in (off day)" : "Not in yet / absent"}</span></div>
        </div>
        <div className="card" style={{ gap: 0, padding: 0 }}>
          {people.map((p) => {
            const a = by.get(p.id);
            const pt = timeFor(rules, p.id);
            const off = pt.weeklyOff.includes(day.getUTCDay());
            return (
              <details key={p.id} className="attrow">
                <summary>
                  <span className="av sm">{initials(p.name)}</span>
                  <span className="grow"><b>{p.name}</b><span className="small muted">{[p.designation, rules.people?.[p.id] ? `${pt.start}–${pt.end}` : ""].filter(Boolean).join(" · ")}</span></span>
                  {!a ? <span className="pill p-grey">{off ? "Off day" : "Not in"}</span>
                    : a.status === "LEAVE" ? <span className="pill p-violet">{a.paidLeave === false ? "Leave · unpaid" : "Leave"}</span>
                    : a.status === "ABSENT" ? <span className="pill p-bad">Absent</span>
                    : <><span className={`pill ${a.late ? "p-amber" : "p-good"}`}>{a.late ? "Late" : "On time"}</span><span className="small mono">{clock(a.checkIn)}{a.checkOut ? ` – ${clock(a.checkOut)}` : ""}</span>{a.method === "admin" && <span className="pill p-grey">by admin</span>}{a.method === "field" && <span className="pill p-pri">field</span>}{a.selfieIn && <a href={`/api/attendance/selfie/${a.id}?k=in`} target="_blank" rel="noreferrer" title="Check-in selfie"><img src={`/api/attendance/selfie/${a.id}?k=in`} alt="Check-in selfie" className="selfie-thumb" /></a>}{a.selfieOut && <a href={`/api/attendance/selfie/${a.id}?k=out`} target="_blank" rel="noreferrer" title="Check-out selfie"><img src={`/api/attendance/selfie/${a.id}?k=out`} alt="Check-out selfie" className="selfie-thumb" /></a>}{a.inLat != null && <a className="small" href={`https://www.google.com/maps?q=${a.inLat},${a.inLng}`} target="_blank" rel="noreferrer" title="Where the person checked in">📍 map</a>}</>}
                  {(() => { const t = sumDays(tracked.get(p.id)); return t.sec > 0 ? <span className="small mono muted" title="Worked time from the desktop time tracker">⏱ {hm(t.sec)}{pct(t) != null ? ` · ${pct(t)}%` : ""}</span> : null; })()}
                </summary>
                <form action={attAdminSetAction} className="row" style={{ gap: 8, flexWrap: "wrap", padding: "0 14px 12px" }}>
                  <input type="hidden" name="userId" value={p.id} /><input type="hidden" name="date" value={iso(day)} />
                  <select name="status" className="inp" style={{ width: "auto" }} defaultValue={a?.status ?? "PRESENT"}>
                    <option value="PRESENT">Present</option><option value="LEAVE">Leave</option><option value="ABSENT">Absent</option><option value="CLEAR">Clear the day</option>
                  </select>
                  <label className="small">In <input type="time" name="in" defaultValue={hhmm(a?.checkIn ?? null) || pt.start} className="inp" style={{ width: "auto" }} /></label>
                  <label className="small">Out <input type="time" name="out" defaultValue={hhmm(a?.checkOut ?? null)} className="inp" style={{ width: "auto" }} /></label>
                  <input name="note" placeholder="Note (why)" defaultValue={a?.note ?? ""} className="inp" style={{ flex: 1, minWidth: 140 }} />
                  <button className="btn sm primary">Save</button>
                </form>
              </details>
            );
          })}
        </div>
      </>
    );
  }

  if (tab === "leave") {
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    const [mine, pending, recent, approvers] = await Promise.all([
      prisma.leaveRequest.findMany({ where: { userId: u.id }, orderBy: { fromDate: "desc" }, take: 30 }),
      admin ? prisma.leaveRequest.findMany({ where: { status: "PENDING" }, orderBy: { fromDate: "asc" }, include: { user: { select: { name: true, designation: true } } } }) : [],
      admin ? prisma.leaveRequest.findMany({ where: { status: { in: ["APPROVED", "REJECTED"] }, toDate: { gte: new Date(today.getTime() - 30 * 86400_000) } }, orderBy: { fromDate: "desc" }, take: 30, include: { user: { select: { name: true } } } }) : [],
      leaveApprovers(),
    ]);
    const deciders = new Map((await prisma.user.findMany({ where: { id: { in: [...mine, ...recent].map((r) => r.decidedById).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    const usedPaid = mine.filter((r) => r.status === "APPROVED" && r.paid && r.fromDate >= yearStart).reduce((n, r) => n + r.days, 0);
    const usedUnpaid = mine.filter((r) => r.status === "APPROVED" && r.paid === false && r.fromDate >= yearStart).reduce((n, r) => n + r.days, 0);
    const status = (r: { status: string; paid: boolean | null }) =>
      r.status === "PENDING" ? <span className="pill p-amber">Waiting</span>
        : r.status === "APPROVED" ? <span className={`pill ${r.paid ? "p-good" : "p-violet"}`}>Approved · {r.paid ? "Paid" : "Unpaid"}</span>
        : r.status === "REJECTED" ? <span className="pill p-bad">Not approved</span>
        : <span className="pill p-grey">Cancelled</span>;
    const names = approvers.filter((a) => a.id !== u.id).map((a) => a.name.replace(/^md\.?\s+/i, "").split(" ")[0]).join(" and ");
    return (
      <>
        <h1 className="h1">Attendance</h1>
        <Flash sp={sp} />
        {Tabs}
        {admin && (
          <div className="card" style={{ gap: 0, padding: 0 }}>
            <div style={{ padding: "12px 14px" }}><b>Waiting for your answer</b>{!pending.length && <p className="hint">No leave application is waiting.</p>}</div>
            {pending.map((r) => (
              <div key={r.id} className="leave-item">
                <div className="row" style={{ gap: 10 }}>
                  <span className="av sm">{initials(r.user.name)}</span>
                  <span className="grow"><b>{r.user.name}</b><span className="small muted">{r.user.designation ?? ""}</span></span>
                  <span className="pill p-pri">{r.days} day{r.days > 1 ? "s" : ""}</span>
                </div>
                <div><b>{rangeLabel(r.fromDate, r.toDate)}</b> · {LEAVE_TYPES[r.type] ?? r.type}</div>
                <div className="leave-reason">{r.reason}</div>
                {r.userId === u.id ? <p className="hint">Your own application. The other approver answers it.</p> : (
                  <form className="leave-actions">
                    <input type="hidden" name="id" value={r.id} />
                    <input name="note" placeholder="Note to the person (optional)" className="inp" />
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      {r.type !== "UNPAID" && <button className="btn sm primary" formAction={leaveDecideAction.bind(null, "paid")}>Approve · Paid</button>}
                      <button className={`btn sm${r.type === "UNPAID" ? " primary" : ""}`} formAction={leaveDecideAction.bind(null, "unpaid")}>Approve · Unpaid</button>
                      <button className="btn sm bad" formAction={leaveDecideAction.bind(null, "reject")}>Reject</button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
        {!u.external && (
          <form action={leaveApplyAction} className="card">
            <b>Apply for leave</b>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <label className="field">From<input type="date" name="from" required defaultValue={iso(new Date(today.getTime() + 86400_000))} className="inp" /></label>
              <label className="field">To<input type="date" name="to" required defaultValue={iso(new Date(today.getTime() + 86400_000))} className="inp" /></label>
              <label className="field">Type
                <select name="type" className="inp" defaultValue="CASUAL">
                  {Object.entries(LEAVE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
            <label className="field">Reason<textarea name="reason" required rows={3} placeholder="Why do you need the leave?" className="inp" /></label>
            <p className="hint">Weekly off days are not counted. {names ? `${names} will get a notification` : "HR will get a notification"} and decide paid or unpaid. You are told when it is answered.</p>
            <button className="btn primary" style={{ alignSelf: "flex-start" }}>Send application</button>
          </form>
        )}
        <div className="stats three">
          <div className="stat"><b>{usedPaid}</b><span>Paid leave days this year</span></div>
          <div className="stat"><b>{usedUnpaid}</b><span>Unpaid leave days</span></div>
          <div className="stat"><b>{mine.filter((r) => r.status === "PENDING").length}</b><span>Waiting</span></div>
        </div>
        <div className="h2">My applications</div>
        {mine.length ? (
          <div className="card" style={{ gap: 0, padding: 0 }}>
            {mine.map((r) => (
              <div key={r.id} className="leave-item">
                <div className="row" style={{ gap: 10 }}>
                  <span className="grow"><b>{rangeLabel(r.fromDate, r.toDate)}</b> <span className="small muted">· {r.days} day{r.days > 1 ? "s" : ""} · {LEAVE_TYPES[r.type] ?? r.type}</span></span>
                  {status(r)}
                </div>
                <div className="small muted">{r.reason}</div>
                {r.decidedById && r.status !== "PENDING" && <div className="small">{r.status === "CANCELLED" ? "Cancelled" : "Answered"} by {deciders.get(r.decidedById) ?? "HR"}{r.decisionNote ? `: “${r.decisionNote}”` : ""}</div>}
                {r.status === "PENDING" && (
                  <form action={leaveCancelAction}><input type="hidden" name="id" value={r.id} /><button className="btn sm">Cancel application</button></form>
                )}
              </div>
            ))}
          </div>
        ) : <div className="empty">You have not applied for leave yet.</div>}
        {admin && recent.length > 0 && (
          <>
            <div className="h2">Answered (last 30 days)</div>
            <div className="card" style={{ gap: 0, padding: 0 }}>
              {recent.map((r) => (
                <div key={r.id} className="leave-item">
                  <div className="row" style={{ gap: 10 }}>
                    <span className="grow"><b>{r.user.name}</b> <span className="small muted">· {rangeLabel(r.fromDate, r.toDate)} · {r.days} day{r.days > 1 ? "s" : ""}</span></span>
                    {status(r)}
                  </div>
                  <div className="small muted">{LEAVE_TYPES[r.type] ?? r.type} · by {deciders.get(r.decidedById ?? "") ?? "HR"}</div>
                  {r.status === "APPROVED" && (
                    <form action={leaveCancelAction}><input type="hidden" name="id" value={r.id} /><button className="btn sm">Cancel this leave</button></form>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </>
    );
  }

  if (tab === "rules") {
    const people = await prisma.user.findMany({ where: { active: true, external: false }, orderBy: { name: "asc" } });
    const lt = trackRules(rules);
    const offNames = (d: number[]) => (d.length ? d.map((i) => DAY_NAMES[i].slice(0, 3)).join(", ") : "no off day");
    return (
      <>
        <h1 className="h1">Attendance</h1>
        <Flash sp={sp} />
        {Tabs}
        <div className="card">
          <b>Office WiFi</b>
          <p className="hint">Check-in is accepted only when the phone is connected to one of these routers. The app matches the router&apos;s MAC ID, so a WiFi with the same name somewhere else does not work.</p>
          {rules.wifi.length === 0 && <div className="warn">No office WiFi is saved yet, so nobody can check in.</div>}
          {rules.wifi.map((w) => (
            <form key={w.bssid} action={attRemoveWifiAction} className="row" style={{ gap: 8 }}>
              <input type="hidden" name="bssid" value={w.bssid} />
              <span className="grow"><b>{w.ssid}</b> <span className="small mono muted">{w.bssid}</span></span>
              <button className="btn sm">Remove</button>
            </form>
          ))}
          <SetOfficeWifi />
        </div>
        <form action={attSaveRulesAction} className="card">
          <b>Office time</b>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <label className="field">Starts<input type="time" name="start" defaultValue={rules.start} className="inp" /></label>
            <label className="field">Ends<input type="time" name="end" defaultValue={rules.end} className="inp" /></label>
            <label className="field">Late after (minutes)<input type="number" name="graceMin" min={0} max={120} defaultValue={rules.graceMin} className="inp" /></label>
          </div>
          <b>Weekly off day</b>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            {DAY_NAMES.map((d, i) => <label key={d} className="row small" style={{ gap: 4 }}><input type="checkbox" name="weeklyOff" value={i} defaultChecked={rules.weeklyOff.includes(i)} />{d}</label>)}
          </div>
          <button className="btn primary" style={{ alignSelf: "flex-start" }}>Save rules</button>
        </form>
        <form action={attSaveLocRulesAction} className="card" id="location">
          <b>Selfie &amp; live location</b>
          <label className="field">Selfie with the front camera
            <select name="selfie" className="inp" defaultValue={rules.selfie ?? "off"} style={{ maxWidth: 320 }}>
              <option value="off">Off</option>
              <option value="in">At check in</option>
              <option value="inout">At check in and check out</option>
            </select>
          </label>
          <p className="hint">The selfie is saved with the time and the phone&apos;s location. You see it in Team today and on the Live map. Everyone needs the new CMA Office app first, so turn this on after they have updated.</p>
          <details>
            <summary><b>Field staff</b> <span className="small muted">· {(rules.field ?? []).length} chosen · may check in away from the office WiFi with a selfie + location</span></summary>
            <div className="row" style={{ gap: 10, flexWrap: "wrap", paddingTop: 8 }}>
              {people.map((p) => <label key={p.id} className="row small" style={{ gap: 4 }}><input type="checkbox" name="field" value={p.id} defaultChecked={(rules.field ?? []).includes(p.id)} />{p.name}</label>)}
            </div>
          </details>
          <hr className="sep" />
          <label className="row" style={{ gap: 8 }}><input type="checkbox" name="trackOn" defaultChecked={lt.on} /><b>Live location while checked in</b></label>
          <p className="hint">The app sends the phone&apos;s location only between check in and check out, shows a notification on the phone the whole time, and asks the person to agree first. If someone turns it off, you see that on the Live map.</p>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <label className="field">Every (minutes)<input type="number" name="everyMin" min={1} max={30} defaultValue={lt.everyMin} className="inp" /></label>
            <label className="field">Forgot to check out: stop after office end + (minutes)<input type="number" name="afterEndMin" min={0} max={600} defaultValue={lt.afterEndMin} className="inp" /></label>
            <label className="field">Keep history (days)<input type="number" name="keepDays" min={1} max={365} defaultValue={lt.keepDays} className="inp" /></label>
          </div>
          <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            <label className="row small" style={{ gap: 4 }}><input type="radio" name="who" value="all" defaultChecked={lt.who === "all"} />Everyone</label>
            <label className="row small" style={{ gap: 4 }}><input type="radio" name="who" value="some" defaultChecked={lt.who === "some"} />Only these people:</label>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            {people.map((p) => <label key={p.id} className="row small" style={{ gap: 4 }}><input type="checkbox" name="trackPeople" value={p.id} defaultChecked={lt.people.includes(p.id)} />{p.name}</label>)}
          </div>
          <button className="btn primary" style={{ alignSelf: "flex-start" }}>Save selfie &amp; location rules</button>
        </form>
        <div className="card" style={{ gap: 0, padding: 0 }}>
          <div style={{ padding: "12px 14px" }}>
            <b>Office time per person</b>
            <p className="hint">Everyone follows the office time above unless you set their own here (shift, shorter day, another off day). Tap a name to change it.</p>
          </div>
          {people.map((p) => {
            const own = rules.people?.[p.id];
            const pt = timeFor(rules, p.id);
            return (
              <details key={p.id} className="attrow">
                <summary>
                  <span className="av sm">{initials(p.name)}</span>
                  <span className="grow"><b>{p.name}</b><span className="small muted">{p.designation ?? ""}</span></span>
                  <span className="small mono">{pt.start} – {pt.end}</span>
                  <span className={`pill ${own ? "p-pri" : "p-grey"}`}>{own ? `Own time · ${offNames(pt.weeklyOff)}` : "Default"}</span>
                </summary>
                <form action={attSavePersonAction} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 14px 14px" }}>
                  <input type="hidden" name="userId" value={p.id} />
                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                    <label className="field">Starts<input type="time" name="start" defaultValue={pt.start} className="inp" /></label>
                    <label className="field">Ends<input type="time" name="end" defaultValue={pt.end} className="inp" /></label>
                    <label className="field">Late after (minutes)<input type="number" name="graceMin" min={0} max={120} defaultValue={pt.graceMin} className="inp" /></label>
                  </div>
                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                    <span className="small muted">Off day:</span>
                    {DAY_NAMES.map((d, i) => <label key={d} className="row small" style={{ gap: 4 }}><input type="checkbox" name="weeklyOff" value={i} defaultChecked={pt.weeklyOff.includes(i)} />{d.slice(0, 3)}</label>)}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn sm primary" name="mode" value="own">Save for {p.name.split(" ")[0]}</button>
                    {own && <button className="btn sm" name="mode" value="default">Use the default time</button>}
                  </div>
                </form>
              </details>
            );
          })}
        </div>
      </>
    );
  }

  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const rows = await prisma.attendance.findMany({ where: { userId: u.id, date: { gte: monthStart, lte: today } }, orderBy: { date: "desc" } });
  const mine = rows.find((r) => r.date.getTime() === today.getTime());
  const my = timeFor(rules, u.id);
  const off = my.weeklyOff.includes(today.getUTCDay());
  const state = u.external ? "off" : mine?.checkOut || (mine && mine.status !== "PRESENT") ? "done" : mine?.checkIn ? "in" : "none";
  const worked = (r: (typeof rows)[number]) => (r.checkIn && r.checkOut ? Math.max(0, Math.round((r.checkOut.getTime() - r.checkIn.getTime()) / 60000)) : 0);
  const myTrack = trackRules(rules);
  const tracked = !u.external && tracksUser(myTrack, u.id);
  const st = tracked ? await prisma.locationStatus.findUnique({ where: { userId: u.id } }) : null;
  const offByMe = !!(st?.declinedAt && (!st.consentAt || st.declinedAt > st.consentAt));
  const sharingNow = tracked && state === "in" && (await trackNow(u.id, rules)).ok;
  const lateNow = !mine && !off && dhakaMinutes(new Date()) > Number(my.start.slice(0, 2)) * 60 + Number(my.start.slice(3)) + my.graceMin;
  return (
    <>
      <h1 className="h1">Attendance</h1>
      <Flash sp={sp} />
      {Tabs}
      <div className="card">
        <div className="row">
          <b className="grow">Today · {fmtDay(today, { weekday: "long", day: "numeric", month: "short" })}</b>
          {u.external ? <span className="pill p-grey">No attendance for you</span>
            : mine?.status === "LEAVE" ? <span className="pill p-violet">Leave</span>
            : mine?.status === "ABSENT" ? <span className="pill p-bad">Absent</span>
            : mine?.checkIn ? <span className={`pill ${mine.late ? "p-amber" : "p-good"}`}>{mine.late ? "Late" : "On time"}</span>
            : off ? <span className="pill p-grey">Weekly off day</span>
            : <span className={`pill ${lateNow ? "p-amber" : "p-grey"}`}>{lateNow ? "Not checked in · late" : "Not checked in"}</span>}
        </div>
        <div className="small muted">Your office time {my.start} – {my.end} · late after {my.graceMin} minutes</div>
        {mine?.checkIn && <div>In <b>{clock(mine.checkIn)}</b>{mine.checkOut ? <> · Out <b>{clock(mine.checkOut)}</b> · {Math.floor(worked(mine) / 60)}h {worked(mine) % 60}m</> : null}{mine.method === "admin" ? <span className="small muted"> · set by admin</span> : null}</div>}
        {mine && (mine.selfieIn || mine.selfieOut) && (
          <div className="row" style={{ gap: 8 }}>
            {mine.selfieIn && <img src={`/api/attendance/selfie/${mine.id}?k=in`} alt="Your check-in selfie" className="selfie-thumb big" />}
            {mine.selfieOut && <img src={`/api/attendance/selfie/${mine.id}?k=out`} alt="Your check-out selfie" className="selfie-thumb big" />}
            {mine.method === "field" && <span className="pill p-pri">Field check-in</span>}
          </div>
        )}
        <AttButtons state={state} selfie={selfieFor(rules, u.id)} />
        {tracked && state !== "done" && <MyLocation status={offByMe ? "off-by-me" : sharingNow ? "on" : "waiting"} everyMin={myTrack.everyMin} canResume={state === "in"} />}
        {!u.external && <Link href="/attendance?tab=leave" className="small" style={{ alignSelf: "flex-start" }}>Need a day off? Apply for leave →</Link>}
      </div>
      {admin && rules.wifi.length === 0 && (
        <div className="card">
          <b>Office WiFi is not set yet</b>
          <p className="hint">Nobody can check in until the office router is saved. Do this once, in the office, with this phone on the office WiFi.</p>
          <SetOfficeWifi />
        </div>
      )}
      <div className="stats three">
        <div className="stat"><b>{rows.filter((r) => r.status === "PRESENT").length}</b><span>Days present this month</span></div>
        <div className="stat"><b>{rows.filter((r) => r.late).length}</b><span>Late</span></div>
        <div className="stat"><b>{rows.filter((r) => r.status === "LEAVE").length}</b><span>Leave</span></div>
      </div>
      <div className="h2">This month</div>
      {rows.length ? (
        <div className="card" style={{ gap: 0, padding: 0 }}>
          {rows.map((r) => (
            <div key={r.id} className="attrow"><div className="sum">
              <span className="grow"><b>{fmtDay(r.date, { weekday: "short", day: "numeric", month: "short" })}</b></span>
              {r.status !== "PRESENT" ? <span className={`pill ${r.status === "LEAVE" ? "p-violet" : "p-bad"}`}>{r.status === "LEAVE" ? (r.paidLeave === false ? "Leave · unpaid" : "Leave") : "Absent"}</span>
                : <><span className="small mono">{clock(r.checkIn)}{r.checkOut ? ` – ${clock(r.checkOut)}` : ""}</span><span className={`pill ${r.late ? "p-amber" : "p-good"}`}>{r.late ? "Late" : "On time"}</span></>}
            </div></div>
          ))}
        </div>
      ) : <div className="empty">No attendance this month yet.</div>}
    </>
  );
}
