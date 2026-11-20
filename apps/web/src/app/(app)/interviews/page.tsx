import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { fmtDay, todayDhaka } from "@/lib/format";

export default async function Interviews({ searchParams }: { searchParams: Promise<{ co?: string; past?: string }> }) {
  const u = await requireModule("interviews");
  const sp = await searchParams;
  const today = todayDhaka();
  const companies = await prisma.company.findMany({ orderBy: { sortOrder: "asc" } });
  const past = sp.past === "1";
  const list = await prisma.interview.findMany({
    where: { interviewDate: past ? { lt: today } : { gte: today }, ...(sp.co ? { companyId: sp.co } : {}) },
    include: { company: true, tasks: { select: { status: true, stepKey: true, title: true, assignee: { select: { shortName: true, name: true } } }, orderBy: { order: "asc" } } },
    orderBy: { interviewDate: past ? "desc" : "asc" },
    take: 100,
  });
  const q = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ co: sp.co, past: sp.past, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 className="h1">Interviews</h1>
        {u.can("interviews", "EDIT") && <Link href="/interviews/new" className="btn primary sm">+ New interview</Link>}
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
