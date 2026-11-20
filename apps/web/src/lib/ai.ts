// The AI behind the Command Center. One small interface, so the provider can be swapped:
// today OpenAI (OPENAI_API_KEY in the server .env). The key never goes into the database or the repository.

export type AiTool = { name: string; description: string; parameters: Record<string, unknown> };
export type AiToolCall = { id: string; name: string; args: Record<string, unknown> };
export type AiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AiToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export class AiError extends Error {}

export const aiConfigured = () => !!process.env.OPENAI_API_KEY;
export const aiModel = () => process.env.OPENAI_MODEL || "gpt-4o";

/** One model turn: text, or the tools it wants run. */
export async function aiTurn(messages: AiMessage[], tools: AiTool[]): Promise<{ text: string; toolCalls: AiToolCall[] }> {
  if (!aiConfigured()) throw new AiError("The AI key is not set on the server yet");
  let r: Response;
  try {
    r = await fetch(`${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: aiModel(),
        messages: messages.map((m) =>
          m.role === "tool" ? { role: "tool", tool_call_id: m.toolCallId, content: m.content }
          : m.role === "assistant" && m.toolCalls?.length
            ? { role: "assistant", content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
            : { role: m.role, content: m.content }),
        tools: tools.map((t) => ({ type: "function", function: t })),
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new AiError("Could not reach the AI service: " + String((e as Error).message ?? e).slice(0, 150));
  }
  const j = (await r.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
  } | null;
  if (!r.ok) throw new AiError((j?.error?.message ?? `AI service error ${r.status}`).slice(0, 300));
  const msg = j?.choices?.[0]?.message;
  const toolCalls = (msg?.tool_calls ?? []).map((c) => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* the tool reports the bad input */ }
    return { id: c.id, name: c.function.name, args };
  });
  return { text: msg?.content ?? "", toolCalls };
}
