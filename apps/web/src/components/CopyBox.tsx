"use client";
import { useState } from "react";

/** Read-only code box with a Copy button. */
export function CopyBox({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copybox">
      <button
        type="button"
        className="btn sm primary"
        onClick={async () => {
          try { await navigator.clipboard.writeText(text); } catch {
            const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
          }
          setDone(true); setTimeout(() => setDone(false), 2500);
        }}
      >{done ? "Copied ✓" : label}</button>
      <details><summary>Show the script</summary><textarea readOnly value={text} rows={12} spellCheck={false} /></details>
    </div>
  );
}
