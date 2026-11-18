import Link from "next/link";
import { LEVEL_LABEL, ALL_RESPONSIBILITIES, type Level } from "@cma/core";

const RESP_LABEL: Record<string, string> = Object.fromEntries(ALL_RESPONSIBILITIES.map((r) => [r.key, r.label]));
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { initials, todayDhaka } from "@/lib/format";
import { clock } from "@/lib/attendance";
import { SideNav, MobileNav, ThemeButton, Icon, type NavItem } from "@/components/Nav";
import { myBroadcastCount } from "@/lib/broadcast";
import { unreadNotices } from "@/lib/notices";
import { NoticeGate } from "@/components/NoticeGate";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const [myTodo, openReq, unread] = await Promise.all([
    prisma.task.count({ where: { assigneeId: u.id, status: { in: ["TODO", "IN_PROGRESS"] } } }),
    prisma.request.count({ where: { toId: u.id, status: "OPEN" } }),
    prisma.notification.count({ where: { userId: u.id, readAt: null } }),
  ]);

  const notices = await unreadNotices(u.id);
  const [bcTodo, att] = await Promise.all([
    u.can("broadcast") ? myBroadcastCount(u.id) : 0,
    prisma.attendance.findUnique({ where: { userId_date: { userId: u.id, date: todayDhaka() } } }),
  ]);
  const items: NavItem[] = [
    { href: "/", label: "Home", icon: "home" },
    { href: "/tasks", label: "My Tasks", icon: "tasks", count: myTodo },
    { href: "/command", label: "Command", icon: "command" },
    { href: "/notices", label: "Notices", icon: "bell", count: notices.length },
    { href: "/profile", label: "Profile", icon: "profile" },
  ];
  const mods: [Parameters<typeof u.can>[0], NavItem][] = [
    ["logsheet", { href: "/logsheet", label: "Log Sheet", icon: "sheet" }],
    ["marketing", { href: "/marketing", label: "Marketing", icon: "marketing" }],
    ["broadcast", { href: "/broadcast", label: "Broadcast", icon: "broadcast", count: bcTodo }],
    ["recruitment", { href: "/recruitment", label: "Recruitment", icon: "recruit" }],
    ["users", { href: "/users", label: "Users & Permissions", icon: "users" }],
    ["requests", { href: "/requests", label: "Requests", icon: "requests", count: openReq }],
    ["settings", { href: "/settings", label: "Settings", icon: "settings" }],
    ["attendance", { href: "/attendance", label: "Attendance", icon: "attendance" }],
    ["payroll", { href: "/payroll", label: "Payroll", icon: "payroll" }],
    ["performance", { href: "/performance", label: "Performance", icon: "performance" }],
    ["monitor", { href: "/monitor", label: "Work Monitor", icon: "monitor" }],
  ];
  for (const [m, item] of mods) if (u.can(m)) items.push({ ...item, section: "Modules" });
  // Short header line: only the working roles, not every permission.
  const SHOW = ["ads", "broadcast_officer", "writer", "model", "editor", "qc", "creative_lead", "content_director", "cinematographer", "uploader"];
  const duties = SHOW.filter((k) => u.resp.has(k as never)).map((k) => RESP_LABEL[k]?.split(" (")[0].split(" / ")[0]).filter(Boolean).slice(0, 2);

  return (
    <div className="shell">
      <NoticeGate notices={notices} />
      <SideNav items={items} />
      <div className="main">
        <header className="top">
          <Link href="/profile" className="av" aria-label="Profile">{initials(u.name)}</Link>
          <div className="who"><b>{u.name}</b><span>{[LEVEL_LABEL[u.level as Level], ...(duties.length ? duties : [u.designation])].filter(Boolean).join(" · ")}</span></div>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {u.can("attendance") && !u.external && <Link href="/attendance" className="att"><span className="dot" style={att?.checkIn ? { background: att.late ? "var(--amber)" : "var(--good)" } : undefined} /><b>{att?.status === "LEAVE" ? "Leave" : att?.checkOut ? "Checked out" : att?.checkIn ? "Present" : "Not checked in"}</b>{att?.checkIn && <span>· {clock(att.checkIn)}</span>}<span>Attendance ›</span></Link>}
            <Link href="/notifications" className="iconbtn" aria-label="Notifications"><Icon name="bell" />{unread > 0 && <span className="dot">{unread}</span>}</Link>
            <ThemeButton />
            <form action={logoutAction}><button className="iconbtn" aria-label="Log out" title="Log out"><Icon name="logout" /></button></form>
          </span>
        </header>
        <main className="screen">{children}</main>
      </div>
      <MobileNav items={[
        { href: "/", label: "Home", icon: "home" },
        { href: "/tasks", label: "My Tasks", icon: "tasks" },
        { href: "/command", label: "Command", icon: "command" },
        { href: "/more", label: "Modules", icon: "modules" },
        { href: "/profile", label: "Profile", icon: "profile" },
      ]} />
    </div>
  );
}
