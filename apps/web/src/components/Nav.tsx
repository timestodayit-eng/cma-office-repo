"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string; count?: number; section?: string };

function active(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  let lastSection: string | undefined;
  return (
    <nav className="side" aria-label="Main">
      <div className="brand"><b>CMA Office</b><span>Creative · Coastal · SM</span></div>
      {items.map((i) => {
        const head = i.section && i.section !== lastSection ? <div className="navsec" key={"s" + i.section}>{i.section}</div> : null;
        lastSection = i.section ?? lastSection;
        return [
          head,
          <Link key={i.href} href={i.href} className="navlink" aria-current={active(path, i.href) ? "page" : undefined}>
            <span aria-hidden>{i.icon}</span>{i.label}
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
        <Link key={i.href} href={i.href} aria-current={active(path, i.href) ? "page" : undefined}>
          <span className="ic" aria-hidden>{i.icon}</span>{i.label}
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
    >🌙</button>
  );
}
