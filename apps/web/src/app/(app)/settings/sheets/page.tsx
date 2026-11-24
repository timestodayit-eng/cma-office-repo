import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { getSheetConfig, type SheetKind } from "@/lib/outbox";
import { sheetScript, SHEET_LABEL } from "@/lib/sheetScript";
import { backupScript, getBackupInfo } from "@/lib/backup";
import { fmtTime } from "@/lib/format";
import { Flash } from "@/components/TaskCard";
import { CopyBox } from "@/components/CopyBox";
import { SnapshotUpload } from "@/components/SnapshotUpload";
import { AutoRefresh } from "@/components/AutoRefresh";

const KINDS: SheetKind[] = ["recruitment", "log", "broadcast"];
/** Where each sheet lives in the app, for the "back" link of the one-sheet connect view. */
const HOME: Record<SheetKind, [string, string]> = {
  recruitment: ["/recruitment", "Recruitment Command Center"],
  log: ["/logsheet", "Log Sheet"],
  broadcast: ["/broadcast", "Broadcast"],
};

export default async function SheetsSettings({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string; sheet?: string }> }) {
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
  const backup = await getBackupInfo();
  const payAdmin = u.has("payroll");
  const fresh = (at?: string) => !!at && Date.now() - new Date(at).getTime() < 26 * 3600_000;
  const focus = KINDS.find((k) => k === sp.sheet);

  const steps = (
    <>
      <p className="warn"><b>Do not delete the scripts the sheet already has.</b> This script is added as a new file beside them. Your Automation menu, daily tabs, reports and duplicate check keep working as before.</p>
      <ol className="alist">
        <li>Press <b>Copy script for this sheet</b>{focus ? "" : " above"}.</li>
        <li>Open that Google Sheet with the owner account. Menu <b>Extensions → Apps Script</b>. Leave the code you see there as it is.</li>
        <li>On the left, press <b>+</b> beside Files → <b>Script</b>. Name the new file <b>CMAOffice</b>. (Already have a CMAOffice file? Open it and replace its code instead.)</li>
        <li>Only inside this new file: remove the three sample lines (<code>function myFunction…</code>), paste, press Save (💾).</li>
        <li>At the top of the editor choose the function <b>cmaConnect</b> and press <b>▶ Run</b>. Google asks for permission: choose your account → Advanced → Go to (unsafe) → <b>Allow</b>.</li>
        <li>This page then shows <b>Connected</b> by itself. When you reload the sheet, a new menu <b>CMA Office</b> appears next to your own menus.</li>
      </ol>
      <p className="hint">Keep the script private: it holds this app&apos;s key. Do not rename the tabs or move the columns of the sheet without telling, or the sync cannot find them.</p>
    </>
  );

  return (
    <>
      {focus
        ? <Link href={HOME[focus][0]} className="back">‹ {HOME[focus][1]}</Link>
        : <Link href="/settings" className="back">‹ Settings</Link>}
      <h1 className="h1">{focus ? `Connect: ${SHEET_LABEL[focus]}` : "Google Sheets connection"}</h1>
      <Flash sp={sp} />
      <p className="hint">
        Two-way: what is typed in a sheet comes to the app in a few seconds, and what is done in the app goes to the sheet within about a minute.
        In the app now: {counts[0]} interviews, {counts[1]} log rows, {counts[2]} call days.
        {focus && <> · <Link href="/settings/sheets">All sheets</Link></>}
      </p>
      {focus && <AutoRefresh active={!fresh(cfg.last?.[focus]?.at)} />}
      {(focus ? [focus] : KINDS).map((k) => {
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
            {on && last?.url && <a className="btn sm" href={last.url} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start" }}>Open in Google ↗</a>}
            {admin && <CopyBox label="Copy script for this sheet" text={sheetScript(k, appUrl, cfg.secret)} />}
            {admin && focus && (on
              ? <p className="hint"><b>Connected.</b> Two-way sync is on. You only need the steps below again if you make a new copy of the sheet.</p>
              : <p className="hint">Waiting for the sheet… this page checks every few seconds.</p>)}
            {admin && focus && steps}
            {!admin && <p className="hint">Only the super admin can copy the connect script.</p>}
          </div>
        );
      })}
      {admin && !focus && <div className="card"><b>How to connect a sheet (once per sheet, about 2 minutes)</b>{steps}</div>}
      {payAdmin && !focus && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>Attendance &amp; Payroll backup sheet</b>
            <span className={`pill ${backup.at && Date.now() - new Date(backup.at).getTime() < 3600_000 ? "p-good" : "p-amber"}`}>{backup.at ? (Date.now() - new Date(backup.at).getTime() < 3600_000 ? "Backing up" : "Stopped") : "Not connected yet"}</span>
          </div>
          <div className="hint">
            A separate Google Sheet that keeps a copy of all attendance, every person&apos;s salary and every month&apos;s payroll. The app writes to it every 5 minutes; nothing typed in that sheet comes back to the app.
            {backup.at && <><br />Last backup: {fmtTime(new Date(backup.at))} · {backup.rows} rows{backup.url && <> · <a href={backup.url} target="_blank" rel="noreferrer">Open the sheet</a></>}</>}
          </div>
          <CopyBox label="Copy script for the backup sheet" text={backupScript(appUrl, cfg.secret)} />
          <ol className="alist">
            <li>Open the backup sheet with the owner account. Menu <b>Extensions → Apps Script</b>.</li>
            <li>Remove the sample lines, paste the copied script, press Save (💾).</li>
            <li>Choose the function <b>cmaBackupConnect</b> at the top and press <b>▶ Run</b>, then <b>Allow</b>.</li>
          </ol>
          <p className="warn">This sheet shows everyone&apos;s salary. Share it only with the people who may see salaries.</p>
        </div>
      )}
      {admin && !focus && (
        <SnapshotUpload />
      )}
    </>
  );
}
