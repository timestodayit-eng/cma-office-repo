// Digital Media Solution Log Sheet, rebuilt from the live sheet + Jamil's Apps Script.

export const LOG_STATUSES = [
  "Script Writing", "Script Ready", "Script Approved", "Shooting Pending", "Shooting Done",
  "Raw Uploaded", "On Edit", "Edit Submitted", "Revision Needed", "Approved", "For Upload",
  "Uploaded", "Hold", "Cancelled", "Scheduled", "In Ads", "Dropped", "Reserved",
] as const;

export const PRIORITIES = ["Urgent", "High", "Medium", "Low"] as const;
export const MAIN_CATEGORIES = [
  "Interview & Conversion", "Trust & Proof", "Information & Education", "Brand & Engagement",
] as const;
export const CONTENT_TYPES = [
  "Interview", "InVision", "Mojo", "Review", "Explainer", "Bio", "OOV", "Live",
  "Cut Video", "OVC", "Graphic", "Motion", "Voice Call",
] as const;

/** Status_Check leaves these out (the sheet's "Painding" filter). */
export const CLOSED_STATUSES = new Set(["Uploaded", "Cancelled", "In Ads", "Dropped", "Reserved"]);
/** Counted as finished work in reports. */
export const FINISHED_STATUSES = new Set(["Uploaded", "In Ads"]);

/** Row colour by status, as in the sheet. */
export const STATUS_COLOR: Record<string, string> = {
  Uploaded: "#d9ead3",
  Cancelled: "#d9ead3",
  Reserved: "#d9ead3",
  Dropped: "#cfe8e6",
  "Shooting Done": "#d6e4f5",
  "On Edit": "#fff2cc",
  "For Upload": "#e6dcf3",
};

/** Day tab name, e.g. "18 Nov" (Asia/Dhaka). */
export function dayTabName(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Dhaka" })
    .format(d);
}

export interface LogRowLike {
  date: string; // yyyy-mm-dd
  status?: string | null;
  company?: string | null;
  contentType?: string | null;
  scriptWriter?: string | null;
  videoEditor?: string | null;
  cinematographer?: string | null;
  presenter?: string | null;
  title?: string | null;
}

export function isPending(r: LogRowLike): boolean {
  return !!r.status && !CLOSED_STATUSES.has(r.status);
}

/** Status_Check: every open row in the last `days` day tabs, newest first. */
export function statusCheck<T extends LogRowLike>(rows: T[], today: string, days = 35): T[] {
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - days);
  const fromIso = from.toISOString().slice(0, 10);
  return rows
    .filter((r) => r.date >= fromIso && r.date <= today && isPending(r))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export interface CountTable {
  /** row label -> content type -> count */
  rows: Record<string, Record<string, number>>;
  totals: Record<string, number>;
  today: Record<string, number>;
  avg: Record<string, number>;
  rank: Record<string, number>;
}

/**
 * Report tab: counts per Content Type for each company / script writer / editor,
 * plus Today, Total, Avg (total / days) and rank (1st, 2nd...).
 */
export function countReport<T extends LogRowLike>(
  rows: T[],
  by: (r: T) => string | null | undefined,
  opts: { from: string; to: string; today: string; finishedOnly?: boolean },
): CountTable {
  const out: CountTable = { rows: {}, totals: {}, today: {}, avg: {}, rank: {} };
  const days = Math.max(
    1,
    Math.round((Date.parse(opts.to) - Date.parse(opts.from)) / 86_400_000) + 1,
  );
  for (const r of rows) {
    if (r.date < opts.from || r.date > opts.to) continue;
    if (!r.title) continue;
    if (opts.finishedOnly && !(r.status && FINISHED_STATUSES.has(r.status))) continue;
    const key = by(r)?.trim();
    if (!key) continue;
    const ct = r.contentType || "Other";
    out.rows[key] ??= {};
    out.rows[key][ct] = (out.rows[key][ct] ?? 0) + 1;
    out.totals[key] = (out.totals[key] ?? 0) + 1;
    if (r.date === opts.today) out.today[key] = (out.today[key] ?? 0) + 1;
  }
  const keys = Object.keys(out.totals).sort((a, b) => out.totals[b] - out.totals[a]);
  keys.forEach((k, i) => {
    out.avg[k] = Math.round((out.totals[k] / days) * 100) / 100;
    // equal totals share a rank
    out.rank[k] = i > 0 && out.totals[keys[i - 1]] === out.totals[k] ? out.rank[keys[i - 1]] : i + 1;
  });
  return out;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
