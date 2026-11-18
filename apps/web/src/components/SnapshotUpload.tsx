"use client";
import { useState } from "react";
import { uploadSnapshotAction } from "@/app/actions";

/** Old data upload with a visible "working" state: the import takes up to a minute. */
export function SnapshotUpload() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; e?: string } | null>(null);
  return (
    <form
      className="card"
      onSubmit={async (ev) => {
        ev.preventDefault();
        if (busy) return;
        setBusy(true); setMsg(null);
        try { setMsg(await uploadSnapshotAction(new FormData(ev.currentTarget))); }
        catch { setMsg({ e: "Could not reach the server. Reload the page and try again." }); }
        setBusy(false);
      }}
    >
      <b>Upload old data file</b>
      <p className="hint">Backup way to bring in the old data (the snapshot file of 18 Nov). Safe to do twice: rows are updated, never doubled.</p>
      <input type="file" name="file" accept=".json,application/json" required disabled={busy} />
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy}>{busy ? "Importing… please wait, up to 1 minute" : "Upload and import"}</button>
      {msg?.ok && <div className="ok">{msg.ok}</div>}
      {msg?.e && <div className="err">{msg.e}</div>}
    </form>
  );
}
