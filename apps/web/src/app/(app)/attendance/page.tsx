import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { fmtDay, todayDhaka, initials } from "@/lib/format";
import { getAttRules, clock, dhakaMinutes, DAY_NAMES } from "@/lib/attendance";
import { Flash } from "@/components/TaskCard";
import { AttButtons, SetOfficeWifi } from "@/components/AttButtons";
import { attAdminSetAction, attRemoveWifiAction, attSaveRulesAction } from "@/app/attActions";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const hhmm = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "");

export default async function Attendance({ searchParams }: { searchParams: Promise<{ tab?: string; day?: string; e?: string; ok?: string }> }) {
  const u = await requireModule("attendance");
  const sp = await searchParams;
  const admin = u.can("attendance", "EDIT");
  const tab = (sp.tab === "team" || sp.tab === "rules") && admin ? sp.tab : "me";
  const today = todayDhaka();
  const rules = await getAttRules();
  const Tabs = (
    <div className="chips" style={{ marginBottom: 4 }}>
      <Link className="chip" href="/attendance" aria-current={tab === "me" ? "page" : undefined}>My day</Link>
      {admin && <Link className="chip" href="/attendance?tab=team" aria-current={tab === "team" ? "page" : undefined}>Team today</Link>}
      {admin && <Link className="chip" href="/attendance?tab=rules" aria-current={tab === "rules" ? "page" : undefined}>Rules</Link>}
    </div>
  );

  if (tab === "team") {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? new Date(sp.day + "T00:00:00Z") : today;
    const [people, rows] = await Promise.all([
      prisma.user.findMany({ where: { active: true, external: false }, orderBy: { name: "asc" } }),
      prisma.attendance.findMany({ where: { date: day } }),
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
            return (
              <details key={p.id} className="attrow">
                <summary>
                  <span className="av sm">{initials(p.name)}</span>
                  <span className="grow"><b>{p.name}</b><span className="small muted"> · {p.designation ?? ""}</span></span>
                  {!a ? <span className="pill p-grey">{off ? "Off day" : "Not in"}</span>
                    : a.status === "LEAVE" ? <span className="pill p-violet">Leave</span>
                    : a.status === "ABSENT" ? <span className="pill p-bad">Absent</span>
                    : <><span className={`pill ${a.late ? "p-amber" : "p-good"}`}>{a.late ? "Late" : "On time"}</span><span className="small mono">{clock(a.checkIn)}{a.checkOut ? ` – ${clock(a.checkOut)}` : ""}</span>{a.method === "admin" && <span className="pill p-grey">by admin</span>}</>}
                </summary>
                <form action={attAdminSetAction} className="row" style={{ gap: 8, flexWrap: "wrap", padding: "0 14px 12px" }}>
                  <input type="hidden" name="userId" value={p.id} /><input type="hidden" name="date" value={iso(day)} />
                  <select name="status" className="inp" style={{ width: "auto" }} defaultValue={a?.status ?? "PRESENT"}>
                    <option value="PRESENT">Present</option><option value="LEAVE">Leave</option><option value="ABSENT">Absent</option><option value="CLEAR">Clear the day</option>
                  </select>
                  <label className="small">In <input type="time" name="in" defaultValue={hhmm(a?.checkIn ?? null) || rules.start} className="inp" style={{ width: "auto" }} /></label>
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

  if (tab === "rules") {
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
      </>
    );
  }

  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const rows = await prisma.attendance.findMany({ where: { userId: u.id, date: { gte: monthStart, lte: today } }, orderBy: { date: "desc" } });
  const mine = rows.find((r) => r.date.getTime() === today.getTime());
  const off = rules.weeklyOff.includes(today.getUTCDay());
  const state = u.external ? "off" : mine?.checkOut || (mine && mine.status !== "PRESENT") ? "done" : mine?.checkIn ? "in" : "none";
  const worked = (r: (typeof rows)[number]) => (r.checkIn && r.checkOut ? Math.max(0, Math.round((r.checkOut.getTime() - r.checkIn.getTime()) / 60000)) : 0);
  const lateNow = !mine && !off && dhakaMinutes(new Date()) > Number(rules.start.slice(0, 2)) * 60 + Number(rules.start.slice(3)) + rules.graceMin;
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
        <div className="small muted">Office time {rules.start} – {rules.end} · late after {rules.graceMin} minutes</div>
        {mine?.checkIn && <div>In <b>{clock(mine.checkIn)}</b>{mine.checkOut ? <> · Out <b>{clock(mine.checkOut)}</b> · {Math.floor(worked(mine) / 60)}h {worked(mine) % 60}m</> : null}{mine.method === "admin" ? <span className="small muted"> · set by admin</span> : null}</div>}
        <AttButtons state={state} />
      </div>
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
              {r.status !== "PRESENT" ? <span className={`pill ${r.status === "LEAVE" ? "p-violet" : "p-bad"}`}>{r.status === "LEAVE" ? "Leave" : "Absent"}</span>
                : <><span className="small mono">{clock(r.checkIn)}{r.checkOut ? ` – ${clock(r.checkOut)}` : ""}</span><span className={`pill ${r.late ? "p-amber" : "p-good"}`}>{r.late ? "Late" : "On time"}</span></>}
            </div></div>
          ))}
        </div>
      ) : <div className="empty">No attendance this month yet.</div>}
    </>
  );
}
