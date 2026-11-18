import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { fmtDay, fmtTime, todayDhaka, dueLabel } from "@/lib/format";
import { Flash } from "@/components/TaskCard";

export default async function InterviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const u = await requireModule("interviews");
  const { id } = await params;
  const sp = await searchParams;
  const today = todayDhaka();
  const iv = await prisma.interview.findUnique({
    where: { id },
    include: {
      company: true,
      tasks: { include: { assignee: true }, orderBy: { order: "asc" } },
      broadcast: { orderBy: { slot: "asc" } },
    },
  });
  if (!iv) notFound();
  const ads = iv.tasks.find((t) => t.stepKey === "ads");
  const handover = iv.tasks.find((t) => t.stepKey === "handover");
  const shoot = iv.tasks.find((t) => t.stepKey === "shoot");
  const first = iv.tasks[0];
  return (
    <>
      <Link href="/interviews" className="small">← Interviews</Link>
      <h1 className="h1">{iv.title}</h1>
      <div className="row small muted"><span className="pill p-pri">{iv.company.name}</span><span>{iv.country}</span><span className="pill p-grey">{iv.status}</span></div>
      <Flash sp={sp} />
      <div className="dates">
        {first && <div><b>{fmtDay(first.startDate)}</b><span>Writer told</span></div>}
        {shoot && <div><b>{fmtDay(shoot.dueDate)}</b><span>Shoot</span></div>}
        {handover && <div><b>{fmtDay(handover.dueDate)}</b><span>Handover</span></div>}
        {ads && <div className="hi"><b>{fmtDay(ads.dueDate)}</b><span>Ads start</span></div>}
        <div className="hi"><b>{fmtDay(iv.interviewDate)}</b><span>Interview</span></div>
      </div>
      <div className="grid">
        <div className="card">
          <b>Video timeline</b>
          <ol className="steps">
            {iv.tasks.map((t) => {
              const open = t.status === "TODO" || t.status === "IN_PROGRESS";
              const due = dueLabel(today, t.dueDate);
              return (
                <li key={t.id} className={t.status === "DONE" ? "done" : t.status === "SKIPPED" ? "done skip" : open ? "cur" : ""}>
                  <span className="n">{t.order}</span>
                  <span>
                    <Link href={`/tasks/${t.id}`} style={{ color: "var(--ink)", fontWeight: 500 }}>{t.title}</Link>
                    <div className="sub">
                      {t.assignee?.name ?? (t.pool ? "Company editors pick" : "Nobody set (check Settings)")}
                      {t.doneAt ? ` · done ${fmtTime(t.doneAt)}` : ""}
                      {t.status === "SKIPPED" ? " · skipped" : ""}
                    </div>
                  </span>
                  <span>{open ? <span className={`pill ${due.cls}`}>{due.text}</span> : <span className="small muted">{fmtDay(t.dueDate)}</span>}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="card">
          <b>Call broadcast</b>
          <p className="hint">Missed call first, Received at least 3 hours later.</p>
          {iv.broadcast.map((b) => (
            <div key={b.id} className="row small" style={{ justifyContent: "space-between" }}>
              <span><b>{b.slot}</b> · {fmtDay(b.callDate, { weekday: "short", day: "numeric", month: "short" })}</span>
              <span className="row">
                <span className={`pill ${b.missedSent ? "p-good" : "p-grey"}`}>Missed {b.missedSent ? "✓" : ""}</span>
                <span className={`pill ${b.receivedSent ? "p-good" : "p-grey"}`}>Received {b.receivedSent ? "✓" : ""}</span>
              </span>
            </div>
          ))}
          {u.can("broadcast") && <Link href="/broadcast" className="small">Open Call &amp; SMS Broadcast →</Link>}
          {iv.notes && <div className="rmsg">{iv.notes}</div>}
        </div>
      </div>
    </>
  );
}
