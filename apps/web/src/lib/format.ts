const TZ = "Asia/Dhaka";

export function fmtDay(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(d));
}
export function fmtTime(d: Date | string | null | undefined) {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: TZ }).format(new Date(d));
}
/** Today in Dhaka as a UTC-midnight date (matches @db.Date columns). */
export function todayDhaka(): Date {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  return new Date(s + "T00:00:00Z");
}
export function daysFrom(today: Date, d: Date | string | null | undefined) {
  if (!d) return null;
  return Math.round((new Date(d).getTime() - today.getTime()) / 86_400_000);
}
export function dueLabel(today: Date, d: Date | string | null | undefined) {
  const n = daysFrom(today, d);
  if (n === null) return { text: "", cls: "p-grey" };
  if (n < 0) return { text: `${-n} day${n === -1 ? "" : "s"} late`, cls: "p-bad" };
  if (n === 0) return { text: "Due today", cls: "p-amber" };
  if (n === 1) return { text: "Due tomorrow", cls: "p-amber" };
  return { text: `Due ${fmtDay(d)}`, cls: "p-grey" };
}
export function initials(name: string) {
  return name.split(/\s+/).filter((w) => !/^(md|mr)$/i.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
