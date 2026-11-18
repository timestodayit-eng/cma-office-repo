import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fmtDay, fmtTime, todayDhaka } from "@/lib/format";
import { myOpenTasks, myComingTasks } from "@/lib/queries";
import { TaskCard } from "@/components/TaskCard";

export default async function Home({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const today = todayDhaka();
  const [open, coming, reqs, upcoming, notes] = await Promise.all([
    myOpenTasks(u.id),
    myComingTasks(u.id),
    prisma.request.findMany({ where: { toId: u.id, status: "OPEN" }, include: { from: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    u.can("interviews")
      ? prisma.interview.findMany({ where: { interviewDate: { gte: today } }, include: { company: true }, orderBy: { interviewDate: "asc" }, take: 6 })
      : Promise.resolve([]),
    prisma.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const late = open.filter((t) => t.dueDate && t.dueDate < today).length;

  return (
    <>
      {sp.denied && <div className="err">You do not have access to that module.</div>}
      <h1 className="h1">Hello, {u.shortName ?? u.name}</h1>
      <div className="stats">
        <Link href="/tasks" className="stat"><b>{open.length}</b><span>My turn now</span></Link>
        <Link href="/tasks?tab=coming" className="stat"><b>{coming.length}</b><span>Coming to me</span></Link>
        <Link href="/tasks" className="stat"><b style={{ color: late ? "var(--bad)" : undefined }}>{late}</b><span>Late</span></Link>
        <Link href="/requests" className="stat"><b>{reqs.length}</b><span>Requests for me</span></Link>
      </div>

      <div className="h2">My turn now <small><Link href="/tasks">See all</Link></small></div>
      {open.length ? (
        <div className="grid">{open.slice(0, 6).map((t) => <TaskCard key={t.id} t={t} today={today} mine />)}</div>
      ) : (
        <div className="empty">Nothing waiting for you right now.</div>
      )}

      {reqs.length > 0 && (
        <>
          <div className="h2">Requests for me <small><Link href="/requests">Open</Link></small></div>
          <div className="list">
            {reqs.map((r) => (
              <Link key={r.id} href={`/requests?open=${r.id}`} className="li">
                <span className="grow"><b>{r.from.name} · {r.type.replace("_", " ").toLowerCase()}</b><span>{r.message}</span></span>
                <span className="small muted">{fmtTime(r.createdAt)}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="h2">Upcoming interviews <small><Link href="/interviews">All</Link></small></div>
          <div className="list">
            {upcoming.map((iv) => (
              <Link key={iv.id} href={`/interviews/${iv.id}`} className="li">
                <span className="datebox"><b>{fmtDay(iv.interviewDate, { day: "numeric" })}</b><span>{fmtDay(iv.interviewDate, { month: "short" })}</span></span>
                <span className="grow"><b>{iv.title}</b><span>{iv.company.name} · {iv.country}</span></span>
                <span className="pill p-grey">{iv.status}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {notes.length > 0 && (
        <>
          <div className="h2">Latest notifications <small><Link href="/notifications">All</Link></small></div>
          <div className="list">
            {notes.map((n) => (
              <Link key={n.id} href={n.link ?? "/notifications"} className={`li${n.readAt ? "" : " unread"}`}>
                <span className="grow"><b>{n.title}</b>{n.body && <span>{n.body}</span>}</span>
                <span className="small muted">{fmtTime(n.createdAt)}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
