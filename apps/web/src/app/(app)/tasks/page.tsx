import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { todayDhaka } from "@/lib/format";
import { myOpenTasks, myComingTasks, myDoneTasks } from "@/lib/queries";
import { TaskCard } from "@/components/TaskCard";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser();
  const { tab = "todo" } = await searchParams;
  const today = todayDhaka();
  const tasks = tab === "coming" ? await myComingTasks(u.id) : tab === "done" ? await myDoneTasks(u.id) : await myOpenTasks(u.id);
  const empty = { todo: "Nothing waiting for you right now.", coming: "Nothing coming to you yet.", done: "You have not finished any task yet." }[tab] ?? "";
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 className="h1">My Tasks</h1>
        {(u.level === "SUPER_ADMIN" || u.has("assign")) && <Link className="btn primary sm" href="/tasks/new">+ New task</Link>}
      </div>
      <nav className="seg">
        <Link href="/tasks" aria-current={tab === "todo" ? "page" : undefined}>To do</Link>
        <Link href="/tasks?tab=coming" aria-current={tab === "coming" ? "page" : undefined}>Coming</Link>
        <Link href="/tasks?tab=done" aria-current={tab === "done" ? "page" : undefined}>Done by me</Link>
      </nav>
      {tasks.length ? (
        <div className="grid">{tasks.map((t) => <TaskCard key={t.id} t={t} today={today} mine={tab === "todo"} />)}</div>
      ) : (
        <div className="empty">{empty}</div>
      )}
    </>
  );
}
