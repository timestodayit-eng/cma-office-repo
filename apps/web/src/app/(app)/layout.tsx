import Link from "next/link";
import { LEVEL_LABEL, type Level } from "@cma/core";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { initials } from "@/lib/format";
import { SideNav, MobileNav, ThemeButton, type NavItem } from "@/components/Nav";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const [myTodo, openReq, unread] = await Promise.all([
    prisma.task.count({ where: { assigneeId: u.id, status: { in: ["TODO", "IN_PROGRESS"] } } }),
    prisma.request.count({ where: { toId: u.id, status: "OPEN" } }),
    prisma.notification.count({ where: { userId: u.id, readAt: null } }),
  ]);

  const items: NavItem[] = [
    { href: "/", label: "Home", icon: "🏠" },
    { href: "/tasks", label: "My Tasks", icon: "✅", count: myTodo },
    { href: "/requests", label: "Requests", icon: "💬", count: openReq },
  ];
  const mods: [Parameters<typeof u.can>[0], NavItem][] = [
    ["interviews", { href: "/interviews", label: "Interviews", icon: "📅" }],
    ["logsheet", { href: "/logsheet", label: "Log Sheet", icon: "📄" }],
    ["recruitment", { href: "/recruitment", label: "Recruitment", icon: "📊" }],
    ["broadcast", { href: "/broadcast", label: "Call & SMS Broadcast", icon: "📞" }],
    ["users", { href: "/users", label: "Users & Permissions", icon: "👥" }],
    ["settings", { href: "/settings", label: "Settings", icon: "⚙️" }],
  ];
  for (const [m, item] of mods) if (u.can(m)) items.push({ ...item, section: "Modules" });

  return (
    <div className="shell">
      <SideNav items={items} />
      <div className="main">
        <header className="top">
          <Link href="/profile" className="av" aria-label="Profile">{initials(u.name)}</Link>
          <div className="who"><b>{u.name}</b><span>{LEVEL_LABEL[u.level as Level]}{u.designation ? ` · ${u.designation}` : ""}</span></div>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <Link href="/notifications" className="iconbtn" aria-label="Notifications">🔔{unread > 0 && <span className="dot">{unread}</span>}</Link>
            <ThemeButton />
            <form action={logoutAction}><button className="iconbtn" aria-label="Log out" title="Log out">⎋</button></form>
          </span>
        </header>
        <main className="screen">{children}</main>
      </div>
      <MobileNav items={[
        { href: "/", label: "Home", icon: "🏠" },
        { href: "/tasks", label: "Tasks", icon: "✅" },
        { href: "/interviews", label: "Interviews", icon: "📅" },
        { href: "/requests", label: "Requests", icon: "💬" },
        { href: "/more", label: "More", icon: "▦" },
      ]} />
    </div>
  );
}
