"use client";
import { useState } from "react";
import { findDuplicateNames, type NameRecord } from "@cma/core";

/** "Check a company name before adding": same rule as the sheet's script. */
export function NameCheck({ existing }: { existing: NameRecord[] }) {
  const [v, setV] = useState("");
  const name = v.trim();
  const m = name ? findDuplicateNames(name, existing) : [];
  return (
    <div className="card" style={{ gap: 6 }}>
      <label className="field">Check a company name before adding
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Type the company name" />
      </label>
      {name && (m.length ? (
        <div className="bcdup"><b>⚠ Duplicate company name</b><span>Entered name: {name}</span><span>Previous match found:</span>
          {m.slice(0, 8).map((x, i) => <span key={i}>• {x.agency}: {x.name}{x.row ? ` (interview ${x.row})` : ""}</span>)}
        </div>
      ) : <div className="bcnew">✅ <b>No previous match.</b> &quot;{name}&quot; is a new company name.</div>)}
      <span className="hint">It looks in all three companies and ignores capital letters, spaces and symbols.</span>
    </div>
  );
}
