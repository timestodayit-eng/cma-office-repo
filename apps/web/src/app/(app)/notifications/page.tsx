import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fmtTime } from "@/lib/format";
import { markAllReadAction } from "@/app/actions";

export default async function Notifications() {
  const u = await requireUser();
  const list = await prisma.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 className="h1">Notifications</h1>
        <form action={markAllReadAction}><button className="btn sm">Mark all read</button></form>
      </div>
      {list.length === 0 ? <div className="empty">No notifications yet.</div> : (
        <div className="list">
          {list.map((n) => (
            <Link key={n.id} href={n.link ?? "#"} className={`li${n.readAt ? "" : " unread"}`}>
              <span className="grow"><b>{n.title}</b>{n.body && <span>{n.body}</span>}</span>
              <span className="small muted" style={{ textAlign: "right" }}>{fmtTime(n.createdAt)}{n.whatsapp && <><br />WhatsApp: {n.whatsapp}</>}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
