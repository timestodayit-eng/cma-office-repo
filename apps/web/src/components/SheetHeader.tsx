import Link from "next/link";
import { fmtTime } from "@/lib/format";
import type { SheetKind } from "@/lib/outbox";

/** True when the sheet sent data in the last day. */
export const sheetLive = (last?: { at: string }) => !!last && Date.now() - new Date(last.at).getTime() < 26 * 3600_000;

/**
 * The Google-Sheet style header used on the Log Sheet: sheet icon, name, status line,
 * "Connect the sheet" / "Open in Google" button and the two-way sync banner under it.
 */
export function SheetHeader({ kind, title, last, canConnect, children }: {
  kind: SheetKind; title: string; last?: { at: string; url?: string; summary?: string }; canConnect: boolean; children?: React.ReactNode;
}) {
  const on = sheetLive(last);
  const connectHref = `/settings/sheets?sheet=${kind}`;
  return (
    <div className="gs">
      <div className="gsh">
        <span className="gsi">▦</span>
        <div className="grow">
          <b>{title}</b>
          <span>{on ? <>Connected to your Google Sheet · two-way sync · {fmtTime(new Date(last!.at))}</> : last ? "No data from the Google Sheet for a day" : "Not connected to the Google Sheet yet"}</span>
        </div>
        <div className="gsa">{on && last?.url ? (
          <>
            <a className="btn sm" href={last.url} target="_blank" rel="noreferrer">Open in Google ↗</a>
            {canConnect && <Link className="btn sm" href={connectHref}>Sheet settings</Link>}
          </>
        ) : canConnect ? <Link className="btn sm" href={connectHref}>{last ? "Reconnect the sheet" : "Connect the sheet"}</Link> : null}</div>
      </div>
      <div className={`gsn${on ? "" : " off"}`}><span className="dot" />
        {on
          ? <span><b>Two-way sync with Google Sheet.</b> Type in the app and it goes to the sheet. Type in the sheet and it comes here.</span>
          : <span><b>Not synced yet.</b> What you enter here is saved in the app and goes to the Google Sheet as soon as it is connected.{canConnect ? "" : " Ask an admin to connect it from Settings → Google Sheets."}</span>}
      </div>
      {children}
    </div>
  );
}
