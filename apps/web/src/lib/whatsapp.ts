// WhatsApp notifications through Meta's WhatsApp Business (Cloud) API.
// Keys live in the server .env (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID), never in the database or the repository.
// Business-started messages must use an approved template; ours has one variable:
//   "New update for you in CMA Office: {{1}}. Open the app to see the details."
import { prisma } from "./db";

export const WA_TEMPLATE = process.env.WHATSAPP_TEMPLATE || "cma_notice";
export const WA_TEMPLATE_TEXT = "New update for you in CMA Office: {{1}}. Open the app to see the details.";
const LANG = process.env.WHATSAPP_LANG || "en";

export const waConfigured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

/** 01712345678 / +8801712345678 -> 8801712345678 (what the API wants). */
export function waNumber(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("880")) return d;
  if (d.startsWith("0")) return "88" + d;
  return d;
}

/** Template variables cannot hold new lines, tabs or long runs of spaces. */
export const waText = (title: string, body?: string | null) =>
  [title, body].filter(Boolean).join(": ").replace(/\s+/g, " ").trim().slice(0, 500);

export async function sendWhatsApp(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!waConfigured()) return { ok: false, error: "WhatsApp is not set up on the server yet" };
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: waNumber(to),
        type: "template",
        template: { name: WA_TEMPLATE, language: { code: LANG }, components: [{ type: "body", parameters: [{ type: "text", text }] }] },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, error: (j?.error?.message ?? `HTTP ${r.status}`).slice(0, 300) };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e).slice(0, 300) };
  }
}

let running = false;
/** Send the notifications waiting for WhatsApp. Called after every notify(); safe to call often. */
export async function flushWhatsApp() {
  if (!waConfigured() || running) return;
  running = true;
  try {
    for (;;) {
      const batch = await prisma.notification.findMany({
        where: { whatsapp: "queued", createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } },
        include: { user: { select: { whatsapp: true, whatsappOn: true } } },
        orderBy: { createdAt: "asc" },
        take: 20,
      });
      if (!batch.length) break;
      for (const n of batch) {
        const to = n.user.whatsappOn ? n.user.whatsapp : null;
        const r = to ? await sendWhatsApp(to, waText(n.title, n.body)) : { ok: false, error: "no number" };
        if (!r.ok) console.error("whatsapp failed", n.id, r.error);
        await prisma.notification.update({ where: { id: n.id }, data: { whatsapp: r.ok ? "sent" : "failed" } });
      }
    }
  } finally {
    running = false;
  }
}
