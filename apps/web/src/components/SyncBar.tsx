import Link from "next/link";
import { fmtTime } from "@/lib/format";

/** Green when the sheet sent data in the last day, amber when it is not connected. */
export function SyncBar({ last, label, url }: { last?: { at: string; url?: string }; label: string; url?: string }) {
  const on = !!last && Date.now() - new Date(last.at).getTime() < 26 * 3600_000;
  const open = url ?? last?.url;
  return (
    <div className={`syncbar${on ? "" : " off"}`}>
      <span className="dot" />
      {on ? <>Two-way sync with {label} · {fmtTime(new Date(last!.at))}</> : <>Not connected to {label} yet</>}
      {open && on ? <a className="linkb" href={open} target="_blank" rel="noreferrer">Open in Google ↗</a> : <Link className="linkb" href="/settings/sheets">{on ? "Sync" : "Connect"}</Link>}
    </div>
  );
}
