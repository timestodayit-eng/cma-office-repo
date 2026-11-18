"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { askCommandAction } from "@/app/actions";

type Turn = { role: "user" | "assistant"; content: string; err?: boolean };
type Rec = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void };

/** Small renderer: **bold**, [text](/link), lines and "- " lists. Nothing else is turned into HTML. */
function Rich({ text }: { text: string }) {
  const inline = (s: string, k: number) =>
    s.split(/(\[[^\]]+\]\((?:\/|https?:\/\/)[^)\s]+\)|\*\*[^*]+\*\*)/g).map((part, i) => {
      const l = part.match(/^\[([^\]]+)\]\(((?:\/|https?:\/\/)[^)\s]+)\)$/);
      if (l) return l[2].startsWith("/") ? <Link key={`${k}-${i}`} href={l[2]} className="linkb">{l[1]}</Link> : <a key={`${k}-${i}`} href={l[2]} target="_blank" rel="noreferrer" className="linkb">{l[1]}</a>;
      const b = part.match(/^\*\*([^*]+)\*\*$/);
      return b ? <b key={`${k}-${i}`}>{b[1]}</b> : part;
    });
  return (
    <>
      {text.split("\n").map((line, i) => {
        const li = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
        return li ? <div key={i} className="cc-li">{inline(li[1], i)}</div> : line.trim() ? <div key={i}>{inline(line.replace(/^#+\s*/, ""), i)}</div> : <div key={i} style={{ height: 6 }} />;
      })}
    </>
  );
}

export function CommandChat({ examples, canAssign }: { examples: string[]; canAssign: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState(false);
  const rec = useRef<Rec | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    setVoice(!!(w.SpeechRecognition || w.webkitSpeechRecognition) && window.isSecureContext);
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);

  async function send(q: string) {
    q = q.trim();
    if (!q || busy) return;
    const history = turns.filter((t) => !t.err).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: q }]);
    setText(""); setBusy(true);
    let r: { text?: string; e?: string };
    try { r = await askCommandAction(history, q); } catch { r = { e: "Could not reach the server. Check the internet and try again." }; }
    setTurns((t) => [...t, r.text ? { role: "assistant", content: r.text } : { role: "assistant", content: r.e ?? "No answer", err: true }]);
    setBusy(false);
  }

  function mic() {
    if (listening) { rec.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const R = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!R) return;
    const r = new R();
    r.lang = "bn-BD"; r.interimResults = false;
    r.onresult = (e) => setText((t) => (t ? t + " " : "") + e.results[0][0].transcript);
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r; setListening(true); r.start();
  }

  return (
    <div className="cc">
      <div className="cc-log">
        {!turns.length && (
          <div className="cc-empty">
            <b>Ask anything about the work{canAssign ? ", or give a command" : ""}.</b>
            <span className="hint">Bangla or English. The answer comes from the app&apos;s own data.</span>
            <div className="chips">{examples.map((x) => <button key={x} type="button" className="chip" onClick={() => send(x)}>{x}</button>)}</div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`cc-msg ${t.role}${t.err ? " bad" : ""}`}>{t.role === "assistant" && !t.err ? <Rich text={t.content} /> : t.content}</div>
        ))}
        {busy && <div className="cc-msg assistant wait">Looking at the data…</div>}
        <div ref={end} />
      </div>
      <form className="cc-in" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        {voice && <button type="button" className={`btn${listening ? " primary" : ""}`} onClick={mic} aria-label="Speak">{listening ? "■ Stop" : "🎤"}</button>}
        <input className="inp" value={text} onChange={(e) => setText(e.target.value)} placeholder={listening ? "Listening…" : "Write a question or a command"} disabled={busy} autoFocus />
        <button className="btn primary" disabled={busy || !text.trim()}>Send</button>
      </form>
      {!voice && <p className="hint">Voice works after the app is on a secure (https) address. Typing works now.</p>}
    </div>
  );
}
