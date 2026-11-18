import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fmtDay, fmtTime, todayDhaka } from "@/lib/format";
import { myOpenTasks, myComingTasks } from "@/lib/queries";
import { myBroadcast, officerOf } from "@/lib/broadcast";
import { TaskCard, Flash } from "@/components/TaskCard";
import { BcCard } from "@/components/BcCard";

export default async function Home({ searchParams }: { searchParams: Promise<{ denied?: string; e?: string; ok?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const today = todayDhaka();
  const mgr = u.has("assign");
  const [open, coming, reqs, sent, bc, work] = await Promise.all([
    myOpenTasks(u.id),
    myComingTasks(u.id),
    prisma.request.findMany({ where: { toId: u.id, status: "OPEN" }, include: { from: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.request.findMany({ where: { fromId: u.id }, include: { to: true }, orderBy: { createdAt: "desc" }, take: 2 }),
    u.can("broadcast") ? myBroadcast(u.id) : [],
    mgr
      ? prisma.interview.findMany({
          where: { tasks: { some: {} } },
          include: { company: true, tasks: { include: { assignee: true }, orderBy: { order: "asc" } } },
          orderBy: { interviewDate: "asc" },
          take: 60,
        })
      : [],
  ]);
  const officers = bc.length ? await officerOf([...new Set(bc.map((g) => g.company.id))]) : new Map();
  const simple = mgr ? await prisma.task.findMany({ where: { chain: null, status: { in: ["TODO", "IN_PROGRESS"] } }, include: { assignee: true }, orderBy: { dueDate: "asc" }, take: 20 }) : [];
  const late = open.filter((t) => t.dueDate && t.dueDate < today).length;

  // The newest notice of the last 7 days stays on top of Home, also after it was ticked as read.
  const notice = await prisma.notice.findFirst({
    where: { createdAt: { gte: new Date(Date.now() - 7 * 86400_000) }, OR: [{ senderId: u.id }, { reads: { some: { userId: u.id } } }] },
    orderBy: { createdAt: "desc" }, include: { sender: { select: { name: true } } },
  });
  return (
    <>
      {sp.denied && <div className="err">You do not have access to that module.</div>}
      <div><div className="hint">Shuprobhat,</div><h1 className="h1">{u.shortName ?? u.name} 👋</h1></div>
      <Flash sp={sp} />
      {notice && (
        <Link href="/notices" className="card" style={{ borderColor: "var(--pri)", background: "var(--pri-soft)", gap: 4 }}>
          <span className="small muted">Notice · {notice.sender.name} · {fmtTime(notice.createdAt)}</span>
          <b style={{ overflowWrap: "anywhere" }}>{notice.title}</b>
          <span className="small" style={{ overflowWrap: "anywhere" }}>{notice.body.length > 140 ? notice.body.slice(0, 140) + "…" : notice.body}</span>
        </Link>
      )}
      <div className="stats three">
        <Link href="/tasks" className="stat"><b>{open.length}</b><span>My turn</span></Link>
        <Link href="/tasks?tab=coming" className="stat"><b>{coming.length}</b><span>Coming next</span></Link>
        <Link href="/tasks" className="stat"><b style={{ color: late ? "var(--bad)" : undefined }}>{late}</b><span>Late</span></Link>
      </div>
      <div className="acts">
        {u.can("interviews", "EDIT") && <Link href="/interviews/new" className="btn primary">+ New interview</Link>}
        {mgr && <Link href="/tasks/new" className="btn">+ New task (any other work)</Link>}
        <Link href="/requests?new=1" className="btn">✉ Send a request to anyone</Link>
      </div>

      {bc.length > 0 && (
        <>
          <div className="h2">Call broadcast to send <small>{bc.length}</small></div>
          <div className="grid">{bc.map((g) => <BcCard key={g.key} g={g} today={today} officer={officers.get(g.company.id)} meId={u.id} canEdit back="/" />)}</div>
        </>
      )}

      {reqs.length > 0 && (
        <>
          <div className="h2">Requests for you <small>{reqs.length}</small></div>
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

      <div className="h2">Do now <small>{open.length ? <Link href="/tasks">See all</Link> : "All clear"}</small></div>
      {open.length ? (
        <div className="grid">{open.slice(0, 4).map((t) => <TaskCard key={t.id} t={t} today={today} mine />)}</div>
      ) : (
        <div className="empty"><b>Nothing waiting for you</b>You get a notification when your step starts.</div>
      )}

      {sent.length > 0 && (
        <>
          <div className="h2">Requests I sent <small><Link href="/requests">See all</Link></small></div>
          <div className="list">
            {sent.map((r) => (
              <Link key={r.id} href={`/requests?open=${r.id}`} className="li">
                <span className="grow"><b>To {r.to.name} · {r.type.replace("_", " ").toLowerCase()}</b><span>{r.message}</span></span>
                <span className={`pill ${r.status === "OPEN" ? "p-amber" : "p-good"}`}>{r.status === "OPEN" ? "Waiting" : "Answered"}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {mgr ? (
        <>
          <div className="h2">All work <small>{work.length + simple.length} items</small></div>
          {work.length + simple.length === 0 && <div className="empty">No work yet. Add an interview and its whole timeline is made automatically.</div>}
          <div className="list">
            {work.map((iv) => {
              const cur = iv.tasks.find((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
              const done = !cur && iv.tasks.every((t) => t.status === "DONE" || t.status === "SKIPPED");
              const isLate = !!cur?.dueDate && cur.dueDate < today;
              return (
                <Link key={iv.id} href={`/interviews/${iv.id}`} className="li">
                  <span className="datebox"><b>{fmtDay(iv.interviewDate, { day: "numeric" })}</b><span>{fmtDay(iv.interviewDate, { month: "short" })}</span></span>
                  <span className="grow"><b>{iv.company.name.split(" ")[0]} · {iv.title}</b>
                    <span>{done ? "Ads finished" : cur ? `${cur.title} · ${cur.assignee?.name ?? (cur.pool ? "Company editors" : "Nobody set")}` : `Video work starts ${fmtDay(iv.tasks[0]?.startDate)}`}</span></span>
                  {done ? <span className="pill p-good">Done</span> : isLate ? <span className="pill p-bad">Late</span> : cur ? <span className="pill p-pri">{cur.order}/{iv.tasks.length}</span> : <span className="pill p-grey">Scheduled</span>}
                </Link>
              );
            })}
            {simple.map((t) => (
              <Link key={t.id} href={`/tasks/${t.id}`} className="li">
                <span className="datebox"><b>{t.dueDate ? fmtDay(t.dueDate, { day: "numeric" }) : "·"}</b><span>{t.dueDate ? fmtDay(t.dueDate, { month: "short" }) : "task"}</span></span>
                <span className="grow"><b>{t.title}</b><span>{t.assignee?.name ?? "Nobody set"}</span></span>
                {t.dueDate && t.dueDate < today ? <span className="pill p-bad">Late</span> : <span className="pill p-pri">Task</span>}
              </Link>
            ))}
          </div>
        </>
      ) : coming.length > 0 && (
        <>
          <div className="h2">Coming to me</div>
          <div className="grid">{coming.slice(0, 6).map((t) => <TaskCard key={t.id} t={t} today={today} />)}</div>
        </>
      )}
    </>
  );
}
