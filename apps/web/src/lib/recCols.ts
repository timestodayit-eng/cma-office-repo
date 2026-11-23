// The agency tabs of the Recruitment sheet ("Interview List"): which column is which,
// with the header colours, widths, dropdowns and row colours the Google Sheet uses.
// Columns are found by their header text, so the grid follows the sheet if a column moves.

export type Cell = string | number | boolean | null;
export type RecKind = "agency" | "text" | "date" | "day" | "check" | "money" | "list" | "finance";
export type RecColDef = { i: number; label: string; kind: RecKind; width: number; head: string; list?: readonly string[]; edit: boolean };

// Exactly as the sheet's dropdowns have them (two values end with a space there).
export const REC_STATUS = ["Video Done", "Ads Running", "Interview Done", "Waiting ", "Done", "Scripted", "Planned", "Content Ready", "On Hold", "Cancelled"] as const;
export const REC_TOPUP = ["Done", "Request sent", "Need ", "Spended", "Scripted", "Spend", "Not Required", "Required", "Requested", "Completed"] as const;

/** Per agency tab: header colour, light cell colour of A-E, and the "next 7 days" row colour. */
export const REC_TAB_STYLE: Record<string, { head: string; light: string; soon: string; short: string }> = {
  "Creative International": { head: "#9B2D42", light: "#FBF1F3", soon: "#D7F3EA", short: "CI" },
  "Coastal Manpower": { head: "#116D7A", light: "#EDF7F7", soon: "#DBEBFF", short: "CM" },
  "SM Enterprise": { head: "#1C4C8C", light: "#EFF4FB", soon: "#EEE5FF", short: "SM" },
};
export const REC_TABS = Object.keys(REC_TAB_STYLE);
export const REC_PAST = "#F1F4F7"; // rows before today or after the next 7 days
export const REC_DUP = "#FFDBD3"; // company name that appears more than once across the three tabs
const FIN_BG = "#FBF8EF", STATUS_BG = "#EFF6F9";

/** The header row the sheet has today, used until the sheet sends its own. */
export const REC_DEFAULT_HEADER = [
  " ", "Company Name", "Country", "Interview Date", "Day", "Start Date / notes", "Work Type", "Details", "CD", "Call Plan",
  "Marketing Plan $", "Status", "TopUp Required", "PC", "Total Cost $", "Total Cost BDT", "CPP BDT", "Total Leads", "Conversion Ratio",
];

const norm = (h: unknown) => String(h ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** One header cell -> how the column behaves. Finance columns are never written by the app. */
function kindOf(h: string, i: number): [RecKind, number] {
  if (i === 0) return ["agency", 150];
  if (h === "company name") return ["text", 190];
  if (h.includes("country")) return ["text", 130];
  if (h.includes("interview date")) return ["date", 104];
  if (h === "day") return ["day", 150];
  if (h.includes("start date")) return ["text", 150];
  if (h.includes("work type")) return ["text", 120];
  if (h.includes("detail")) return ["text", 300];
  if (h === "cd") return ["check", 44];
  if (h.includes("call plan")) return ["text", 130];
  if (h.includes("marketing plan")) return ["money", 120];
  if (h.includes("top") && h.includes("up")) return ["list", 130];
  if (h === "status") return ["list", 130];
  if (h === "pc" || h.includes("cost") || h.includes("cpp") || h.includes("lead") || h.includes("conversion")) return ["finance", h === "pc" ? 60 : 110];
  return ["text", h === "note" ? 190 : 120];
}

/** Columns to show for a tab: every header cell up to the last named one. */
export function recCols(tab: string, header: Cell[], opts: { money: boolean }): RecColDef[] {
  const st = REC_TAB_STYLE[tab] ?? REC_TAB_STYLE["Creative International"];
  let last = header.length - 1;
  while (last > 0 && !norm(header[last])) last--;
  const out: RecColDef[] = [];
  for (let i = 0; i <= last; i++) {
    const h = norm(header[i]);
    if (!h && i > 0) continue;
    const [kind, width] = kindOf(h, i);
    if (kind === "finance" && !opts.money) continue;
    const head = h === "cd" ? "#518C5E" : kind === "finance" ? "#192D49" : kind === "money" || kind === "list" ? "#307A7F" : st.head;
    out.push({
      i, label: String(header[i] ?? "").trim(), kind, width, head,
      list: h === "status" ? REC_STATUS : kind === "list" ? REC_TOPUP : undefined,
      edit: kind !== "finance" && kind !== "day",
    });
  }
  return out;
}

/** Which header index holds company name and interview date (for row checks and colours). */
export function recKeyCols(header: Cell[]) {
  const h = header.map(norm);
  const co = h.indexOf("company name");
  const date = h.findIndex((x) => x.includes("interview date"));
  return { co: co < 0 ? 1 : co, date: date < 0 ? 3 : date };
}

const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_BN = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"];
/** "2026-12-13" -> "Sunday/রবিবার", the way the sheet writes the Day column. */
export function dayLabel(iso: string) {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  return `${DAYS_EN[d.getUTCDay()]}/${DAYS_BN[d.getUTCDay()]}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const isIsoDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Cell text as the sheet shows it: dates as 13-Dec-2026, ratios with 2 decimals. */
export function showCell(v: Cell, col: RecColDef): string {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (col.kind === "date" && isIsoDate(v)) {
    const [y, m, d] = (v as string).split("-").map(Number);
    return `${d}-${MON[m - 1]}-${y}`;
  }
  if (typeof v === "number") {
    const l = norm(col.label);
    if (l.includes("conversion") || l.includes("cpp")) return v.toFixed(2);
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  return String(v);
}

/** Background of one cell, following the sheet's fills and conditional colours. */
export function cellBg(tab: string, col: RecColDef, rowDate: string | null, today: string, soonEnd: string, dup: boolean): string | undefined {
  const st = REC_TAB_STYLE[tab] ?? REC_TAB_STYLE["Creative International"];
  if (dup && norm(col.label) === "company name") return REC_DUP;
  if (rowDate) return rowDate >= today && rowDate <= soonEnd ? st.soon : REC_PAST;
  if (col.i <= 4) return st.light;
  if (col.kind === "finance") return FIN_BG;
  if (norm(col.label) === "status") return STATUS_BG;
  return undefined;
}
