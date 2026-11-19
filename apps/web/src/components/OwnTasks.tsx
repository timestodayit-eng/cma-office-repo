import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDay, todayDhaka } from "@/lib/format";
import { ownAddAction, ownSetAction } from "@/app/ownTaskActions";

/** The signed-in person's own to-do list. short = the small card on Home. */
export async function OwnTasks({ userId, short = false }: { userId: string; short?: boolean }) {
  const today = todayDhaka();
  const [open, doneList, doneCount] = await Promise.all([
    prisma.ownTask.findMany({ where: { userId, doneAt: null }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], take: short ? 5 : 200 }),
    short ? [] : prisma.ownTask.findMany({ where: { userId, doneAt: { not: null } }, orderBy: { doneAt: "desc" }, take: 30 }),
    prisma.ownTask.count({ where: { userId, doneAt: { not: null } } }),
  ]);
  const openCount = short ? await prisma.ownTask.count({ where: { userId, doneAt: null } }) : open.length;
  const back = <input type="hidden" name="back" value={short ? "home" : "tasks"} />;
  const total = openCount + doneCount;
  return (
    <>
      <div className="card own">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>My own tasks</b>
          <span className="small muted">{total ? `${doneCount} of ${total} done` : "Only you can see these"}</span>
        </div>
        {total > 0 && <div className="bar"><i style={{ width: `${Math.round((doneCount / total) * 100)}%`, background: "var(--good)" }} /></div>}
        <form action={ownAddAction} className="ownadd">
          {back}
          <input name="title" className="inp" placeholder="Write a task for yourself…" maxLength={200} required aria-label="New own task" />
          {!short && <input type="date" name="dueDate" className="inp" aria-label="Date (optional)" />}
          <button className="btn primary">Add</button>
        </form>
        {open.length === 0 ? <p className="hint">{total ? "All done. Nothing left on your own list." : "Add anything you want to remember: a call, a file, a follow-up."}</p> : (
          <div className="ownlist">
            {open.map((t) => {
              const late = t.dueDate && t.dueDate < today;
              return (
                <div key={t.id} className="ownrow">
                  <form action={ownSetAction}>{back}<input type="hidden" name="id" value={t.id} /><input type="hidden" name="mode" value="done" /><button className="tick" aria-label={`Mark done: ${t.title}`} title="Mark as done" /></form>
                  <span className="grow"><b>{t.title}</b>{t.dueDate && <span className={late ? "late" : undefined}>{late ? "Late · " : ""}{fmtDay(t.dueDate, { weekday: "short", day: "numeric", month: "short" })}</span>}</span>
                  {!short && <form action={ownSetAction}>{back}<input type="hidden" name="id" value={t.id} /><input type="hidden" name="mode" value="delete" /><button className="x" aria-label={`Delete: ${t.title}`} title="Delete">×</button></form>}
                </div>
              );
            })}
          </div>
        )}
        {short && openCount > open.length && <Link href="/tasks?tab=own" className="linkb" style={{ marginLeft: 0 }}>See all {openCount} ›</Link>}
        {short && openCount <= open.length && total > 0 && <Link href="/tasks?tab=own" className="linkb" style={{ marginLeft: 0 }}>Open my list ›</Link>}
      </div>
      {!short && doneList.length > 0 && (
        <div className="card own">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>Done</b>
            <form action={ownSetAction}>{back}<input type="hidden" name="mode" value="clear" /><button className="btn sm">Clear done tasks</button></form>
          </div>
          <div className="ownlist">
            {doneList.map((t) => (
              <div key={t.id} className="ownrow done">
                <form action={ownSetAction}>{back}<input type="hidden" name="id" value={t.id} /><input type="hidden" name="mode" value="undo" /><button className="tick on" aria-label={`Not done yet: ${t.title}`} title="Not done yet">✓</button></form>
                <span className="grow"><b>{t.title}</b><span>Done {fmtDay(t.doneAt, { day: "numeric", month: "short" })}</span></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
