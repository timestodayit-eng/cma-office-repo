import { prisma } from "./db";

export const taskInclude = { company: true, assignee: true, interview: true } as const;

/** Tasks the user can act on now: assigned TODO/IN_PROGRESS + open pool steps for their companies. */
export async function myOpenTasks(userId: string) {
  const roles = await prisma.companyRole.findMany({ where: { userId } });
  const poolOr = roles.filter((r) => r.companyId).map((r) => ({ role: r.role, companyId: r.companyId! }));
  return prisma.task.findMany({
    where: {
      OR: [
        { assigneeId: userId, status: { in: ["TODO", "IN_PROGRESS"] } },
        ...(poolOr.length ? [{ pool: true, assigneeId: null, status: "TODO" as const, OR: poolOr }] : []),
      ],
    },
    include: taskInclude,
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
}

export async function myComingTasks(userId: string) {
  return prisma.task.findMany({
    where: { assigneeId: userId, status: "WAITING" },
    include: taskInclude,
    orderBy: { dueDate: "asc" },
    take: 50,
  });
}

export async function myDoneTasks(userId: string) {
  return prisma.task.findMany({
    where: { assigneeId: userId, status: { in: ["DONE", "SKIPPED"] } },
    include: taskInclude,
    orderBy: { doneAt: "desc" },
    take: 50,
  });
}
