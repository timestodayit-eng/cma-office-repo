import { requireModule } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { CommandChat } from "@/components/CommandChat";

export default async function Command() {
  const u = await requireModule("ai");
  const canAssign = u.level === "SUPER_ADMIN" || u.has("assign");
  const examples = [
    "আজ কার কী কাজ আছে?",
    "কোন কাজগুলো দেরি হয়ে গেছে?",
    "সামনের ৭ দিনে কোন কোন interview আছে?",
    ...(u.can("recruitment") ? ["এই মাসে কোন agency-র CPP কত?"] : []),
    ...(canAssign ? ["Give Atik a task: write the caption for Malaysia F 01, due tomorrow"] : []),
  ];
  return (
    <>
      <h1 className="h1">Command Center</h1>
      {aiConfigured() ? <CommandChat examples={examples} canAssign={canAssign} /> : (
        <div className="card">
          <div className="row"><b className="grow">The AI is not connected yet</b><span className="pill p-amber">Needs a key</span></div>
          <p className="hint">The Command Center answers from the app&apos;s data and lets managers hand out work by typing or speaking. It needs an OpenAI API key on the server.</p>
          {u.level === "SUPER_ADMIN" && (
            <ol className="alist">
              <li>Get an API key from <b>platform.openai.com → API keys</b>. Do not send it to anyone in chat.</li>
              <li>On the server, open the file <code>~/cma-office/.env</code> and add one line: <code>OPENAI_API_KEY=…</code></li>
              <li>Run <code>cd ~/cma-office &amp;&amp; sh update.sh</code>, then reload this page.</li>
            </ol>
          )}
        </div>
      )}
    </>
  );
}
