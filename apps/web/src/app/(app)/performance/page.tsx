import Link from "next/link";
import { requireModule } from "@/lib/auth";
import { initials, todayDhaka } from "@/lib/format";
import { getSheetConfig } from "@/lib/outbox";
import { performance, PERF_ROLES, type PerfLine } from "@/lib/performance";
import { monthOf, validMonth } from "@/lib/payroll";
import { SyncBar } from "@/components/SyncBar";

const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(m + "-01T00:00:00Z"));
const shift = (m: string, by: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7); };

function Roles({ l }: { l: PerfLine }) {
  const rs = PERF_ROLES.filter(([k]) => l.byRole[k]);
  if (!rs.length) return null;
  return <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{rs.map(([k, label]) => <span key={k} className="pill p-grey">{label} {l.byRole[k]!.finished}/{l.byRole[k]!.total}</span>)}</div>;
}
const Bar = ({ pct }: { pct: number | null }) => (
  <div className="bar" style={{ flex: 1, minWidth: 60 }}><i style={{ width: `${pct ?? 0}%`, background: (pct ?? 0) >= 75 ? "var(--good)" : (pct ?? 0) >= 40 ? "var(--amber)" : "var(--bad)" }} /></div>
);

export default async function Performance({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const u = await requireModule("performance");
  const sp = await searchParams;
  const month = validMonth(sp.month) ? sp.month : monthOf(todayDhaka());
  // The team list is for management and the Creative Lead; everyone else sees only their own.
  const team = u.level === "SUPER_ADMIN" || u.resp.has("creative_lead" as never);
  const [{ lines, unknown, rows }, cfg] = await Promise.all([performance(month), getSheetConfig()]);
  const ranked = lines.filter((l) => l.total > 0);
  const me = lines.find((l) => l.userId === u.id);
  const myRank = ranked.findIndex((l) => l.userId === u.id) + 1;
  return (
    <>
      <h1 className="h1">Performance</h1>
      <SyncBar last={cfg.last?.log} label="the Log Sheet" />
      <div className="row" style={{ gap: 8 }}>
        <Link className="btn sm" href={`/performance?month=${shift(month, -1)}`}>‹</Link>
        <b>{monthLabel(month)}</b>
        {month < monthOf(todayDhaka()) && <Link className="btn sm" href={`/performance?month=${shift(month, 1)}`}>›</Link>}
      </div>
      <p className="hint">Counted only from the Log Sheet: each content row counts for the people named on it (script, presenter, camera, editing, thumbnail). Finished = status Uploaded or In Ads. {rows} content rows this month.</p>
      {me && (
        <div className="card">
          <div className="row"><b className="grow">My month</b>{myRank > 0 && <span className="pill p-pri">Rank {myRank} of {ranked.length}</span>}</div>
          <div className="stats three">
            <div className="stat"><b>{me.finished}</b><span>Finished</span></div>
            <div className="stat"><b>{me.open}</b><span>Still open</span></div>
            <div className="stat"><b>{me.pct == null ? "—" : me.pct + "%"}</b><span>Finished of my work</span></div>
          </div>
          <Roles l={me} />
          {!me.total && <p className="hint">Your name is on no Log Sheet row this month.</p>}
        </div>
      )}
      {team && (
        <>
          <div className="h2">Team <small>most finished first</small></div>
          <div className="card" style={{ gap: 0, padding: 0 }}>
            {lines.map((l, i) => (
              <div key={l.userId} className="attrow"><div className="sum">
                <span className="small mono muted" style={{ width: 18 }}>{l.total ? i + 1 : ""}</span>
                <span className="av sm">{initials(l.name)}</span>
                <span className="grow" style={{ minWidth: 150 }}><b>{l.name}</b><span className="small muted">{l.designation ?? ""}</span><Roles l={l} /></span>
                {l.total ? <>
                  <span className="small" style={{ whiteSpace: "nowrap" }}><b>{l.finished}</b> finished · {l.open} open{l.dropped ? ` · ${l.dropped} dropped` : ""} · {l.days} days</span>
                  <Bar pct={l.pct} /><span className="small mono" style={{ width: 38, textAlign: "right" }}>{l.pct == null ? "—" : l.pct + "%"}</span>
                </> : <span className="pill p-grey">Not on the Log Sheet this month</span>}
              </div></div>
            ))}
          </div>
          {unknown.length > 0 && (
            <div className="card">
              <b>Names in the Log Sheet that match nobody in the team</b>
              <p className="hint">Their rows are not counted for anyone. Fix the spelling in the sheet, or add the person in Users.</p>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{unknown.map((l) => <span key={l.name} className="pill p-amber">{l.name} · {l.total} rows</span>)}</div>
            </div>
          )}
        </>
      )}
    </>
  );
}
