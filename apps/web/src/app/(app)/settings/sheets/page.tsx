import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { getSheetConfig, type SheetKind } from "@/lib/outbox";
import { sheetScript, SHEET_LABEL } from "@/lib/sheetScript";
import { fmtTime } from "@/lib/format";
import { Flash } from "@/components/TaskCard";
import { CopyBox } from "@/components/CopyBox";
import { uploadSnapshotAction } from "@/app/actions";

const KINDS: SheetKind[] = ["recruitment", "log", "broadcast"];

export default async function SheetsSettings({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const u = await requireModule("settings");
  const sp = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  // Google's script service needs a name, not a bare IP address: 1.2.3.4 -> 1.2.3.4.sslip.io (same server).
  const appUrl = `${proto}://${host.replace(/^(\d+\.\d+\.\d+\.\d+)(?=:|$)/, "$1.sslip.io")}`;
  const admin = u.level === "SUPER_ADMIN" && u.can("settings", "EDIT");
  const cfg = await getSheetConfig();
  const waiting = await prisma.sheetOutbox.groupBy({ by: ["sheet"], where: { sentAt: null }, _count: true });
  const counts = await Promise.all([prisma.interview.count(), prisma.logRow.count(), prisma.broadcastSlot.count()]);
  const fresh = (at?: string) => !!at && Date.now() - new Date(at).getTime() < 26 * 3600_000;

  return (
    <>
      <Link href="/settings" className="back">‹ Settings</Link>
      <h1 className="h1">Google Sheets connection</h1>
      <Flash sp={sp} />
      <p className="hint">
        Two-way: what is typed in a sheet comes to the app in a few seconds, and what is done in the app goes to the sheet within about a minute.
        In the app now: {counts[0]} interviews, {counts[1]} log rows, {counts[2]} call days.
      </p>
      {KINDS.map((k) => {
        const last = cfg.last?.[k];
        const send = cfg.lastSend?.[k];
        const wait = waiting.find((w) => w.sheet === k)?._count ?? 0;
        const on = fresh(last?.at);
        return (
          <div className="card" key={k}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{SHEET_LABEL[k]}</b>
              <span className={`pill ${on ? "p-good" : "p-amber"}`}>{on ? "Connected" : last ? "No data for a day" : "Not connected yet"}</span>
            </div>
            <div className="hint">
              {last ? <>Last from sheet: {fmtTime(new Date(last.at))} · {last.summary}</> : "Nothing received from this sheet yet."}
              {send && <><br />Last to sheet: {fmtTime(new Date(send.at))}{send.ok ? "" : ` · problem: ${send.error}`}</>}
              {wait > 0 && <><br />{wait} change(s) waiting to go to the sheet.</>}
            </div>
            {admin && <CopyBox label="Copy script for this sheet" text={sheetScript(k, appUrl, cfg.secret)} />}
          </div>
        );
      })}
      {admin && (
        <div className="card">
          <b>How to connect a sheet (once per sheet, about 2 minutes)</b>
          <ol className="alist">
            <li>Press <b>Copy script for this sheet</b> above.</li>
            <li>Open that Google Sheet with the owner account. Menu <b>Extensions → Apps Script</b>.</li>
            <li>Press <b>+</b> beside Files → <b>Script</b>, name it <b>CMAOffice</b>. Delete what is inside, paste, press Save (💾).</li>
            <li>Go back to the sheet and reload the page. A new menu <b>CMA Office</b> appears at the top.</li>
            <li>Menu <b>CMA Office → 1. Connect</b>. Google asks for permission: choose your account → Advanced → Go to (unsafe) → <b>Allow</b>. Then press <b>1. Connect</b> one more time.</li>
            <li>A box says how many tabs were sent. This page then shows <b>Connected</b>.</li>
          </ol>
          <p className="hint">Keep the script private: it holds this app&apos;s key. Do not rename the tabs or move the columns of the three sheets without telling, or the sync cannot find them.</p>
        </div>
      )}
      {admin && (
        <form action={uploadSnapshotAction} className="card">
          <b>Upload old data file</b>
          <p className="hint">Backup way to bring in the old data (the snapshot file of 18 Nov). Safe to do twice: rows are updated, never doubled.</p>
          <input type="file" name="file" accept=".json,application/json" required />
          <button className="btn" style={{ alignSelf: "flex-start" }}>Upload and import</button>
        </form>
      )}
    </>
  );
}
