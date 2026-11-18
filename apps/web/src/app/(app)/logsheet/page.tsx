import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { dayTabName, statusCheck, countReport, ordinal, STATUS_COLOR, LOG_STATUSES, CONTENT_TYPES } from "@cma/core";
import { todayDhaka, fmtDay } from "@/lib/format";
import { Flash } from "@/components/TaskCard";
import { saveLogRowAction, addLogRowAction } from "@/app/logActions";

const COLS: [string, string, number][] = [
  ["title", "Content Title", 240], ["deadline", "Deadline", 90], ["priority", "Priority", 80], ["company", "Company", 150],
  ["mainCategory", "Main Category", 150], ["contentType", "Content Type", 100], ["scriptWriter", "Script Writer", 110],
  ["scriptLink", "Script Link", 120], ["presenter", "Presenter", 100], ["cinematographer", "Cinematographer", 110],
  ["videoEditor", "Video Editor", 110], ["status", "Status", 120], ["thumbnail", "Thumbnail", 90], ["rawFile", "Raw File", 110],
  ["finalOutput", "Final Output", 110], ["comments", "Comments", 160], ["uploadFacebook", "Upload FB", 100],
  ["uploadYoutube", "Upload YT", 100], ["uploadTiktok", "Upload TikTok", 100], ["finalComments", "Final Comments", 160],
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function LogSheet({ searchParams }: { searchParams: Promise<{ tab?: string; day?: string; edit?: string; from?: string; to?: string; e?: string; ok?: string }> }) {
  const u = await requireModule("logsheet");
  const sp = await searchParams;
  const today = todayDhaka();
  const tab = sp.tab ?? "day";
  const days = await prisma.logRow.groupBy({ by: ["date"], _count: true, orderBy: { date: "desc" }, take: 120 });
  const latestPast = days.find((d) => d.date <= today);
  const dayIso = sp.day ?? (latestPast ? iso(latestPast.date) : iso(today));
  const canEdit = u.can("logsheet", "EDIT");

  const tabs = (
    <nav className="seg" style={{ maxWidth: 640 }}>
      <Link href="/logsheet" aria-current={tab === "day" ? "page" : undefined}>Day tabs</Link>
      <Link href="/logsheet?tab=status" aria-current={tab === "status" ? "page" : undefined}>Status_Check</Link>
      <Link href="/logsheet?tab=report" aria-current={tab === "report" ? "page" : undefined}>Report</Link>
    </nav>
  );

  if (tab === "status") {
    const from = new Date(today); from.setUTCDate(from.getUTCDate() - 35);
    const rows = await prisma.logRow.findMany({ where: { date: { gte: from }, status: { not: null } } });
    const open = statusCheck(rows.map((r) => ({ ...r, date: iso(r.date) })), iso(today));
    return (
      <>
        <h1 className="h1">Log Sheet</h1>{tabs}
        <p className="hint">Every unfinished row of the last 35 days (not Uploaded, Cancelled, In Ads, Dropped or Reserved), newest first. {open.length} rows.</p>
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Date</th><th>Title</th><th>Company</th><th>Type</th><th>Script</th><th>Editor</th><th>Status</th></tr></thead>
          <tbody>{open.map((r) => (
            <tr key={r.id} style={{ background: STATUS_COLOR[r.status ?? ""] }}>
              <td><Link href={`/logsheet?day=${r.date}`}>{fmtDay(r.date)}</Link></td><td>{r.title}</td><td>{r.company}</td><td>{r.contentType}</td><td>{r.scriptWriter}</td><td>{r.videoEditor}</td><td>{r.status}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </>
    );
  }

  if (tab === "report") {
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const from = sp.from ?? iso(monthStart);
    const to = sp.to ?? iso(today);
    const rows = (await prisma.logRow.findMany({ where: { date: { gte: new Date(from), lte: new Date(to) } } })).map((r) => ({ ...r, date: iso(r.date) }));
    const opts = { from, to, today: iso(today) };
    const tables: [string, ReturnType<typeof countReport>][] = [
      ["Company-wise", countReport(rows, (r) => r.company, opts)],
      ["Script Writer-wise", countReport(rows, (r) => r.scriptWriter, opts)],
      ["Video Editor-wise", countReport(rows, (r) => r.videoEditor, opts)],
    ];
    return (
      <>
        <h1 className="h1">Log Sheet</h1>{tabs}
        <form className="row">
          <input type="hidden" name="tab" value="report" />
          <label className="field">From<input type="date" name="from" defaultValue={from} /></label>
          <label className="field">To<input type="date" name="to" defaultValue={to} /></label>
          <button className="btn sm" style={{ alignSelf: "flex-end" }}>Show</button>
        </form>
        {tables.map(([name, t]) => {
          const keys = Object.keys(t.totals).sort((a, b) => t.rank[a] - t.rank[b]);
          const types = CONTENT_TYPES.filter((ct) => keys.some((k) => t.rows[k][ct]));
          return (
            <div key={name}>
              <div className="h2">{name}</div>
              {keys.length === 0 ? <div className="empty">No rows in this period.</div> : (
                <div className="tblwrap"><table className="tbl">
                  <thead><tr><th>Name</th>{types.map((ct) => <th key={ct}>{ct}</th>)}<th>Today</th><th>Total</th><th>Avg/day</th><th>Rank</th></tr></thead>
                  <tbody>{keys.map((k) => (
                    <tr key={k}><td><b>{k}</b></td>{types.map((ct) => <td key={ct}>{t.rows[k][ct] ?? ""}</td>)}<td>{t.today[k] ?? 0}</td><td><b>{t.totals[k]}</b></td><td>{t.avg[k]}</td><td>{ordinal(t.rank[k])}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
            </div>
          );
        })}
      </>
    );
  }

  const rows = await prisma.logRow.findMany({ where: { date: new Date(dayIso) }, orderBy: [{ rowIndex: "asc" }, { sn: "asc" }] });
  const editRow = sp.edit ? rows.find((r) => r.id === sp.edit) : null;
  return (
    <>
      <h1 className="h1">Log Sheet</h1>{tabs}
      <Flash sp={sp} />
      <div className="row" style={{ overflowX: "auto", flexWrap: "nowrap", paddingBottom: 4 }}>
        {!days.some((d) => iso(d.date) === iso(today)) && <Link className={`pill ${dayIso === iso(today) ? "p-pri" : "p-grey"}`} href={`/logsheet?day=${iso(today)}`}>{dayTabName(today)}</Link>}
        {days.map((d) => (
          <Link key={iso(d.date)} className={`pill ${iso(d.date) === dayIso ? "p-pri" : "p-grey"}`} href={`/logsheet?day=${iso(d.date)}`}>{dayTabName(d.date)} · {d._count}</Link>
        ))}
      </div>
      <div className="tblwrap"><table className="tbl" style={{ tableLayout: "fixed", width: "max-content" }}>
        <thead><tr><th style={{ width: 44 }}>SN</th>{COLS.map(([k, l, w]) => <th key={k} style={{ width: w }}>{l}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id} style={{ background: STATUS_COLOR[r.status ?? ""] }}>
            <td>{canEdit ? <Link href={`/logsheet?day=${dayIso}&edit=${r.id}`}>{r.sn ?? i + 1}</Link> : r.sn ?? i + 1}</td>
            {COLS.map(([k]) => {
              const v = (r as Record<string, unknown>)[k] as string | null;
              return <td key={k} style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={v ?? ""}>{v && /^https?:\/\//.test(v) ? <a href={v} target="_blank" rel="noreferrer">link</a> : v}</td>;
            })}
          </tr>
        ))}</tbody>
      </table></div>
      {rows.length === 0 && <div className="empty">No rows on this day yet.</div>}
      {canEdit && (
        <form className="card stack" action={editRow ? saveLogRowAction : addLogRowAction}>
          <b>{editRow ? `Edit row ${editRow.sn ?? ""}` : `Add a row to ${dayTabName(new Date(dayIso))}`}</b>
          <input type="hidden" name="day" value={dayIso} />
          {editRow && <input type="hidden" name="id" value={editRow.id} />}
          <div className="two">
            {COLS.map(([k, l]) => (
              <label key={k} className="field">{l}
                {k === "status" ? (
                  <select name={k} defaultValue={editRow?.status ?? ""}><option value="" />{LOG_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                ) : k === "contentType" ? (
                  <select name={k} defaultValue={editRow?.contentType ?? ""}><option value="" />{CONTENT_TYPES.map((s) => <option key={s}>{s}</option>)}</select>
                ) : (
                  <input name={k} defaultValue={((editRow as Record<string, unknown> | null)?.[k] as string) ?? ""} />
                )}
              </label>
            ))}
          </div>
          <div className="row"><button className="btn primary">{editRow ? "Save row" : "Add row"}</button>{editRow && <Link className="btn" href={`/logsheet?day=${dayIso}`}>Cancel</Link>}</div>
        </form>
      )}
    </>
  );
}
