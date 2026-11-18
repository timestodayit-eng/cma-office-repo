"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; count?: number; section?: string };

/** Same line icons as the approved design. */
export const ICONS = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  tasks: <><path d="M9 11l2 2 4-4" /><rect x="4" y="4" width="16" height="16" rx="4" /></>,
  command: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  modules: <><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></>,
  sheet: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></>,
  marketing: <><path d="M4 10v4l12 5V5L4 10z" /><path d="M16 9a3 3 0 0 1 0 6" /></>,
  broadcast: <><path d="M5 12a7 7 0 0 1 14 0M8 12a4 4 0 0 1 8 0" /><circle cx="12" cy="12" r="1" /><path d="M12 13v7" /></>,
  recruit: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11h5M19.5 8.5v5" /></>,
  requests: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
  attendance: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  payroll: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>,
  performance: <path d="M4 18l5-6 4 3 7-9" />,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  logout: <path d="M9 4H5v16h4M14 8l4 4-4 4M18 12H9" />,
};

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return <svg viewBox="0 0 24 24" aria-hidden className="ico">{ICONS[name]}</svg>;
}

function active(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  let lastSection: string | undefined;
  return (
    <nav className="side" aria-label="Main">
      <div className="brand"><b>CMS Team</b><span>Creative · Coastal · SM</span></div>
      {items.map((i) => {
        const head = i.section && i.section !== lastSection ? <div className="navsec" key={"s" + i.section}>{i.section}</div> : null;
        lastSection = i.section ?? lastSection;
        return [
          head,
          <Link key={i.href} href={i.href} className="navlink" aria-current={active(path, i.href) ? "page" : undefined}>
            <Icon name={i.icon} />{i.label}
            {!!i.count && <span className="cnt">{i.count}</span>}
          </Link>,
        ];
      })}
    </nav>
  );
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="mnav" aria-label="Main">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={i.icon === "command" ? "fab" : undefined} aria-current={active(path, i.href) ? "page" : undefined}>
          <span className="c"><Icon name={i.icon} /></span>{i.label}
        </Link>
      ))}
    </nav>
  );
}

export function ThemeButton() {
  return (
    <button
      className="iconbtn"
      aria-label="Switch theme"
      title="Light / dark"
      onClick={() => {
        const el = document.documentElement;
        const dark = el.dataset.theme === "dark" || (!el.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
        el.dataset.theme = dark ? "light" : "dark";
        try { localStorage.setItem("theme", el.dataset.theme); } catch {}
      }}
    ><Icon name="moon" /></button>
  );
}
