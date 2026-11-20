import Link from "next/link";
import type { Task, Company, User, Interview } from "@prisma/client";
import { dueLabel, fmtDay } from "@/lib/format";
import { AgPill } from "./BcCard";

export type TaskWithRefs = Task & { company: Company | null; assignee: User | null; interview: Interview | null };

export function Flash({ sp }: { sp: { e?: string; ok?: string } }) {
  return (
    <>
      {sp.e && <div className="err">{sp.e}</div>}
      {sp.ok && <div className="ok">{sp.ok}</div>}
    </>
  );
}

const DAY = 86_400_000;

export function TaskCard({ t, today, mine, chainSize = 10, adsDaysBefore = 7 }: { t: TaskWithRefs; today: Date; mine?: boolean; chainSize?: number; adsDaysBefore?: number }) {
  const due = dueLabel(today, t.dueDate);
  const closed = t.status === "DONE" || t.status === "SKIPPED";
  const pool = t.pool && !t.assigneeId;
  return (
    <Link href={`/tasks/${t.id}`} className={`task${mine ? " mine" : ""}`}>
      <span className="meta">
        {t.company && <AgPill short={t.company.short} name={t.company.name} />}
        {t.status === "WAITING" && <span className="pill p-grey">Scheduled</span>}
        <span style={{ marginLeft: "auto" }}>
          {closed ? <span className="pill p-good">Done</span> : due.text ? <span className={`pill ${due.cls}`}>{due.text.replace(/^(\d+ days? late)$/, "Late · " + fmtDay(t.dueDate))}</span> : null}
        </span>
      </span>
      <span className="t">{t.interview ? t.interview.title : t.title}</span>
      <span className="meta">
        {t.interview
          ? <><span>Interview {fmtDay(t.interview.interviewDate)}</span><span>·</span><span>Ads from {fmtDay(new Date(t.interview.interviewDate.getTime() - adsDaysBefore * DAY))}</span></>
          : <span>{t.description?.slice(0, 80) || "Task"}{t.dueDate ? ` · Deadline ${fmtDay(t.dueDate)}` : ""}</span>}
      </span>
      <span className="meta">
        {mine && !closed
          ? <><span className={`pill ${t.status === "IN_PROGRESS" ? "p-pri" : "p-amber"}`}>{pool ? "Open for editors" : t.status === "IN_PROGRESS" ? "In progress" : "Your turn"}</span>{t.interview && <b className="ink">{t.title}</b>}</>
          : <><span className="av sm">{(t.assignee?.name ?? "?")[0]}</span><span>{t.assignee?.name ?? (t.pool ? "Company editors" : "Nobody set")}{t.interview ? ` · ${t.title}` : ""}</span></>}
      </span>
      {t.chain && (
        <span className="chain" aria-label={`Step ${t.order} of ${chainSize}`}>
          {Array.from({ length: chainSize }, (_, i) => (
            <i key={i} className={i + 1 < t.order || closed ? "done" : i + 1 === t.order ? "cur" : ""} />
          ))}
        </span>
      )}
    </Link>
  );
}
