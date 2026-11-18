import Link from "next/link";
import { requireUser } from "@/lib/auth";

export default async function More() {
  const u = await requireUser();
  const items: [Parameters<typeof u.can>[0] | null, string, string, string][] = [
    [null, "/notifications", "🔔", "Notifications"],
    [null, "/profile", "👤", "Profile"],
    ["logsheet", "/logsheet", "📄", "Log Sheet"],
    ["recruitment", "/recruitment", "📊", "Recruitment"],
    ["broadcast", "/broadcast", "📞", "Call & SMS Broadcast"],
    ["users", "/users", "👥", "Users & Permissions"],
    ["settings", "/settings", "⚙️", "Settings"],
  ];
  return (
    <>
      <h1 className="h1">More</h1>
      <div className="list">
        {items.filter(([m]) => !m || u.can(m)).map(([, href, ic, label]) => (
          <Link key={href} href={href} className="li"><span aria-hidden>{ic}</span><span className="grow"><b>{label}</b></span><span className="muted">›</span></Link>
        ))}
      </div>
    </>
  );
}
