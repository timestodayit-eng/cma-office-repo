import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { fmtDay, todayDhaka } from "@/lib/format";
import { getSheetConfig } from "@/lib/outbox";
import { loadRecTab, duplicateNames } from "@/lib/recSheet";
import { recCols, recKeyCols, REC_TAB_STYLE } from "@/lib/recCols";
import { RecGrid } from "@/components/RecGrid";

type SP = { co?: string; past?: string; view?: string; tab?: string };

export default async function Interviews({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  return sp.view === "list" ? <TimelineList sp={sp} /> : <SheetView sp={sp} />;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The Recruitment sheet's agency tabs, shown like the Google Sheet (same as the Log Sheet). */
async function SheetView({ sp }: { sp: SP }) {
  const u = await requireModule("interviews");
  const today = todayDhaka();
  const [companies, cfg] = await Promise.all([prisma.company.findMany({ orderBy: { sortOrder: "asc" } }), getSheetConfig()]);
  const tabs = await Promise.all(companies.map((c) => loadRecTab(c.sheetTab ?? c.name, c.id)));
  const at = Math.max(0, companies.findIndex((c) => c.short === sp.tab));
  const t = tabs[at];
  const company = companies[at];
  const money = u.can("recruitment");
  const soon = new Date(today); soon.setUTCDate(soon.getUTCDate() + 7);
  const last = cfg.last?.recruitment;
  const connected = !!last && Date.now() - new Date(last.at).getTime() < 26 * 3600_000;
  const canEdit = t.fromSheet && (u.can("interviews", "EDIT") || u.can("recruitment", "EDIT"));
  return (
    <>
      <div className="gs">
        <div className="gsh">
          <span className="gsi">▦</span>
          <div className="grow"><b>Interview List</b><span>{connected ? "Connected to the Recruitment Google Sheet · two-way sync" : "Not connected to the Recruitment Google Sheet yet"}</span></div>
          {last?.url ? <a className="btn sm" href={last.url} target="_blank" rel="noreferrer">Open in Google ↗</a> : <Link className="btn sm" href="/settings/sheets">Connect the sheet</Link>}
        </div>
        <div className={`gsn${connected && t.fromSheet ? "" : " off"}`}><span className="dot" />
          {!t.fromSheet
            ? <span><b>Waiting for the sheet.</b> These rows come from the app until the Recruitment sheet sends this tab (it does on every edit and every 15 minutes). Editing opens after that.</span>
            : connected
              ? <span><b>Two-way sync with Google Sheet.</b> Type here and it goes to the same cell of the sheet. Type in the sheet and it comes here. Enter goes down, Tab goes right.{money ? " PC, cost, CPP, leads and conversion are filled in the sheet only." : ""}</span>
              : <span><b>Not synced right now.</b> What you type here is saved and goes to the sheet when it connects again.</span>}
        </div>
        <div className="gsb">
          <RecGrid key={t.tab} tab={t.tab} rows={t.rows} cols={recCols(t.tab, t.header, { money })} keys={recKeyCols(t.header)}
            today={iso(today)} soonEnd={iso(soon)} dup={duplicateNames(tabs)} canEdit={canEdit} canAdd={u.can("interviews", "EDIT")} />
        </div>
        <div className="gst">
          <span className="gsm">☰</span>
          {companies.map((c, i) => (
            <Link key={c.id} href={`/interviews?tab=${c.short}`} aria-current={i === at ? "page" : undefined}
              style={i === at ? { boxShadow: `inset 0 -3px 0 ${REC_TAB_STYLE[c.name]?.head ?? "#188038"}`, color: REC_TAB_STYLE[c.name]?.head } : undefined}>{c.sheetTab ?? c.name}</Link>
          ))}
          <Link href="/interviews?view=list" style={{ marginLeft: "auto" }}>Timeline view ›</Link>
        </div>
      </div>
      <p className="hint">The same three agency tabs as the Recruitment Google Sheet, with its columns, dropdowns and colours: this week&apos;s interviews are highlighted, other dates are grey, a company name used twice is red. {company ? `${t.rows.length} rows in ${company.name}.` : ""}</p>
    </>
  );
}

/** The earlier card list with each interview's video timeline progress. */
async function TimelineList({ sp }: { sp: SP }) {
  const u = await requireModule("interviews");
  const today = todayDhaka();
  const companies = await prisma.company.findMany({ orderBy: { sortOrder: "asc" } });
  const past = sp.past === "1";
  const list = await prisma.interview.findMany({
    where: { interviewDate: past ? { lt: today } : { gte: today }, ...(sp.co ? { companyId: sp.co } : {}) },
    include: { company: true, tasks: { select: { status: true, stepKey: true, title: true, assignee: { select: { shortName: true, name: true } } }, orderBy: { order: "asc" } } },
    orderBy: { interviewDate: past ? "desc" : "asc" },
    take: 100,
  });
  const q = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ view: "list", co: sp.co, past: sp.past, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 className="h1">Interviews</h1>
        <span className="row">
          <Link href="/interviews" className="btn sm">▦ Sheet view</Link>
          {u.can("interviews", "EDIT") && <Link href="/interviews/new" className="btn primary sm">+ New interview</Link>}
        </span>
      </div>
      <nav className="seg">
        <Link href={q({ past: undefined })} aria-current={!past ? "page" : undefined}>Upcoming</Link>
        <Link href={q({ past: "1" })} aria-current={past ? "page" : undefined}>Done</Link>
      </nav>
      <div className="row">
        <Link href={q({ co: undefined })} className={`pill ${!sp.co ? "p-pri" : "p-grey"}`}>All</Link>
        {companies.map((c) => <Link key={c.id} href={q({ co: c.id })} className={`pill ${sp.co === c.id ? "p-pri" : "p-grey"}`}>{c.name}</Link>)}
      </div>
      {list.length === 0 ? <div className="empty">No interviews here yet.</div> : (
        <div className="list">
          {list.map((iv) => {
            const cur = iv.tasks.find((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
            const done = iv.tasks.filter((t) => t.status === "DONE" || t.status === "SKIPPED").length;
            return (
              <Link key={iv.id} href={`/interviews/${iv.id}`} className="li">
                <span className="datebox"><b>{fmtDay(iv.interviewDate, { day: "numeric" })}</b><span>{fmtDay(iv.interviewDate, { month: "short" })}</span></span>
                <span className="grow">
                  <b>{iv.title}</b>
                  <span>{iv.company.short} · {iv.country}{cur ? ` · now: ${cur.title} (${cur.assignee?.shortName ?? cur.assignee?.name ?? "editors"})` : ""}</span>
                </span>
                {iv.tasks.length > 0 && <span className="pill p-grey">{done}/{iv.tasks.length}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
