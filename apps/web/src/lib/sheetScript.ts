// The script Jamil ADDS as a new file in each Google Sheet (Extensions > Apps Script), beside the scripts
// the sheet already has. All names are cma-prefixed and there is no onOpen/onEdit, so nothing clashes.
// One script for all three sheets; only SHEET differs. It needs no Google Cloud setup:
// it sends edited tabs to the app, and once a minute collects the app's changes.

export const SHEET_LABEL = {
  recruitment: "Recruitment Command Center",
  broadcast: "Banglalink Call Broadcast Panel",
  log: "Digital Media Solution Log Sheet",
} as const;

export function sheetScript(kind: keyof typeof SHEET_LABEL, appUrl: string, secret: string) {
  return `/**
 * CMA Office <-> ${SHEET_LABEL[kind]} (two-way sync)
 * ADD this as a NEW script file beside the scripts the sheet already has. Do not delete or change them.
 * Every name here starts with cma / CMA_, and there is no onOpen or onEdit, so the old scripts keep working.
 * First time: choose the function  cmaConnect  at the top of the editor and press Run, then Allow.
 */
var CMA_APP = ${JSON.stringify(appUrl.replace(/\/$/, ""))};
var CMA_KEY = ${JSON.stringify(secret)};
var CMA_SHEET = ${JSON.stringify(kind)};
var CMA_AGENCIES = ['Creative International', 'Coastal Manpower', 'SM Enterprise'];
var CMA_TZ = 'Asia/Dhaka';

/** Adds the "CMA Office" menu beside the menus the sheet already has (run by its own trigger, not by onOpen). */
function cmaMenu() {
  SpreadsheetApp.getUi().createMenu('CMA Office')
    .addItem('Connect again', 'cmaConnect')
    .addItem('Send everything to the app now', 'cmaSendAll')
    .addItem('Get app changes now', 'cmaPull')
    .addItem('Disconnect', 'cmaDisconnect')
    .addToUi();
}

/** A small note at the bottom of the sheet; also written to the run log. Never blocks. */
function cmaSay_(msg) {
  Logger.log(msg);
  try { SpreadsheetApp.getActive().toast(msg, 'CMA Office', 8); } catch (e) {}
}

function cmaConnect() {
  cmaDisconnect_();
  var ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('cmaMenu').forSpreadsheet(ss).onOpen().create();
  ScriptApp.newTrigger('cmaOnEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('cmaOnChange').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('cmaPull').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('cmaSafety').timeBased().everyMinutes(15).create();
  var n = cmaSendAll_();
  try { cmaMenu(); } catch (e) {}
  cmaSay_('Connected. ' + n + ' tab(s) sent to CMA Office. From now on both sides stay in step.');
}

function cmaDisconnect() { cmaDisconnect_(); cmaSay_('Disconnected from CMA Office.'); }
function cmaDisconnect_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction().indexOf('cma') === 0) ScriptApp.deleteTrigger(t);
  });
}

function cmaIsDayTab_(name) { return /^\\d{1,2} [A-Za-z]{3}$/.test(name); }
function cmaIsDataTab_(name) { return CMA_SHEET === 'log' ? cmaIsDayTab_(name) : CMA_AGENCIES.indexOf(name) >= 0; }

/** Cell values with real dates turned into yyyy-MM-dd text. */
function cmaValues_(sh) {
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (!lr || !lc) return [];
  return sh.getRange(1, 1, lr, Math.min(lc, 30)).getValues().map(function (r) {
    return r.map(function (c) { return c instanceof Date ? Utilities.formatDate(c, CMA_TZ, 'yyyy-MM-dd') : c; });
  });
}

function cmaPost_(path, payload) {
  payload.secret = CMA_KEY; payload.sheet = CMA_SHEET; payload.url = SpreadsheetApp.getActive().getUrl();
  var res = UrlFetchApp.fetch(CMA_APP + '/api/sheets/' + path, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var out;
  try { out = JSON.parse(res.getContentText()); } catch (e) { throw new Error('CMA Office did not answer (' + res.getResponseCode() + ')'); }
  if (!out.ok) throw new Error(out.error || 'CMA Office refused the data');
  return out;
}

function cmaPushTabs_(sheets) {
  var batch = [], size = 0, sent = 0;
  sheets.forEach(function (sh) {
    var rows = cmaValues_(sh);
    batch.push({ tab: sh.getName(), rows: rows }); size += rows.length;
    if (size > 600) { cmaPost_('push', { tabs: batch }); sent += batch.length; batch = []; size = 0; }
  });
  if (batch.length) { cmaPost_('push', { tabs: batch }); sent += batch.length; }
  return sent;
}

function cmaSendAll() { cmaSay_(cmaSendAll_() + ' tab(s) sent to CMA Office.'); }
function cmaSendAll_() {
  return cmaPushTabs_(SpreadsheetApp.getActive().getSheets().filter(function (s) { return cmaIsDataTab_(s.getName()); }));
}

/** Every 15 minutes: the tabs that can still change, in case an edit was missed. */
function cmaSafety() {
  var all = SpreadsheetApp.getActive().getSheets().filter(function (s) { return cmaIsDataTab_(s.getName()); });
  if (CMA_SHEET === 'log') {
    var now = new Date(), keep = {};
    for (var i = 0; i < 3; i++) keep[Utilities.formatDate(new Date(now.getTime() - i * 864e5), CMA_TZ, 'dd MMM')] = true;
    all = all.filter(function (s) { return keep[s.getName()]; });
  }
  cmaPushTabs_(all);
}

function cmaOnEdit(e) {
  var sh = e && e.range ? e.range.getSheet() : SpreadsheetApp.getActiveSheet();
  if (!cmaIsDataTab_(sh.getName())) return;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return;
  try { cmaPushTabs_([sh]); } finally { lock.releaseLock(); }
}
/** Rows inserted or deleted. */
function cmaOnChange(e) {
  if (e && (e.changeType === 'EDIT' || e.changeType === 'FORMAT' || e.changeType === 'OTHER')) return;
  cmaOnEdit({ range: null });
}

/* ---------- app -> sheet ---------- */

function cmaPull() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return;
  try {
    var ops = cmaPost_('pull', {}).ops || [];
    if (!ops.length) return;
    var results = ops.map(function (op) {
      try { return { id: op.id, ok: true, row: cmaApply_(op) }; }
      catch (err) { return { id: op.id, ok: false, error: String(err && err.message || err) }; }
    });
    SpreadsheetApp.flush();
    cmaPost_('ack', { results: results });
  } finally { lock.releaseLock(); }
}

function cmaApply_(op) {
  var ss = SpreadsheetApp.getActive();
  if (op.type === 'log.set') return cmaLogSet_(ss, op);
  var sh = ss.getSheetByName(op.tab);
  if (!sh) throw new Error('Tab not found: ' + op.tab);
  if (op.type === 'rec.append') return cmaRecAppend_(sh, op.values);
  if (op.type === 'bc.append') return cmaBcAppend_(sh, op.values);
  if (op.type === 'bc.tick') return cmaBcTick_(sh, op);
  throw new Error('Unknown change: ' + op.type);
}

/** Day tab "dd MMM"; made by copying the newest day tab when it does not exist yet. */
function cmaDayTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  var days = ss.getSheets().filter(function (s) { return cmaIsDayTab_(s.getName()); });
  if (!days.length) throw new Error('No day tab to copy for ' + name);
  sh = days[0].copyTo(ss).setName(name);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  ss.setActiveSheet(sh); ss.moveActiveSheet(1);
  return sh;
}

function cmaLogSet_(ss, op) {
  var sh = cmaDayTab_(ss, op.tab), row = op.row, n = op.values.length;
  if (op.isNew) {
    // A new row goes on the first empty row of the tab, never over a row somebody filled in the sheet.
    row = 2;
    var last = Math.max(sh.getLastRow(), row);
    var cur = sh.getRange(row, 2, last - row + 2, n).getValues();
    for (var i = 0; i < cur.length; i++) {
      if (cur[i].join('') === '' || cur[i][0] === op.values[0]) { row += i; break; }
    }
  }
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), row - sh.getMaxRows());
  sh.getRange(row, 2, 1, n).setValues([op.values]);
  return row;
}

function cmaHeaderCols_(sh) {
  var vals = sh.getRange(1, 1, Math.min(sh.getLastRow(), 15), sh.getLastColumn()).getValues();
  for (var r = 0; r < vals.length; r++) {
    var map = {};
    vals[r].forEach(function (c, i) { map[String(c).toLowerCase().replace(/\\s+/g, ' ').trim()] = i + 1; });
    if (map['interview date']) return { row: r + 1, map: map, head: vals[r] };
  }
  throw new Error('Header row not found in ' + sh.getName());
}

/** First row under the data where the Company Name cell is empty. */
function cmaFreeRow_(sh, h) {
  var col = h.map['company name'] || 2, last = sh.getLastRow();
  var names = last > h.row ? sh.getRange(h.row + 1, col, last - h.row, 1).getValues() : [];
  var r = names.length;
  while (r > 0 && String(names[r - 1][0]).trim() === '') r--;
  return h.row + 1 + r;
}

function cmaFindRow_(sh, h, co, date) {
  var last = sh.getLastRow();
  if (last <= h.row) return 0;
  var cCo = h.map['company name'] || 2, cDate = h.map['interview date'];
  var vals = sh.getRange(h.row + 1, 1, last - h.row, Math.max(cCo, cDate)).getValues();
  var want = String(co).trim().toLowerCase().replace(/\\s+/g, ' ');
  for (var i = 0; i < vals.length; i++) {
    var d = vals[i][cDate - 1];
    var iso = d instanceof Date ? Utilities.formatDate(d, CMA_TZ, 'yyyy-MM-dd') : '';
    if (iso === date && String(vals[i][cCo - 1]).trim().toLowerCase().replace(/\\s+/g, ' ') === want) return h.row + 1 + i;
  }
  return 0;
}

function cmaAsDate_(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

/** New interview from the app. Only the input cells are written; finance cells and formulas are left alone. */
function cmaRecAppend_(sh, v) {
  var h = cmaHeaderCols_(sh);
  var row = cmaFindRow_(sh, h, v.co, v.date) || cmaFreeRow_(sh, h);
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  var set = function (name, val) { if (h.map[name] && val !== '' && val != null) sh.getRange(row, h.map[name]).setValue(val); };
  if (String(sh.getRange(row, 1).getValue()).trim() === '') sh.getRange(row, 1).setValue(v.agency);
  set('company name', v.co); set('country', v.country); set('interview date', cmaAsDate_(v.date));
  set('details', v.details); set('marketing plan $', v.mplan);
  return row;
}

function cmaV1Col_(h) {
  for (var i = 0; i < h.head.length; i++) if (/^V1\\b/i.test(String(h.head[i]).trim())) return i + 1;
  throw new Error('V1 column not found');
}

function cmaBcAppend_(sh, v) {
  var h = cmaHeaderCols_(sh), c = cmaV1Col_(h);
  var row = cmaFindRow_(sh, h, v.co, v.date);
  if (row) return row;
  row = cmaFreeRow_(sh, h);
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  sh.getRange(row, 1, 1, 4).setValues([[v.agency, v.co, v.country, cmaAsDate_(v.date)]]);
  (v.days || []).forEach(function (d, i) {
    sh.getRange(row, c + i * 3).setValue(cmaAsDate_(d));
    sh.getRange(row, c + i * 3 + 1, 1, 2).insertCheckboxes();
  });
  sh.getRange(row, c + 21).setValue('SINGLE');
  return row;
}

function cmaBcTick_(sh, op) {
  var h = cmaHeaderCols_(sh), c = cmaV1Col_(h) + (op.slot - 1) * 3;
  var row = cmaFindRow_(sh, h, op.co, op.date);
  if (!row) throw new Error('Interview not found in ' + sh.getName() + ': ' + op.co + ' ' + op.date);
  sh.getRange(row, c + 1, 1, 2).setValues([[!!op.received, !!op.missed]]);
  return row;
}
`;
}
