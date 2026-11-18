"use client";
import { useState } from "react";
import { testWhatsAppAction } from "@/app/actions";

export function WhatsAppTest() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; e?: string } | null>(null);
  return (
    <>
      <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} disabled={busy}
        onClick={async () => { setBusy(true); setMsg(null); try { setMsg(await testWhatsAppAction()); } catch { setMsg({ e: "Could not reach the server" }); } setBusy(false); }}>
        {busy ? "Sending…" : "Send a test to my WhatsApp"}
      </button>
      {msg?.ok && <div className="ok">{msg.ok}</div>}
      {msg?.e && <div className="err">{msg.e}</div>}
    </>
  );
}
