// How the three Google Sheets are read: column headers -> app fields, sheet dates -> days.
// The Apps Script inside each sheet uses the same header rules when it writes back.

export const LOG_COLS = [
  "title", "deadline", "priority", "company", "mainCategory", "contentType", "scriptWriter", "scriptLink", "presenter",
  "cinematographer", "videoEditor", "status", "thumbnail", "rawFile", "finalOutput", "comments", "uploadFacebook",
  "uploadYoutube", "uploadTiktok", "platformFacebook", "platformYoutube", "platformTiktok", "finalComments",
] as const;
export type LogCol = (typeof LOG_COLS)[number];

export type RecField =
  | "date" | "co" | "country" | "work" | "details" | "mplan" | "status" | "topup" | "pc" | "usd" | "bdt" | "leads";

const norm = (h: unknown) => String(h ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** Recruitment tab header -> field. First match per field wins. */
export function recFieldOf(header: unknown): RecField | null {
  const h = norm(header);
  if (!h) return null;
  if (h.includes("interview date") || h === "date") return "date";
  if (h === "company" || h === "company name" || h === "company / project") return "co";
  if (h.includes("country")) return "country";
  if (h.includes("work")) return "work";
  if (h.includes("detail")) return "details";
  if (h.includes("marketing plan") || h === "plan $" || h === "plan") return "mplan";
  if (h.includes("top") && h.includes("up")) return "topup";
  if (h === "status" || (h.includes("status") && !h.includes("top"))) return "status";
  if (h === "pc" || h.includes("passport")) return "pc";
  if (h.includes("cpp") || h.includes("conversion") || h.includes("ratio")) return null;
  if (h.includes("cost") && (h.includes("$") || h.includes("usd"))) return "usd";
  if (h.includes("cost") && (h.includes("bdt") || h.includes("৳"))) return "bdt";
  if (h.includes("lead")) return "leads";
  return null;
}

/** Find the header row (the first one that names the interview date) in the first rows. */
export function findHeaderRow(rows: unknown[][], probe = "interview date"): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if ((rows[i] ?? []).some((c) => norm(c).includes(probe))) return i;
  }
  return -1;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** The year that puts day+month closest to `ref`. */
function nearestYear(m: number, d: number, ref: Date) {
  const y = ref.getUTCFullYear();
  let best = y, bestDiff = Infinity;
  for (const cand of [y - 1, y, y + 1]) {
    const diff = Math.abs(Date.UTC(cand, m, d) - ref.getTime());
    if (diff < bestDiff) { best = cand; bestDiff = diff; }
  }
  return best;
}

/**
 * Sheet date -> "yyyy-mm-dd". Accepts ISO text (what the script sends for real dates),
 * "12-Oct-2026", "8 Oct", "18-Oct-2026". `ref` picks the year when the cell has none.
 */
export function parseSheetDate(v: unknown, ref: Date = new Date()): string | null {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\s\-/]+([A-Za-z]{3})[A-Za-z]*[\s\-/,]*(\d{4})?$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi < 0) return null;
    const d = +m[1];
    const y = m[3] ? +m[3] : nearestYear(mi, d, ref);
    return `${y}-${pad(mi + 1)}-${pad(d)}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // d/m/yyyy
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return null;
}

/** Log day tab name "17 Nov" -> "2026-11-17" (null for Status_Check, Report, ...). */
export function logTabDate(tab: string, ref: Date = new Date()): string | null {
  return /^\d{1,2} [A-Za-z]{3}$/.test(tab.trim()) ? parseSheetDate(tab.trim(), ref) : null;
}

/** "2026-11-17" -> "17 Nov", the sheet's tab name. */
export function logTabName(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${pad(d)} ${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)}`;
}

export const truthy = (v: unknown) => v === true || /^(true|yes|✓|✔|1)$/i.test(String(v ?? "").trim());
