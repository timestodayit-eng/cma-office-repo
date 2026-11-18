// Backup of attendance, salary setup and payroll to a Google Sheet of its own (app -> sheet only).
// The script in that sheet asks for these tabs every few minutes and rewrites them.
import { prisma } from "./db";
import { getAttRules, timeFor, clock, DAY_NAMES } from "./attendance";
import { getPayRules, paySheet, monthOf } from "./payroll";
import { todayDhaka } from "./format";

export type BackupInfo = { url?: string; at?: string; rows?: number };
export async function getBackupInfo(): Promise<BackupInfo> {
  return ((await prisma.setting.findUnique({ where: { key: "backup" } }))?.value as BackupInfo | undefined) ?? {};
}
export async function saveBackupInfo(value: BackupInfo) {
  await prisma.setting.upsert({ where: { key: "backup" }, update: { value: value as never }, create: { key: "backup", value: value as never } });
}

type Cell = string | number;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  while (out.length < 240) {
    const s = `${y}-${String(m).padStart(2, "0")}`;
    if (s > to) break;
    out.push(s);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export async function backupTabs(): Promise<{ name: string; rows: Cell[][] }[]> {
  const [people, att, rules, attRules, firstSlip] = await Promise.all([
    prisma.user.findMany({ where: { external: false }, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true, phone: true, active: true } }),
    prisma.attendance.findMany({ orderBy: [{ date: "desc" }, { checkIn: "asc" }] }),
    getPayRules(), getAttRules(),
    prisma.payslip.findFirst({ orderBy: { month: "asc" }, select: { month: true } }),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name]));

  const attendance: Cell[][] = [["Date", "Name", "Status", "Check in", "Check out", "Late", "How", "Note"]];
  for (const r of att) {
    attendance.push([iso(r.date), name.get(r.userId) ?? "", r.status, r.checkIn ? clock(r.checkIn) : "", r.checkOut ? clock(r.checkOut) : "", r.late ? "Late" : "", r.method === "admin" ? "Set by admin" : "Office WiFi", r.note ?? ""]);
  }

  const setup: Cell[][] = [["Name", "Designation", "Phone", "Basic salary", "Fixed allowance", "Total", "Note", "Office time", "Late after (min)", "Weekly off", "Active"]];
  for (const p of people) {
    const pay = rules.people[p.id];
    const t = timeFor(attRules, p.id);
    setup.push([p.name, p.designation ?? "", p.phone ?? "", pay?.basic ?? "", pay?.allowance ?? "", pay ? pay.basic + pay.allowance : "", pay?.note ?? "", `${t.start}-${t.end}`, t.graceMin, t.weeklyOff.map((d) => DAY_NAMES[d]).join(", "), p.active ? "Yes" : "No"]);
  }

  const now = monthOf(todayDhaka());
  const firstAtt = att.length ? monthOf(att[att.length - 1].date) : now;
  const start = [firstAtt, firstSlip?.month ?? now, now].sort()[0];
  const payroll: Cell[][] = [["Month", "Name", "Basic", "Allowance", "Present", "Late", "Leave", "Absent", "Unpaid days", "Cut for unpaid days", "Bonus", "Other deduction", "Net pay", "Status", "Note"]];
  for (const month of monthsBetween(start, now).reverse()) {
    const { lines } = await paySheet(month);
    for (const l of lines) {
      if (!l.hasPay && !l.present && !l.leave && !l.absent) continue;
      payroll.push([month, l.name, l.basic, l.allowance, l.present, l.late, l.leave, l.absent, l.unpaidDays, l.cut, l.bonus, l.deduction, l.net, l.status === "FINAL" ? "Final" : "Draft", l.note ?? ""]);
    }
  }

  const rulesTab: Cell[][] = [
    ["Rule", "Value"],
    ["Office time", `${attRules.start}-${attRules.end}`],
    ["Late after (minutes)", attRules.graceMin],
    ["Weekly off", attRules.weeklyOff.map((d) => DAY_NAMES[d]).join(", ")],
    ["One day's pay = basic ÷", rules.daysInMonth],
    ["Late days that cut 1 day's pay", rules.latesPerDay],
    ["Cut pay for absent days", rules.cutAbsent ? "Yes" : "No"],
    ["Absence counted from", rules.countFrom || "first check-in"],
  ];
  return [{ name: "Attendance", rows: attendance }, { name: "Payroll", rows: payroll }, { name: "Salary setup", rows: setup }, { name: "Rules", rows: rulesTab }];
}

/** The script for the backup sheet. It only writes the four backup tabs; other tabs in that sheet are left alone. */
export function backupScript(appUrl: string, secret: string) {
  return `/**
 * CMA Office -> Attendance & Payroll backup (app to sheet only)
 * First time: choose the function  cmaBackupConnect  at the top of the editor and press Run, then Allow.
 * The tabs Attendance, Payroll, Salary setup and Rules are rewritten every 5 minutes. Do not type in them;
 * add your own tabs if you want to keep notes.
 */
var CMA_APP = ${JSON.stringify(appUrl.replace(/\/$/, ""))};
var CMA_KEY = ${JSON.stringify(secret)};

function cmaBackupMenu() {
  SpreadsheetApp.getUi().createMenu('CMA Office')
    .addItem('Back up now', 'cmaBackupNow')
    .addItem('Connect again', 'cmaBackupConnect')
    .addItem('Stop the backup', 'cmaBackupStop')
    .addToUi();
}
function cmaBackupSay_(msg) { Logger.log(msg); try { SpreadsheetApp.getActive().toast(msg, 'CMA Office', 8); } catch (e) {} }
function cmaBackupStop_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction().indexOf('cmaBackup') === 0) ScriptApp.deleteTrigger(t); });
}
function cmaBackupStop() { cmaBackupStop_(); cmaBackupSay_('Backup stopped.'); }
function cmaBackupConnect() {
  cmaBackupStop_();
  var ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('cmaBackupMenu').forSpreadsheet(ss).onOpen().create();
  ScriptApp.newTrigger('cmaBackup').timeBased().everyMinutes(5).create();
  var n = cmaBackup();
  try { cmaBackupMenu(); } catch (e) {}
  cmaBackupSay_('Connected. ' + n + ' rows backed up. The sheet now updates every 5 minutes.');
}
function cmaBackupNow() { cmaBackupSay_(cmaBackup() + ' rows backed up.'); }

function cmaBackup() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return 0;
  try {
    var ss = SpreadsheetApp.getActive();
    var res = UrlFetchApp.fetch(CMA_APP + '/api/sheets/backup', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ secret: CMA_KEY, url: ss.getUrl() })
    });
    var out;
    try { out = JSON.parse(res.getContentText()); } catch (e) { throw new Error('CMA Office did not answer (' + res.getResponseCode() + ')'); }
    if (!out.ok) throw new Error(out.error || 'CMA Office refused');
    var total = 0;
    out.tabs.forEach(function (t, i) {
      var sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name, i);
      var w = t.rows[0].length;
      sh.clearContents();
      if (sh.getMaxRows() < t.rows.length) sh.insertRowsAfter(sh.getMaxRows(), t.rows.length - sh.getMaxRows());
      if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
      sh.getRange(1, 1, t.rows.length, w).setValues(t.rows);
      sh.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#e8f0fe');
      sh.setFrozenRows(1);
      total += t.rows.length - 1;
    });
    var blank = ss.getSheetByName('Sheet1');
    if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
    return total;
  } finally { lock.releaseLock(); }
}
`;
}
