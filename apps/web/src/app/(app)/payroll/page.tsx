import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { initials, todayDhaka } from "@/lib/format";
import { paySheet, monthOf, validMonth, type PayLine } from "@/lib/payroll";
import { Flash } from "@/components/TaskCard";
import { payEditLineAction, payFinaliseAction, paySavePersonAction, paySaveRulesAction, payDemoAction } from "@/app/payActions";

const tk = (n: number) => "৳" + Math.round(n).toLocaleString("en-US");
const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(m + "-01T00:00:00Z"));
const shift = (m: string, by: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7); };

function Slip({ l, month }: { l: PayLine; month: string }) {
  return (
    <div className="card">
      <div className="row"><b className="grow">Pay slip · {monthLabel(month)}</b><span className={`pill ${l.status === "FINAL" ? "p-good" : "p-amber"}`}>{l.status === "FINAL" ? "Final" : "Not final yet"}</span></div>
      {!l.hasPay && l.status !== "FINAL" ? <p className="hint">Your salary is not set in the app yet. HR sets it.</p> : (
        <div className="payrows">
          <div><span>Basic salary</span><b>{tk(l.basic)}</b></div>
          {l.allowance > 0 && <div><span>Allowance</span><b>{tk(l.allowance)}</b></div>}
          {l.otPay > 0 && <div><span>Overtime ({l.otHours} hours × ৳{l.hourRate})</span><b>+ {tk(l.otPay)}</b></div>}
          {l.bonus > 0 && <div><span>Bonus</span><b>+ {tk(l.bonus)}</b></div>}
          {l.cut > 0 && <div><span>Unpaid days ({l.unpaidDays} × {tk(l.dayRate)})</span><b>− {tk(l.cut)}</b></div>}
          {l.deduction > 0 && <div><span>Other deduction</span><b>− {tk(l.deduction)}</b></div>}
          <div className="tot"><span>Net pay</span><b>{tk(l.net)}</b></div>
        </div>
      )}
      <div className="small muted">Attendance this month: {l.present} present · {l.late} late · {l.leave} leave · {l.absent} absent</div>
      {l.note && <div className="small">Note: {l.note}</div>}
      {l.status !== "FINAL" && l.hasPay && <p className="hint">This is the running figure. It can change until HR makes the month final.</p>}
    </div>
  );
}

export default async function Payroll({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string; e?: string; ok?: string }> }) {
  const u = await requireModule("payroll");
  const sp = await searchParams;
  const admin = u.has("payroll");
  const month = validMonth(sp.month) ? sp.month : monthOf(todayDhaka());
  const tab = admin ? (sp.tab === "setup" ? "setup" : sp.tab === "mine" ? "mine" : "sheet") : "mine";
  const Tabs = admin && (
    <div className="chips" style={{ marginBottom: 4 }}>
      <Link className="chip" href={`/payroll?month=${month}`} aria-current={tab === "sheet" ? "page" : undefined}>Salary sheet</Link>
      <Link className="chip" href="/payroll?tab=setup" aria-current={tab === "setup" ? "page" : undefined}>Salary setup</Link>
      <Link className="chip" href={`/payroll?tab=mine&month=${month}`} aria-current={tab === "mine" ? "page" : undefined}>My pay slip</Link>
    </div>
  );
  const MonthNav = ({ q }: { q: string }) => (
    <div className="row" style={{ gap: 8 }}>
      <Link className="btn sm" href={`/payroll?${q}month=${shift(month, -1)}`}>‹</Link>
      <b>{monthLabel(month)}</b>
      {month < monthOf(todayDhaka()) && <Link className="btn sm" href={`/payroll?${q}month=${shift(month, 1)}`}>›</Link>}
    </div>
  );

  if (tab === "mine") {
    const { lines } = u.external ? { lines: [] } : await paySheet(month, u.id);
    return (
      <>
        <h1 className="h1">Payroll</h1>
        <Flash sp={sp} />
        {Tabs}
        <MonthNav q={admin ? "tab=mine&" : ""} />
        {lines[0] ? <Slip l={lines[0]} month={month} /> : <div className="empty">No payroll for you.</div>}
      </>
    );
  }

  if (tab === "setup") {
    const [{ rules }, people] = await Promise.all([paySheet(month), prisma.user.findMany({ where: { active: true, external: false }, orderBy: { name: "asc" } })]);
    const set = people.filter((p) => rules.people[p.id]).length;
    const demoCount = Object.values(rules.people).filter((p) => p.note === "DEMO").length;
    return (
      <>
        <h1 className="h1">Payroll</h1>
        <Flash sp={sp} />
        {Tabs}
        <div className="card" style={{ gap: 0, padding: 0 }}>
          <div style={{ padding: "12px 14px" }}>
            <b>Salary of each person</b> <span className="pill p-grey">{set} of {people.length} set</span>
            <p className="hint">Tap a name and write that person&apos;s monthly basic salary and fixed allowance. Only payroll admins see this page.</p>
          </div>
          {people.map((p) => {
            const pay = rules.people[p.id];
            return (
              <details key={p.id} className="attrow">
                <summary>
                  <span className="av sm">{initials(p.name)}</span>
                  <span className="grow"><b>{p.name}</b><span className="small muted">{p.designation ?? ""}</span></span>
                  {pay ? <span className="small mono">{tk(pay.basic)}{pay.allowance ? ` + ${tk(pay.allowance)}` : ""}</span> : <span className="pill p-amber">Not set</span>}
                </summary>
                <form action={paySavePersonAction} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 14px 14px" }}>
                  <input type="hidden" name="userId" value={p.id} />
                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                    <label className="field">Basic salary (৳ per month)<input name="basic" inputMode="numeric" defaultValue={pay?.basic ?? ""} className="inp" required /></label>
                    <label className="field">Fixed allowance (৳ per month)<input name="allowance" inputMode="numeric" defaultValue={pay?.allowance ?? ""} className="inp" /></label>
                  </div>
                  <label className="field">Note (for example what the allowance is for)<input name="note" defaultValue={pay?.note ?? ""} className="inp" /></label>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn sm primary" name="mode" value="save">Save</button>
                    {pay && <button className="btn sm" name="mode" value="clear" formNoValidate>Remove salary</button>}
                  </div>
                </form>
              </details>
            );
          })}
        </div>
        <form action={payDemoAction} className="card">
          <b>Demo data</b> {demoCount > 0 && <span className="pill p-amber">{demoCount} demo salaries in use</span>}
          <p className="hint">To see how the salary sheet and the Google Sheet look before the real figures are in. For the month you choose: everyone without a salary gets ৳10,000, everyone is present on time, and you (the admin who presses the button) are the example with 3 absent days, 2 late days and 40 overtime hours. Everything is marked DEMO and real entries are never changed.</p>
          <div className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="field">Month<input type="month" name="month" defaultValue={shift(monthOf(todayDhaka()), -1)} max={monthOf(todayDhaka())} className="inp" /></label>
            <button className="btn sm" name="mode" value="fill">Add demo data</button>
            <button className="btn sm" name="mode" value="clear">Remove demo data</button>
          </div>
        </form>
        <form action={paySaveRulesAction} className="card">
          <b>Rules for everyone</b>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <label className="field">One day&apos;s pay = basic ÷<input type="number" name="daysInMonth" min={1} max={31} defaultValue={rules.daysInMonth} className="inp" /></label>
            <label className="field">Working hours in a day (for overtime)<input type="number" name="hoursPerDay" min={1} max={24} step="0.5" defaultValue={rules.hoursPerDay} className="inp" /></label>
            <label className="field">How many late days cut 1 day&apos;s pay (0 = none)<input type="number" name="latesPerDay" min={0} max={31} defaultValue={rules.latesPerDay} className="inp" /></label>
            <label className="field">Count absence from this date<input type="date" name="countFrom" defaultValue={rules.countFrom} className="inp" /></label>
          </div>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="cutAbsent" defaultChecked={rules.cutAbsent} /> Cut one day&apos;s pay for each absent day</label>
          <p className="hint">One overtime hour is paid basic ÷ days ÷ working hours (the same as a normal hour). Absence is counted only from the date above, so the days before the team started checking in are not counted as absent. Empty = from the first check-in in the app.</p>
          <button className="btn primary" style={{ alignSelf: "flex-start" }}>Save rules</button>
        </form>
      </>
    );
  }

  const { lines, countFrom, rules } = await paySheet(month);
  const withPay = lines.filter((l) => l.hasPay || l.status === "FINAL");
  const allFinal = withPay.length > 0 && withPay.every((l) => l.status === "FINAL");
  const total = withPay.reduce((a, l) => a + l.net, 0);
  return (
    <>
      <h1 className="h1">Payroll</h1>
      <Flash sp={sp} />
      {Tabs}
      <MonthNav q="" />
      <div className="stats three">
        <div className="stat"><b>{tk(total)}</b><span>Total net pay</span></div>
        <div className="stat"><b>{withPay.length}<small> / {lines.length}</small></b><span>People with salary set</span></div>
        <div className="stat"><b>{allFinal ? "Final" : "Draft"}</b><span>{monthLabel(month)}</span></div>
      </div>
      {Object.values(rules.people).some((p) => p.note === "DEMO") && <div className="warn"><b>Demo figures.</b> Some salaries and attendance days here are demo data. Remove them in <Link href="/payroll?tab=setup" className="linkb">Salary setup</Link> before the real payroll.</div>}
      {lines.length > withPay.length && <div className="warn">{lines.length - withPay.length} people have no salary set yet. Set it in <Link href="/payroll?tab=setup" className="linkb">Salary setup</Link>.</div>}
      {!countFrom && <p className="hint">Nobody has checked in yet, so no absent days are counted.</p>}
      <div className="card" style={{ gap: 0, padding: 0 }}>
        {lines.map((l) => (
          <details key={l.userId} className="attrow">
            <summary>
              <span className="av sm">{initials(l.name)}</span>
              <span className="grow"><b>{l.name}</b><span className="small muted">{l.present} present · {l.late} late · {l.absent} absent</span></span>
              {l.status === "FINAL" ? <span className="pill p-good">Final</span> : l.edited || l.bonus || l.deduction || l.otHours ? <span className="pill p-pri">Edited</span> : null}
              <b className="mono">{l.hasPay || l.status === "FINAL" ? tk(l.net) : "—"}</b>
            </summary>
            {l.status === "FINAL" ? (
              <div className="small muted" style={{ padding: "0 14px 12px" }}>Basic {tk(l.basic)} + allowance {tk(l.allowance)} + bonus {tk(l.bonus)} + overtime {l.otHours} h ({tk(l.otPay)}) − {l.unpaidDays} unpaid days ({tk(l.cut)}) − deduction {tk(l.deduction)}{l.note ? ` · ${l.note}` : ""}. Reopen the month to change it.</div>
            ) : (
              <form action={payEditLineAction} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 14px 14px" }}>
                <input type="hidden" name="userId" value={l.userId} /><input type="hidden" name="month" value={month} />
                <div className="small muted">Basic {tk(l.basic)} + allowance {tk(l.allowance)} · one day = {tk(l.dayRate)} · one hour = ৳{l.hourRate} · from attendance: {l.autoUnpaid} unpaid day{l.autoUnpaid === 1 ? "" : "s"}</div>
                <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                  <label className="field">Unpaid days<input name="unpaidDays" inputMode="decimal" defaultValue={l.unpaidDays} className="inp" /></label>
                  <label className="field">Overtime hours<input name="overtimeHours" inputMode="decimal" defaultValue={l.otHours || ""} className="inp" /></label>
                  <label className="field">Bonus (৳)<input name="bonus" inputMode="numeric" defaultValue={l.bonus || ""} className="inp" /></label>
                  <label className="field">Other deduction (৳)<input name="deduction" inputMode="numeric" defaultValue={l.deduction || ""} className="inp" /></label>
                </div>
                <label className="field">Note (why)<input name="note" defaultValue={l.note ?? ""} className="inp" /></label>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn sm primary" name="mode" value="save">Save</button>
                  {l.edited && <button className="btn sm" name="mode" value="auto">Use the days from attendance</button>}
                </div>
              </form>
            )}
          </details>
        ))}
      </div>
      <form action={payFinaliseAction} className="card">
        <input type="hidden" name="month" value={month} />
        {allFinal ? (
          <><b>{monthLabel(month)} is final</b><p className="hint">Everyone can see their pay slip. Open the month again if something must change.</p><button className="btn" name="mode" value="reopen" style={{ alignSelf: "flex-start" }}>Open the month again</button></>
        ) : (
          <><b>Finalise {monthLabel(month)}</b><p className="hint">This fixes the figures above for everyone who has a salary set. After that, changes in attendance no longer change this month&apos;s pay.</p><button className="btn primary" name="mode" value="final" style={{ alignSelf: "flex-start" }}>Finalise the month</button></>
        )}
      </form>
    </>
  );
}
