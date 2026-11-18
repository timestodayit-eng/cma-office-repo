import Link from "next/link";
import type { Task, Company, User, Interview } from "@prisma/client";
import { dueLabel, fmtDay } from "@/lib/format";

export type TaskWithRefs = Task & { company: Company | null; assignee: User | null; interview: Interview | null };

export function Flash({ sp }: { sp: { e?: string; ok?: string } }) {
  return (
    <>
      {sp.e && <div className="err">{sp.e}</div>}
      {sp.ok && <div className="ok">{sp.ok}</div>}
    </>
  );
}

export function TaskCard({ t, today, mine, chainSize = 10 }: { t: TaskWithRefs; today: Date; mine?: boolean; chainSize?: number }) {
  const due = dueLabel(today, t.dueDate);
  return (
    <Link href={`/tasks/${t.id}`} className={`task${mine ? " mine" : ""}`}>
      <span className="t">{t.title}</span>
      <span className="meta">
        {t.company && <span className="pill p-pri">{t.company.short}</span>}
        {t.interview && <span>{t.interview.country} · interview {fmtDay(t.interview.interviewDate)}</span>}
        {t.status === "IN_PROGRESS" && <span className="pill p-violet">In progress</span>}
        {t.pool && !t.assigneeId && <span className="pill p-amber">Pick it up</span>}
        {t.status !== "DONE" && t.status !== "SKIPPED" && due.text && <span className={`pill ${due.cls}`}>{due.text}</span>}
        {(t.status === "DONE" || t.status === "SKIPPED") && <span className="pill p-good">Done</span>}
        {!mine && t.assignee && <span>· {t.assignee.shortName ?? t.assignee.name}</span>}
      </span>
      {t.chain && (
        <span className="chain" aria-label={`Step ${t.order} of ${chainSize}`}>
          {Array.from({ length: chainSize }, (_, i) => (
            <i key={i} className={i + 1 < t.order ? "done" : i + 1 === t.order ? "cur" : ""} />
          ))}
        </span>
      )}
    </Link>
  );
}
