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

const tabMonth = (month: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(month + "-01T00:00:00Z"));
const pad = (rows: Cell[][]) => { const w = Math.max(...rows.map((r) => r.length)); return rows.map((r) => [...r, ...Array(w - r.length).fill("")]); };

/**
 * One "Payroll <month>" and one "Attendance <month>" tab for every month, newest first, then Salary setup and Rules.
 * full = every month since the start; otherwise only this month and the last one (older months no longer change).
 */
export async function backupTabs(full = true): Promise<{ name: string; rows: Cell[][] }[]> {
  const [people, firstAtt, rules, attRules, firstSlip] = await Promise.all([
    prisma.user.findMany({ where: { external: false }, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true, phone: true, active: true } }),
    prisma.attendance.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
    getPayRules(), getAttRules(),
    prisma.payslip.findFirst({ orderBy: { month: "asc" }, select: { month: true } }),
  ]);
  const now = monthOf(todayDhaka());
  const start = [firstAtt ? monthOf(firstAtt.date) : now, firstSlip?.month ?? now, now].sort()[0];
  let months = monthsBetween(start, now).reverse();
  if (!full) months = months.slice(0, 2);
  const tabs: { name: string; rows: Cell[][] }[] = [];

  for (const month of months) {
    const [y, m] = month.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const [{ lines }, att] = await Promise.all([
      paySheet(month),
      prisma.attendance.findMany({ where: { date: { gte: new Date(Date.UTC(y, m - 1, 1)), lte: new Date(Date.UTC(y, m - 1, days)) } }, orderBy: [{ date: "asc" }, { checkIn: "asc" }] }),
    ]);
    const demo = att.some((r) => r.note === "DEMO") || lines.some((l) => rules.people[l.userId]?.note === "DEMO");

    const pay: Cell[][] = [
      [`Payroll · ${tabMonth(month)}${demo ? " · DEMO DATA, not real" : ""}`],
      ["Name", "Designation", "Basic", "Allowance", "Present", "Late", "Leave", "Absent", "Unpaid days", "Cut for unpaid days", "Overtime hours", "Overtime pay", "Bonus", "Other deduction", "Net pay", "Status", "Note"],
    ];
    const shown = lines.filter((l) => l.hasPay || l.status === "FINAL" || l.present || l.leave || l.absent);
    for (const l of shown) pay.push([l.name, l.designation ?? "", l.basic, l.allowance, l.present, l.late, l.leave, l.absent, l.unpaidDays, l.cut, l.otHours, l.otPay, l.bonus, l.deduction, l.net, l.status === "FINAL" ? "Final" : "Draft", l.note ?? ""]);
    const sum = (f: (l: (typeof shown)[number]) => number) => shown.reduce((a, l) => a + f(l), 0);
    pay.push(["TOTAL", "", sum((l) => l.basic), sum((l) => l.allowance), "", "", "", "", "", sum((l) => l.cut), sum((l) => l.otHours), sum((l) => l.otPay), sum((l) => l.bonus), sum((l) => l.deduction), sum((l) => l.net), "", ""]);
    tabs.push({ name: `Payroll ${tabMonth(month)}`, rows: pad(pay) });

    // Attendance: one row per person, one column per day, then the full list with times.
    const dayCols = Array.from({ length: days }, (_, i) => i + 1);
    const grid: Cell[][] = [
      [`Attendance · ${tabMonth(month)}${demo ? " · DEMO DATA, not real" : ""} · P = present, L = late, A = absent, Lv = leave, - = weekly off`],
      ["Name", ...dayCols, "Present", "Late", "Leave", "Absent"],
    ];
    const name = new Map(people.map((p) => [p.id, p.name]));
    for (const l of lines) {
      const mine = new Map(att.filter((r) => r.userId === l.userId).map((r) => [r.date.getUTCDate(), r]));
      if (!mine.size && !l.absent) continue;
      const off = timeFor(attRules, l.userId).weeklyOff;
      grid.push([l.name, ...dayCols.map((d) => {
        const r = mine.get(d);
        if (r) return r.status === "LEAVE" ? (r.paidLeave === false ? "ULv" : "Lv") : r.status === "ABSENT" ? "A" : r.late ? "L" : "P";
        return off.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay()) ? "-" : "";
      }), l.present, l.late, l.leave, l.absent]);
    }
    grid.push([""], ["Every entry"], ["Date", "Name", "Status", "Check in", "Check out", "Late", "How", "Note"]);
    for (const r of att) grid.push([iso(r.date), name.get(r.userId) ?? "", r.status, r.checkIn ? clock(r.checkIn) : "", r.checkOut ? clock(r.checkOut) : "", r.late ? "Late" : "", r.method === "admin" ? "Set by admin" : r.method === "leave" ? "Leave application" : "Office WiFi", r.note ?? ""]);
    tabs.push({ name: `Attendance ${tabMonth(month)}`, rows: pad(grid) });
  }

  const setup: Cell[][] = [["Name", "Designation", "Phone", "Basic salary", "Fixed allowance", "Total", "Note", "Office time", "Late after (min)", "Weekly off", "Active"]];
  for (const p of people) {
    const pay = rules.people[p.id];
    const t = timeFor(attRules, p.id);
    setup.push([p.name, p.designation ?? "", p.phone ?? "", pay?.basic ?? "", pay?.allowance ?? "", pay ? pay.basic + pay.allowance : "", pay?.note ?? "", `${t.start}-${t.end}`, t.graceMin, t.weeklyOff.map((d) => DAY_NAMES[d]).join(", "), p.active ? "Yes" : "No"]);
  }
  const rulesTab: Cell[][] = [
    ["Rule", "Value"],
    ["Office time", `${attRules.start}-${attRules.end}`],
    ["Late after (minutes)", attRules.graceMin],
    ["Weekly off", attRules.weeklyOff.map((d) => DAY_NAMES[d]).join(", ")],
    ["One day's pay = basic ÷", rules.daysInMonth],
    ["Working hours in a day (overtime hour = basic ÷ days ÷ this)", rules.hoursPerDay],
    ["Late days that cut 1 day's pay", rules.latesPerDay],
    ["Cut pay for absent days", rules.cutAbsent ? "Yes" : "No"],
    ["Absence counted from", rules.countFrom || "first check-in"],
  ];
  tabs.push({ name: "Salary setup", rows: setup }, { name: "Rules", rows: rulesTab });
  return tabs;
}

/** The script for the backup sheet. It only writes the four backup tabs; other tabs in that sheet are left alone. */
export function backupScript(appUrl: string, secret: string) {
  return `/**
 * CMA Office -> Attendance & Payroll backup (app to sheet only)
 * First time: choose the function  cmaBackupConnect  at the top of the editor and press Run, then Allow.
 * Every month gets its own tabs: "Payroll Oct 2026", "Attendance Oct 2026" and so on, plus Salary setup and Rules.
 * This month and last month are rewritten every 5 minutes, all months once a day. Do not type in these tabs;
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
  ScriptApp.newTrigger('cmaBackupAll').timeBased().everyDays(1).atHour(3).create();
  var n = cmaBackup(true);
  try { cmaBackupMenu(); } catch (e) {}
  cmaBackupSay_('Connected. ' + n + ' rows backed up. The sheet now updates every 5 minutes.');
}
function cmaBackupNow() { cmaBackupSay_(cmaBackup(true) + ' rows backed up.'); }
function cmaBackupAll() { cmaBackup(true); }

function cmaBackup(all) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return 0;
  try {
    var ss = SpreadsheetApp.getActive();
    var res = UrlFetchApp.fetch(CMA_APP + '/api/sheets/backup', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ secret: CMA_KEY, url: ss.getUrl(), full: all === true })
    });
    var out;
    try { out = JSON.parse(res.getContentText()); } catch (e) { throw new Error('CMA Office did not answer (' + res.getResponseCode() + ')'); }
    if (!out.ok && /Unknown sheet|Unknown action/.test(out.error || '')) throw new Error('The app on the server is an old version. Run update.sh on the server, then run cmaBackupConnect again.');
    if (!out.ok) throw new Error(out.error || 'CMA Office refused');
    var total = 0;
    out.tabs.forEach(function (t, i) {
      var sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name, Math.min(i, ss.getSheets().length));
      var w = t.rows[0].length, monthTab = /^(Payroll|Attendance) /.test(t.name), head = monthTab ? 2 : 1;
      sh.clearContents();
      sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setFontWeight('normal').setBackground(null);
      if (sh.getMaxRows() < t.rows.length) sh.insertRowsAfter(sh.getMaxRows(), t.rows.length - sh.getMaxRows());
      if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
      sh.getRange(1, 1, t.rows.length, w).setValues(t.rows);
      sh.getRange(1, 1, head, w).setFontWeight('bold');
      sh.getRange(head, 1, 1, w).setBackground('#e8f0fe');
      if (/^Payroll /.test(t.name)) sh.getRange(t.rows.length, 1, 1, w).setFontWeight('bold').setBackground('#f1f3f4');
      if (/^Attendance /.test(t.name)) sh.setFrozenColumns(1);
      sh.setFrozenRows(head);
      total += t.rows.length - head;
    });
    var blank = ss.getSheetByName('Sheet1');
    if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
    return total;
  } finally { lock.releaseLock(); }
}
`;
}
