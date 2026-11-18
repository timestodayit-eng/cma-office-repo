import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Icon, type NavItem } from "@/components/Nav";

const MODS: [Parameters<Awaited<ReturnType<typeof requireUser>>["can"]>[0] | null, string, NavItem["icon"], string, string][] = [
  [null, "/notices", "bell", "Notices", "#c0507a"],
  ["tasks", "/tasks", "tasks", "Tasks", "#4a74b0"],
  ["ai", "/command", "command", "Command Center", "#7363b3"],
  ["logsheet", "/logsheet", "sheet", "Log Sheet", "#3f9a83"],
  ["marketing", "/marketing", "marketing", "Marketing", "#c0507a"],
  ["broadcast", "/broadcast", "broadcast", "Broadcast", "#b7792a"],
  ["recruitment", "/recruitment", "recruit", "Recruitment", "#5b7fc4"],
  ["users", "/users", "users", "Users & Permissions", "#24344a"],
  ["requests", "/requests", "requests", "Requests", "#2f8f9d"],
  ["settings", "/settings", "settings", "Settings", "#52708f"],
  ["attendance", "/attendance", "attendance", "Attendance", "#3a8a63"],
  ["payroll", "/payroll", "payroll", "Payroll", "#8a6a2f"],
  ["performance", "/performance", "performance", "Performance", "#7363b3"],
  ["monitor", "/monitor", "monitor", "Work Monitor", "#a0522d"],
  [null, "/notifications", "bell", "Notifications", "#4a74b0"],
];

export default async function Modules() {
  const u = await requireUser();
  return (
    <>
      <h1 className="h1">Modules</h1>
      <div className="mods">
        {MODS.filter(([m]) => !m || u.can(m)).map(([, href, ic, label, color]) => (
          <Link key={href} href={href} className="mod">
            <span className="ic" style={{ background: `${color}1f`, color }}><Icon name={ic} /></span><b>{label}</b>
          </Link>
        ))}
      </div>
    </>
  );
}
