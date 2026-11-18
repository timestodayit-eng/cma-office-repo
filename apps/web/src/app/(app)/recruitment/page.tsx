import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { fmtDay, todayDhaka } from "@/lib/format";

const n0 = (v: unknown) => (v == null ? "" : Math.round(Number(v)).toLocaleString("en-IN"));

export default async function Recruitment({ searchParams }: { searchParams: Promise<{ co?: string }> }) {
  await requireModule("recruitment");
  const sp = await searchParams;
  const today = todayDhaka();
  const companies = await prisma.company.findMany({ orderBy: { sortOrder: "asc" } });
  const all = await prisma.interview.findMany({ include: { company: true }, orderBy: { interviewDate: "desc" } });
  const sel = sp.co ? companies.find((c) => c.id === sp.co) : null;

  const kpi = (list: typeof all) => {
    const done = list.filter((i) => i.passports != null);
    const pc = done.reduce((a, i) => a + (i.passports ?? 0), 0);
    const bdt = done.reduce((a, i) => a + Number(i.totalCostBdt ?? 0), 0);
    const leads = done.reduce((a, i) => a + (i.leads ?? 0), 0);
    const upcoming = list.filter((i) => i.interviewDate >= today);
    const plan = upcoming.reduce((a, i) => a + Number(i.marketingPlanUsd ?? 0), 0);
    return { count: list.length, pc, bdt, cpp: pc ? bdt / pc : 0, leads, upcoming: upcoming.length, plan };
  };

  const tabs = (
    <div className="row">
      <Link href="/recruitment" className={`pill ${!sel ? "p-pri" : "p-grey"}`}>Command Center</Link>
      {companies.map((c) => <Link key={c.id} href={`/recruitment?co=${c.id}`} className={`pill ${sel?.id === c.id ? "p-pri" : "p-grey"}`}>{c.name}</Link>)}
    </div>
  );

  if (!sel) {
    const total = kpi(all);
    return (
      <>
        <h1 className="h1">Recruitment Command Center</h1>
        {tabs}
        <p className="hint">Visible to the marketing team and admins only. Two-way sync with the Google Sheet comes in phase 2; until then interviews created here are the data.</p>
        <div className="stats">
          <div className="stat"><b>{total.count}</b><span>Interviews</span></div>
          <div className="stat"><b>{n0(total.pc)}</b><span>Passports collected</span></div>
          <div className="stat"><b>{n0(total.bdt)}</b><span>Spent (BDT)</span></div>
          <div className="stat"><b>{n0(total.cpp)}</b><span>Avg cost per passport (BDT)</span></div>
          <div className="stat"><b>{total.upcoming}</b><span>Upcoming</span></div>
          <div className="stat"><b>${n0(total.plan)}</b><span>Upcoming plan</span></div>
        </div>
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Agency</th><th>Interviews</th><th>Passports</th><th>Spent BDT</th><th>CPP BDT</th><th>Leads</th><th>Upcoming</th><th>Upcoming plan $</th></tr></thead>
          <tbody>{companies.map((c) => { const k = kpi(all.filter((i) => i.companyId === c.id)); return (
            <tr key={c.id}><td><Link href={`/recruitment?co=${c.id}`}>{c.name}</Link></td><td>{k.count}</td><td>{n0(k.pc)}</td><td>{n0(k.bdt)}</td><td>{n0(k.cpp)}</td><td>{n0(k.leads)}</td><td>{k.upcoming}</td><td>{n0(k.plan)}</td></tr>
          ); })}</tbody>
        </table></div>
      </>
    );
  }

  const list = all.filter((i) => i.companyId === sel.id);
  return (
    <>
      <h1 className="h1">{sel.name}</h1>
      {tabs}
      <div className="tblwrap"><table className="tbl">
        <thead><tr><th>Date</th><th>Employer</th><th>Country</th><th>Plan $</th><th>Status</th><th>PC</th><th>Cost $</th><th>Cost BDT</th><th>CPP BDT</th><th>Leads</th><th>Conv %</th></tr></thead>
        <tbody>{list.map((i) => (
          <tr key={i.id} style={{ background: i.interviewDate >= today ? "var(--pri-soft)" : undefined }}>
            <td>{fmtDay(i.interviewDate, { day: "numeric", month: "short", year: "2-digit" })}</td>
            <td><Link href={`/interviews/${i.id}`}>{i.title}</Link></td><td>{i.country}</td><td>{n0(i.marketingPlanUsd)}</td><td>{i.status}</td>
            <td>{i.passports ?? ""}</td><td>{n0(i.totalCostUsd)}</td><td>{n0(i.totalCostBdt)}</td>
            <td>{i.passports && i.totalCostBdt ? n0(Number(i.totalCostBdt) / i.passports) : ""}</td>
            <td>{n0(i.leads)}</td><td>{i.passports && i.leads ? ((i.passports / i.leads) * 100).toFixed(2) : ""}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {list.length === 0 && <div className="empty">No interviews yet.</div>}
    </>
  );
}
