// Interview-driven video chain. Every date is counted back from the interview.
// Example (defaults): interview 9 Dec -> ads 2 Dec, handover 1 Dec, shoot 28 Nov,
// writer notified 26 Nov.

export interface TimelineSettings {
  /** Ads start this many days before the interview. */
  adsDaysBefore: number;
  /** Writer is notified this many days before ads start. */
  writerDaysBeforeAds: number;
  /** Creative Lead hands over to marketing this many days before ads. */
  handoverDaysBeforeAds: number;
  /** Shoot happens this many days before handover. */
  shootDaysBeforeHandover: number;
}

export const DEFAULT_TIMELINE: TimelineSettings = {
  adsDaysBefore: 7,
  writerDaysBeforeAds: 6,
  handoverDaysBeforeAds: 1,
  shootDaysBeforeHandover: 3,
};

/** Who does a step. Company roles are resolved per company in Settings. */
export type StepRole =
  | "writer"
  | "creative_lead"
  | "content_director"
  | "cinematographer"
  | "editor" // pool: the company's editors, one claims it
  | "qc"
  | "model"
  | "ads";

export type StepKey =
  | "script"
  | "script_approve"
  | "shoot_slot"
  | "shoot"
  | "raw_upload"
  | "edit"
  | "qc"
  | "handover"
  | "publish"
  | "ads";

export interface StepDef {
  key: StepKey;
  title: string;
  role: StepRole;
  /** Link the person must paste before Done. */
  requiresLink?: "scriptLink" | "driveLink" | "videoLink" | "postLink";
  /** QC style step: pass or fail with a note; fail goes back to `failBackTo`. */
  review?: { failBackTo: StepKey };
  /** Pool step: shown to everyone holding the role for the company until one claims it. */
  pool?: boolean;
  /** Writer can say the video already exists; skips straight to this step. */
  alreadyDoneSkipsTo?: StepKey;
}

export const VIDEO_CHAIN: StepDef[] = [
  { key: "script", title: "Write script", role: "writer", requiresLink: "scriptLink", alreadyDoneSkipsTo: "handover" },
  { key: "script_approve", title: "Approve script", role: "creative_lead", review: { failBackTo: "script" } },
  { key: "shoot_slot", title: "Fix shoot slot with cinematographer", role: "content_director" },
  { key: "shoot", title: "Shoot and write shoot log", role: "cinematographer" },
  { key: "raw_upload", title: "Upload raw files to Google Drive", role: "cinematographer", requiresLink: "driveLink" },
  { key: "edit", title: "Edit video + thumbnail", role: "editor", requiresLink: "videoLink", pool: true },
  { key: "qc", title: "QC check", role: "qc", review: { failBackTo: "edit" } },
  { key: "handover", title: "Final approval + hand over to marketing", role: "creative_lead" },
  { key: "publish", title: "Publish on pages", role: "model", requiresLink: "postLink" },
  { key: "ads", title: "Run ads", role: "ads" },
];

/** Date-only helpers (UTC midnight, so no time zone drift). */
export function toDay(d: Date | string): Date {
  const x = typeof d === "string" ? new Date(d) : new Date(d.getTime());
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface PlannedStep extends StepDef {
  order: number;
  startDate: Date;
  dueDate: Date;
}

export interface TimelinePlan {
  interviewDate: Date;
  adsStart: Date;
  handover: Date;
  shoot: Date;
  writerStart: Date;
  steps: PlannedStep[];
}

export function planTimeline(
  interviewDate: Date | string,
  s: TimelineSettings = DEFAULT_TIMELINE,
): TimelinePlan {
  const interview = toDay(interviewDate);
  const adsStart = addDays(interview, -s.adsDaysBefore);
  const handover = addDays(adsStart, -s.handoverDaysBeforeAds);
  const shoot = addDays(handover, -s.shootDaysBeforeHandover);
  const writerStart = addDays(adsStart, -s.writerDaysBeforeAds);
  // Script must be approved the day before the shoot at the latest.
  const scriptDue = maxDate(writerStart, addDays(shoot, -1));
  const rawDue = addDays(shoot, 1) > handover ? shoot : addDays(shoot, 1);
  const editDue = maxDate(rawDue, addDays(handover, -1));

  const dates: Record<StepKey, [Date, Date]> = {
    script: [writerStart, scriptDue],
    script_approve: [writerStart, scriptDue],
    shoot_slot: [writerStart, addDays(shoot, -1) < writerStart ? writerStart : addDays(shoot, -1)],
    shoot: [shoot, shoot],
    raw_upload: [shoot, rawDue],
    edit: [rawDue, editDue],
    qc: [editDue, handover],
    handover: [handover, handover],
    publish: [adsStart, adsStart],
    ads: [adsStart, adsStart],
  };

  return {
    interviewDate: interview,
    adsStart,
    handover,
    shoot,
    writerStart,
    steps: VIDEO_CHAIN.map((def, i) => ({
      ...def,
      order: i + 1,
      startDate: dates[def.key][0],
      dueDate: dates[def.key][1],
    })),
  };
}

function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b;
}

export function stepIndex(key: StepKey): number {
  return VIDEO_CHAIN.findIndex((s) => s.key === key);
}

/** Broadcast call days for one interview: the 4 days before plus the interview day. */
export function broadcastDays(interviewDate: Date | string): { slot: string; date: Date }[] {
  const d = toDay(interviewDate);
  return [-4, -3, -2, -1, 0].map((off, i) => ({ slot: `V${i + 1}`, date: addDays(d, off) }));
}
