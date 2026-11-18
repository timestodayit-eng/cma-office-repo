import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { todayDhaka } from "@/lib/format";
import { taskInclude } from "@/lib/queries";
import { TaskCard } from "@/components/TaskCard";

export default async function Marketing() {
  const u = await requireModule("marketing");
  const today = todayDhaka();
  const [list, running, done] = await Promise.all([
    prisma.task.findMany({
      where: { chain: "video", stepKey: { in: ["handover", "publish", "ads"] }, status: { in: ["TODO", "IN_PROGRESS"] } },
      include: taskInclude,
      orderBy: { dueDate: "asc" },
    }),
    prisma.interview.count({ where: { status: "Ads running" } }),
    prisma.interview.findMany({ where: { interviewDate: { lte: today }, passports: { gt: 0 } }, select: { passports: true, totalCostBdt: true } }),
  ]);
  const pc = done.reduce((a, r) => a + (r.passports ?? 0), 0);
  const bdt = done.reduce((a, r) => a + Number(r.totalCostBdt ?? 0), 0);
  return (
    <>
      <h1 className="h1">Marketing</h1>
      <div className="stats three">
        <div className="stat"><b>{list.length}</b><span>Coming / handed</span></div>
        <div className="stat"><b>{running}</b><span>Running / done</span></div>
        <div className="stat"><b>৳{pc ? Math.round(bdt / pc).toLocaleString("en-US") : "—"}</b><span>CPP (synced)</span></div>
      </div>
      <div className="h2">Final approval and ads</div>
      {list.length ? <div className="grid">{list.map((t) => <TaskCard key={t.id} t={t} today={today} mine={t.assigneeId === u.id} />)}</div> : <div className="empty">Nothing handed over yet.</div>}
    </>
  );
}
