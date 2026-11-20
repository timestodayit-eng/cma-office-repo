import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { dayTabName, statusCheck, countReport, ordinal, CONTENT_TYPES, FINISHED_STATUSES } from "@cma/core";
import { todayDhaka } from "@/lib/format";
import { getSheetConfig } from "@/lib/outbox";
import { LOG_COLS } from "@/lib/sheetRules";
import { LOG_COL_DEFS, ROW_COLOR, inkOn } from "@/lib/logLists";
import { LogGrid, type GridRow } from "@/components/LogGrid";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const isUrl = (v: string | null) => !!v && /^https?:\/\//i.test(v);

type SP = { tab?: string; day?: string; from?: string; to?: string };

export default async function LogSheet({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await requireModule("logsheet");
  const sp = await searchParams;
  const today = todayDhaka();
  const todayIso = iso(today);
  const tab = ["status", "report", "monthly"].includes(sp.tab ?? "") ? sp.tab! : "day";
  const [dayRows, cfg] = await Promise.all([
    prisma.logRow.groupBy({ by: ["date"], orderBy: { date: "desc" }, take: 200 }),
    getSheetConfig(),
  ]);
  const days = dayRows.map((d) => iso(d.date)).filter((d) => d < todayIso);
  const dayIso = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : todayIso;
  const last = cfg.last?.log;
  const connected = !!last && Date.now() - new Date(last.at).getTime() < 26 * 3600_000;

  const monthStart = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const from = sp.from ?? monthStart;
  const to = sp.to ?? todayIso;
  const repBar = (
    <form className="logbar">
      <input type="hidden" name="tab" value={tab} />
      <label className="hint">From <input className="switch" type="date" name="from" defaultValue={from} /></label>
      <label className="hint">To <input className="switch" type="date" name="to" defaultValue={to} /></label>
      <button className="btn sm">Show</button>
    </form>
  );

  let body: React.ReactNode;
  if (tab === "status") {
    const since = new Date(today); since.setUTCDate(since.getUTCDate() - 35);
    const rows = await prisma.logRow.findMany({ where: { date: { gte: since }, status: { not: null } }, orderBy: [{ date: "desc" }, { rowIndex: "asc" }] });
    const open = statusCheck(rows.map((r) => ({ ...r, date: iso(r.date) })), todayIso);
    body = (
      <>
        <div className="logbar"><span className="hint">Every row of the last 35 days that is not Uploaded, Cancelled, In Ads, Dropped or Reserved. Newest first.</span><span className="hint" style={{ marginLeft: "auto" }}>Pending: <b className="ink">{open.length}</b></span></div>
        <div className="sheetwrap"><table className="sheet log">
          <colgroup><col style={{ width: 38 }} /><col style={{ width: 70 }} />{LOG_COL_DEFS.map((c) => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
          <thead><tr><th className="rn">SN</th><th style={{ background: "#9FC5E8", color: "#1c2733" }}>Date</th>{LOG_COL_DEFS.map((c) => <th key={c.key} style={{ background: c.color, color: inkOn(c.color) }}>{c.label}</th>)}</tr></thead>
          <tbody>{open.map((r, n) => {
            const sc = ROW_COLOR[r.status ?? ""];
            const style = sc ? { background: sc[0], color: sc[1] } : undefined;
            return (
              <tr key={r.id}><td className="rn">{n + 1}</td><td className="lock"><Link href={`/logsheet?day=${r.date}`}>{dayTabName(new Date(r.date))}</Link></td>
                {LOG_COL_DEFS.map((c) => {
                  const v = (r as unknown as Record<string, string | null>)[c.key];
                  return <td key={c.key} style={style} title={v ?? ""}>{c.kind === "list" && v ? <span className="dd"><span>{v}</span></span> : isUrl(v) ? <a href={v!} target="_blank" rel="noreferrer">Link ↗</a> : v}</td>;
                })}
              </tr>
            );
          })}</tbody>
        </table></div>
      </>
    );
  } else if (tab === "report" || tab === "monthly") {
    const rows = (await prisma.logRow.findMany({ where: { date: { gte: new Date(from), lte: new Date(to) }, title: { not: null } } })).map((r) => ({ ...r, date: iso(r.date) }));
    if (tab === "report") {
      const opts = { from, to, today: todayIso };
      const tables: [string, ReturnType<typeof countReport>][] = [
        ["Company-wise", countReport(rows, (r) => r.company, opts)],
        ["Script Writter-wise", countReport(rows, (r) => r.scriptWriter, opts)],
        ["Video Editor-wise", countReport(rows, (r) => r.videoEditor, opts)],
      ];
      const done = rows.filter((r) => r.status && FINISHED_STATUSES.has(r.status));
      const roles: [string, (r: (typeof rows)[number]) => string | null][] = [["Presenter", (r) => r.presenter], ["Script", (r) => r.scriptWriter], ["Cinematographer", (r) => r.cinematographer], ["Video Editor", (r) => r.videoEditor], ["Thumbnail", (r) => r.thumbnail]];
      const team = new Map<string, number[]>();
      for (const r of done) roles.forEach(([, get], i) => {
        const k = get(r)?.trim();
        if (!k) return;
        const a = team.get(k) ?? roles.map(() => 0); a[i]++; team.set(k, a);
      });
      const teamRows = [...team.entries()].map(([k, a]) => [k, a, a.reduce((x, y) => x + y, 0)] as const).sort((a, b) => b[2] - a[2]);
      body = (
        <>
          {repBar}
          <div className="gspad">
            {tables.map(([name, t]) => {
              const keys = Object.keys(t.totals).sort((a, b) => t.rank[a] - t.rank[b]);
              return (
                <div key={name} className="stack">
                  <div className="h2">{name}</div>
                  <div className="sheetwrap auto"><table className="sheet rep">
                    <thead><tr><th>Name</th>{CONTENT_TYPES.map((ct) => <th key={ct}>{ct}</th>)}<th>Today</th><th>Total</th><th>Avg</th><th>Evaluation</th></tr></thead>
                    <tbody>{keys.map((k) => (
                      <tr key={k}><td><b>{k}</b></td>{CONTENT_TYPES.map((ct) => <td key={ct} className={`num ${t.rows[k][ct] ? "" : "zero"}`}>{t.rows[k][ct] ?? 0}</td>)}
                        <td className={`num ${t.today[k] ? "hit" : "zero"}`}>{t.today[k] ?? 0}</td><td className="num"><b>{t.totals[k]}</b></td><td className="num">{t.avg[k]}</td><td className="num">{ordinal(t.rank[k])}</td></tr>
                    ))}{!keys.length && <tr><td colSpan={CONTENT_TYPES.length + 5}>No rows in this period.</td></tr>}</tbody>
                  </table></div>
                </div>
              );
            })}
            <div className="stack">
              <div className="h2">Team Report <small>finished work (Uploaded or In Ads)</small></div>
              <div className="sheetwrap auto"><table className="sheet rep">
                <thead><tr><th>Name</th>{roles.map(([l]) => <th key={l}>{l}</th>)}<th>Total</th></tr></thead>
                <tbody>{teamRows.map(([k, a, t]) => <tr key={k}><td><b>{k}</b></td>{a.map((n, i) => <td key={i} className={`num ${n ? "" : "zero"}`}>{n}</td>)}<td className="num"><b>{t}</b></td></tr>)}
                  {!teamRows.length && <tr><td colSpan={roles.length + 2}>No finished work in this period.</td></tr>}</tbody>
              </table></div>
            </div>
          </div>
        </>
      );
    } else {
      const types: string[] = [...CONTENT_TYPES];
      for (const r of rows) if (r.contentType && !types.includes(r.contentType)) types.push(r.contentType);
      const d = types.map((t) => {
        const m = rows.filter((r) => r.contentType === t);
        const c = m.filter((r) => r.status && FINISHED_STATUSES.has(r.status)).length;
        const a = m.filter((r) => !(r.status && FINISHED_STATUSES.has(r.status)) && !["Dropped", "Cancelled"].includes(r.status ?? "")).length;
        return [t, c, a, c + a] as const;
      });
      const S = (k: 1 | 2 | 3) => d.reduce((a, x) => a + x[k], 0);
      body = (
        <>
          {repBar}
          <div className="gspad">
            <div className="stats three"><div className="stat"><b>{S(1)}</b><span>Completed</span></div><div className="stat"><b>{S(2)}</b><span>Active / pending</span></div><div className="stat"><b>{S(3)}</b><span>Total</span></div></div>
            <div className="sheetwrap auto"><table className="sheet rep" style={{ width: "100%" }}>
              <thead><tr><th>Content Category</th><th>Completed</th><th>Active / Pending</th><th>Total</th></tr></thead>
              <tbody>{d.map((x) => <tr key={x[0]}><td><b>{x[0]}</b></td><td className={`num ${x[1] ? "hit" : "zero"}`}>{x[1]}</td><td className={`num ${x[2] ? "" : "zero"}`}>{x[2]}</td><td className="num"><b>{x[3]}</b></td></tr>)}
                <tr className="tot"><td><b>Total</b></td><td className="num"><b>{S(1)}</b></td><td className="num"><b>{S(2)}</b></td><td className="num"><b>{S(3)}</b></td></tr></tbody>
            </table></div>
          </div>
        </>
      );
    }
  } else {
    const rows = await prisma.logRow.findMany({ where: { date: new Date(dayIso) }, orderBy: { rowIndex: "asc" } });
    const grid: GridRow[] = rows.map((r) => ({
      id: r.id, rowIndex: r.rowIndex,
      cells: Object.fromEntries(LOG_COLS.map((k) => [k, (r as unknown as Record<string, string | null>)[k] ?? ""])),
    }));
    body = <LogGrid key={dayIso} date={dayIso} rows={grid} canEdit={u.can("logsheet", "EDIT")} />;
  }

  const dayB = (d: string) => (
    <Link key={d} href={`/logsheet?day=${d}`} aria-current={tab === "day" && dayIso === d ? "page" : undefined}>{d === todayIso ? "● Today · " : ""}{dayTabName(new Date(d))}</Link>
  );
  return (
    <>
      <div className="gs">
        <div className="gsh">
          <span className="gsi">▦</span>
          <div className="grow"><b>Digital Media Solution Log Sheet</b><span>{connected ? "Connected to your Google Sheet · two-way sync" : "Not connected to the Google Sheet yet"}</span></div>
          {last?.url ? <a className="btn sm" href={last.url} target="_blank" rel="noreferrer">Open in Google ↗</a> : <Link className="btn sm" href="/settings/sheets">Connect the sheet</Link>}
        </div>
        <div className={`gsn${connected ? "" : " off"}`}><span className="dot" />
          {connected
            ? <span><b>Two-way sync with Google Sheet.</b> Type here and it goes to the sheet. Type in the sheet and it comes here. Enter goes down, Tab goes right.</span>
            : <span><b>Not synced yet.</b> What you type here is saved in the app and goes to the Google Sheet as soon as it is connected. Enter goes down, Tab goes right.</span>}
        </div>
        <div className="gsb">{body}</div>
        <div className="gst">
          <span className="gsm">☰</span>
          {dayB(todayIso)}
          <Link href="/logsheet?tab=status" aria-current={tab === "status" ? "page" : undefined}>Status_Check</Link>
          <Link href="/logsheet?tab=report" aria-current={tab === "report" ? "page" : undefined}>Report</Link>
          <Link href="/logsheet?tab=monthly" aria-current={tab === "monthly" ? "page" : undefined}>Monthly Report</Link>
          {days.map(dayB)}
        </div>
      </div>
      <p className="hint">Every day has its own tab with the same columns and dropdowns, here and in the Google Sheet. You can work in either place, both stay the same.</p>
    </>
  );
}
