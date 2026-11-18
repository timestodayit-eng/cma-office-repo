import { prisma } from "./db";

/**
 * In-app notification. When the person has WhatsApp on, it is marked "queued";
 * phase 2 adds the worker that sends queued messages through the WhatsApp Business API.
 */
export async function notify(
  userIds: (string | null | undefined)[],
  n: { kind: string; title: string; body?: string; link?: string },
) {
  const ids = [...new Set(userIds.filter(Boolean) as string[])];
  if (!ids.length) return;
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, whatsappOn: true, whatsapp: true } });
  await prisma.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      ...n,
      whatsapp: u.whatsappOn && u.whatsapp ? "queued" : null,
    })),
  });
}
