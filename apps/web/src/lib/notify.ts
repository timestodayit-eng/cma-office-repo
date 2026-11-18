import { prisma } from "./db";
import { flushWhatsApp } from "./whatsapp";

/**
 * In-app notification. When the person has WhatsApp on, it is marked "queued"
 * and sent in the background (see whatsapp.ts) once the server has the WhatsApp keys.
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
  void flushWhatsApp().catch((e) => console.error("whatsapp flush", e));
}
