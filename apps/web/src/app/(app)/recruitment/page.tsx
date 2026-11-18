import Link from "next/link";
import type { Interview } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { fmtDay, todayDhaka } from "@/lib/format";
import { getSheetConfig } from "@/lib/outbox";
import { SyncBar } from "@/components/SyncBar";
import { AGENCY_COLOR } from "@/components/BcCard";

const num = (v: number | null | undefined, d = 0) =>
  v == null || Number.isNaN(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const N = (v: unknown) => (v == null ? 0 : Number(v));

function tot(list: Interview[]) {
  const t = { n: list.length, pc: 0, usd: 0, bdt: 0, leads: 0, mplan: 0 };
  for (const r of list) { t.pc += N(r.passports); t.usd += N(r.totalCostUsd); t.bdt += N(r.totalCostBdt); t.leads += N(r.leads); t.mplan += N(r.marketingPlanUsd); }
  return { ...t, cpp: t.pc ? t.bdt / t.pc : null, conv: t.leads ? (t.pc / t.leads) * 100 : null };
}

const TABS = [["overview", "Overview"], ["interviews", "Interviews"], ["monthly", "Monthly"], ["budget", "Budget"], ["finance", "Finance"]] as const;

export default async function Recruitment({ searchParams }: { searchParams: Promise<{ tab?: string; co?: string; when?: string }> }) {
  const u = await requireModule("recruitment");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const today = todayDhaka();
  const [companies, all, cfg, fin] = await Promise.all([
    prisma.company.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.interview.findMany({ orderBy: { interviewDate: "asc" } }),
    getSheetConfig(),
    prisma.setting.findUnique({ where: { key: "financial" } }),
  ]);
  const rate = Number((fin?.value as { planningRateBdt?: number } | null)?.planningRateBdt ?? 129.5);
  const of = (id: string) => all.filter((i) => i.companyId === id);
  const past = (r: Interview) => r.interviewDate <= today;
  const name = (id: string) => companies.find((c) => c.id === id)?.name ?? "";
  const Row = ({ r, sub, pill }: { r: Interview; sub: string; pill?: React.ReactNode }) => (
    <Link href={`/interviews/${r.id}`} className="li">
      <span className="datebox"><b>{fmtDay(r.interviewDate, { day: "numeric" })}</b><span>{fmtDay(r.interviewDate, { month: "short" })}</span></span>
      <span className="grow"><b>{r.title}</b><span>{sub}</span></span>{pill}
    </Link>
  );

  let body: React.ReactNode;
  if (tab === "overview") {
    const t = tot(all.filter(past));
    const end = new Date(today.getTime() + 7 * 86_400_000);
    const soon = all.filter((r) => r.interviewDate >= today && r.interviewDate <= end);
    body = (
      <>
        <div className="stats three">
          <div className="stat"><b>{t.n}</b><span>Interviews done</span></div>
          <div className="stat"><b>{num(t.pc)}</b><span>Passports (PC)</span></div>
          <div className="stat"><b>৳{num(t.cpp)}</b><span>Weighted CPP</span></div>
          <div className="stat"><b>৳{(t.bdt / 1e6).toFixed(1)}M</b><span>Total cost</span></div>
          <div className="stat"><b>{(t.leads / 1000).toFixed(0)}k</b><span>Leads</span></div>
          <div className="stat"><b>{num(t.conv, 2)}%</b><span>Conversion</span></div>
        </div>
        <div className="h2">Next 7 days <small>{soon.length} interviews</small></div>
        {soon.length ? (
          <div className="list">{soon.map((r) => (
            <Row key={r.id} r={r} sub={`${name(r.companyId)} · ${r.country.trim()}${r.marketingPlanUsd ? ` · $${num(N(r.marketingPlanUsd))}` : ""}`}
              pill={r.interviewDate.getTime() === today.getTime() ? <span className="pill p-amber">Today</span> : undefined} />
          ))}</div>
        ) : <div className="empty">No interviews in the next 7 days.</div>}
        <div className="h2">By agency</div>
        <div className="list">{companies.map((c) => {
          const x = tot(of(c.id).filter(past));
          return (
            <Link key={c.id} href={`/recruitment?tab=interviews&co=${c.id}&when=done`} className="li">
              <span className="av sm" style={{ background: AGENCY_COLOR[c.short] }}>{c.name[0]}</span>
              <span className="grow"><b>{c.name}</b><span>{x.n} interviews · {num(x.pc)} PC · CPP ৳{num(x.cpp)}</span></span><span className="muted">›</span>
            </Link>
          );
        })}</div>
      </>
    );
  } else if (tab === "interviews") {
    const co = companies.find((c) => c.id === sp.co) ?? companies[0];
    const when = ["done", "all"].includes(sp.when ?? "") ? sp.when! : "upcoming";
    let list = of(co?.id ?? "");
    if (when === "upcoming") list = list.filter((r) => r.interviewDate > today);
    else if (when === "done") list = list.filter(past).reverse();
    const href = (c: string, w: string) => `/recruitment?tab=interviews&co=${c}&when=${w}`;
    body = (
      <>
        <nav className="seg">{companies.map((c) => <Link key={c.id} href={href(c.id, when)} aria-current={c.id === co?.id ? "page" : undefined}>{c.name.split(" ")[0]}</Link>)}</nav>
        <nav className="seg">{[["upcoming", "Upcoming"], ["done", "Done"], ["all", "All"]].map(([k, l]) => <Link key={k} href={href(co?.id ?? "", k)} aria-current={k === when ? "page" : undefined}>{l}</Link>)}</nav>
        {list.length ? (
          <div className="list">{list.map((r) => {
            const cpp = r.passports && r.totalCostBdt ? N(r.totalCostBdt) / r.passports : null;
            return (
              <Row key={r.id} r={r}
                sub={`${r.country.trim()}${r.passports ? ` · ${num(r.passports)} PC · CPP ৳${num(cpp)}` : r.marketingPlanUsd ? ` · Budget $${num(N(r.marketingPlanUsd))}` : ""}`}
                pill={r.status ? <span className={`pill ${/Done/.test(r.status) ? "p-good" : "p-pri"}`}>{r.status}</span> : undefined} />
            );
          })}</div>
        ) : <div className="empty">None</div>}
        {u.can("interviews", "EDIT") && <Link href="/interviews/new" className="btn primary" style={{ alignSelf: "flex-start" }}>+ Add interview (goes to the Google Sheet)</Link>}
      </>
    );
  } else if (tab === "monthly") {
    body = companies.map((c) => {
      const m = new Map<string, Interview[]>();
      for (const r of of(c.id)) { const k = r.interviewDate.toISOString().slice(0, 7); m.set(k, [...(m.get(k) ?? []), r]); }
      return (
        <div key={c.id} className="stack">
          <div className="h2">{c.name}</div>
          <div className="tblwrap" style={{ maxHeight: "none" }}><table className="tbl num">
            <thead><tr><th>Month</th><th>IV</th><th>Plan $</th><th>PC</th><th>Cost ৳</th><th>Leads</th><th>CPP ৳</th></tr></thead>
            <tbody>{[...m.keys()].sort().map((k) => {
              const t = tot(m.get(k)!);
              return <tr key={k}><td>{fmtDay(new Date(k + "-01"), { month: "short", year: "2-digit" })}</td><td>{t.n}</td><td>{num(t.mplan)}</td><td>{num(t.pc)}</td><td>{num(t.bdt)}</td><td>{num(t.leads)}</td><td>{t.pc && t.bdt ? num(t.cpp) : "—"}</td></tr>;
            })}</tbody>
          </table></div>
        </div>
      );
    });
  } else if (tab === "budget") {
    const rows = companies.map((c) => ({ c, p: tot(of(c.id).filter(past)), f: tot(of(c.id).filter((r) => r.interviewDate > today)) }));
    body = (
      <>
        <div className="card"><b>Scheduled budget vs reported cost (to date)</b>
          {rows.map(({ c, p }) => {
            const v = p.mplan - p.usd;
            const pct = Math.min(100, (p.usd / Math.max(p.mplan, p.usd, 1)) * 100);
            return (
              <div key={c.id} className="stack" style={{ gap: 4 }}>
                <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span>{c.name}</span><span style={{ color: v < 0 ? "var(--bad)" : "var(--good)" }}>{v < 0 ? "−" : "+"}${num(Math.abs(v))}</span></div>
                <div className="bar"><i style={{ width: `${pct}%`, background: AGENCY_COLOR[c.short] }} /></div>
                <span className="hint">Plan ${num(p.mplan)} · Reported ${num(p.usd)}</span>
              </div>
            );
          })}
        </div>
        <div className="card"><b>Upcoming interview budgets</b>
          {rows.map(({ c, f }) => <div key={c.id} className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span>{c.name} · {f.n} interviews</span><b>${num(f.mplan)}</b></div>)}
          <span className="hint">Planning rate ৳{rate} per USD</span>
        </div>
      </>
    );
  } else {
    const noCost = all.filter((r) => past(r) && r.passports && !r.totalCostBdt);
    const noPc = all.filter((r) => r.interviewDate < today && !r.passports && r.totalCostBdt);
    body = (
      <>
        <div className="card"><b>Financial settings</b>
          <dl className="kv"><dt>Planning rate</dt><dd>৳{rate} / USD</dd><dt>Historic rates</dt><dd>Preserve, never overwrite</dd><dt>CPP</dt><dd>BDT ÷ passports</dd><dt>Conversion</dt><dd>PC ÷ leads × 100</dd></dl>
          <span className="hint">The app never writes into the cost cells or formulas of the Google Sheet. Finance keeps entering verified figures in the sheet; they show here.</span>
        </div>
        <div className="card"><b>To review <span className={`pill ${noCost.length + noPc.length ? "p-amber" : "p-good"}`}>{noCost.length + noPc.length} rows</span></b>
          <div className="hint stack" style={{ gap: 4 }}>
            {noCost.map((r) => <span key={r.id}>• {name(r.companyId)} · {r.title} ({fmtDay(r.interviewDate)}): passports entered, BDT cost missing</span>)}
            {noPc.map((r) => <span key={r.id}>• {name(r.companyId)} · {r.title} ({fmtDay(r.interviewDate)}): cost entered, passports missing</span>)}
            {!noCost.length && !noPc.length && <span>Nothing to review.</span>}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="h1">Recruitment Command Center</h1>
      <SyncBar last={cfg.last?.recruitment} label="the Recruitment Google Sheet" />
      <div className="chips">{TABS.map(([k, l]) => <Link key={k} href={`/recruitment?tab=${k}`} className="chip" aria-current={tab === k ? "page" : undefined}>{l}</Link>)}</div>
      {body}
    </>
  );
}
