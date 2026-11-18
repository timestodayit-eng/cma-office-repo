// Levels, modules and responsibilities: the single list used by every app.
// Matches the approved prototype's Users & Permissions screen.

export const LEVELS = ["SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABEL: Record<Level, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  STAFF: "Staff",
};

export const MODULES = [
  { key: "tasks", label: "Tasks" },
  { key: "interviews", label: "Interviews & timeline" },
  { key: "requests", label: "Requests" },
  { key: "logsheet", label: "Log Sheet" },
  { key: "recruitment", label: "Recruitment Command Center" },
  { key: "broadcast", label: "Call & SMS Broadcast" },
  { key: "marketing", label: "Marketing" },
  { key: "ai", label: "AI Command Center" },
  { key: "attendance", label: "Attendance" },
  { key: "payroll", label: "Payroll" },
  { key: "performance", label: "Performance" },
  { key: "monitor", label: "Work Monitor" },
  { key: "users", label: "Users & Permissions" },
  { key: "settings", label: "Settings" },
] as const;
export type ModuleKey = (typeof MODULES)[number]["key"];

export const ACCESS = ["OFF", "VIEW", "EDIT"] as const;
export type Access = (typeof ACCESS)[number];

/** Every responsibility in the system, grouped as in the prototype. */
export const RESPONSIBILITY_GROUPS = [
  {
    group: "Content",
    items: [
      { key: "writer", label: "Content writer / artist", perCompany: true },
      { key: "model", label: "Model / brand promoter (on camera, publishes)", perCompany: true },
      { key: "creative_lead", label: "Creative Lead (script approval, handover)" },
      { key: "content_director", label: "Content Director (shoot slot)" },
      { key: "cinematographer", label: "Cinematographer (shoot, raw upload)" },
      { key: "editor", label: "Video editor (video + thumbnail)", perCompany: true },
      { key: "qc", label: "QC person", perCompany: true },
      { key: "voice_artist", label: "Voice artist (InVision)" },
      { key: "designer", label: "Designer (graphics, motion, carousel)" },
      { key: "uploader", label: "Uploader", perCompany: true, perContentType: true },
    ],
  },
  {
    group: "Marketing",
    items: [
      { key: "ads", label: "Ads runner", perCompany: true },
      { key: "marketing_report", label: "Marketing report" },
    ],
  },
  {
    group: "Broadcast",
    items: [
      { key: "broadcast_officer", label: "Broadcast officer", perCompany: true },
      { key: "dispatch", label: "Dispatch log" },
    ],
  },
  {
    group: "Recruitment & Finance",
    items: [
      { key: "recruitment", label: "Recruitment data" },
      { key: "finance", label: "Finance" },
    ],
  },
  {
    group: "Management",
    items: [
      { key: "command", label: "Give AI commands" },
      { key: "assign", label: "Assign tasks manually / add JD duties" },
      { key: "attendance", label: "Attendance admin" },
      { key: "payroll", label: "Payroll admin" },
    ],
  },
] as const;

export type ResponsibilityKey =
  (typeof RESPONSIBILITY_GROUPS)[number]["items"][number]["key"];

export const ALL_RESPONSIBILITIES = RESPONSIBILITY_GROUPS.flatMap((g) =>
  g.items.map((i) => ({ ...i, group: g.group })),
);

/** Default module access for a new user by level. Admin can change every cell. */
export function defaultModuleAccess(level: Level): Record<ModuleKey, Access> {
  const all = (a: Access) =>
    Object.fromEntries(MODULES.map((m) => [m.key, a])) as Record<ModuleKey, Access>;
  if (level === "SUPER_ADMIN") return all("EDIT");
  if (level === "ADMIN") return { ...all("EDIT"), monitor: "OFF", payroll: "OFF" };
  const base = all("OFF");
  base.tasks = "EDIT";
  base.requests = "EDIT";
  base.logsheet = "EDIT";
  base.ai = "VIEW";
  base.attendance = "EDIT";
  base.payroll = "VIEW"; // own payslip only
  base.performance = "VIEW"; // own score only
  if (level === "MANAGER") {
    base.interviews = "EDIT";
    base.marketing = "VIEW";
  } else {
    base.interviews = "VIEW";
  }
  return base;
}

export function canAccess(
  level: Level,
  perms: Partial<Record<string, Access>>,
  module: ModuleKey,
  need: "VIEW" | "EDIT" = "VIEW",
): boolean {
  if (level === "SUPER_ADMIN") return true;
  const a = perms[module] ?? "OFF";
  if (need === "VIEW") return a === "VIEW" || a === "EDIT";
  return a === "EDIT";
}
