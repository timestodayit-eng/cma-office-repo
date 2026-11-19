// Notices: only the super admins (CEO and admin) send; everybody who gets one must tick "read".
import { prisma } from "./db";

export const canSendNotice = (u: { level: string }) => u.level === "SUPER_ADMIN";

/** The notices this person has not ticked yet, oldest first. */
export function unreadNotices(userId: string) {
  return prisma.noticeRead.findMany({
    where: { userId, readAt: null },
    orderBy: { notice: { createdAt: "asc" } },
    select: { notice: { select: { id: true, title: true, body: true, createdAt: true, sender: { select: { name: true } } } } },
  }).then((r) => r.map((x) => ({ id: x.notice.id, title: x.notice.title, body: x.notice.body, at: x.notice.createdAt.toISOString(), from: x.notice.sender.name })));
}
export type UnreadNotice = Awaited<ReturnType<typeof unreadNotices>>[number];
