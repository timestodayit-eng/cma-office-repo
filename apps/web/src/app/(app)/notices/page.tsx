import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canSendNotice } from "@/lib/notices";
import { fmtTime } from "@/lib/format";
import { Flash } from "@/components/TaskCard";
import { sendNoticeAction, deleteNoticeAction } from "@/app/noticeActions";

export default async function Notices({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const admin = canSendNotice(u);
  const [people, companies, notices] = await Promise.all([
    admin ? prisma.user.findMany({ where: { active: true, id: { not: u.id } }, orderBy: { name: "asc" }, select: { id: true, name: true, department: true } }) : [],
    admin ? prisma.company.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }) : [],
    prisma.notice.findMany({
      where: admin ? {} : { reads: { some: { userId: u.id } } },
      orderBy: { createdAt: "desc" }, take: 60,
      include: { sender: { select: { name: true } }, reads: { include: { user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } } },
    }),
  ]);
  const depts = [...new Set(people.map((p) => p.department).filter(Boolean) as string[])].sort();

  return (
    <>
      <h1 className="h1">Notices</h1>
      <Flash sp={sp} />
      {admin && (
        <form action={sendNoticeAction} className="card">
          <b>Send a notice</b>
          <label className="field">Heading<input name="title" className="inp" maxLength={120} required /></label>
          <label className="field">Notice<textarea name="body" rows={4} maxLength={4000} required /></label>
          <div className="small muted">Who gets it</div>
          <div className="picks"><label><input type="checkbox" name="all" /> Everyone</label></div>
          {depts.length > 0 && <><div className="small muted">or a team</div><div className="picks">{depts.map((d) => <label key={d}><input type="checkbox" name="dept" value={d} /> {d}</label>)}</div></>}
          {companies.length > 0 && <><div className="small muted">or the people working for a company</div><div className="picks">{companies.map((c) => <label key={c.id}><input type="checkbox" name="company" value={c.id} /> {c.name}</label>)}</div></>}
          <details><summary className="small linkb">or choose people one by one</summary><div className="picks" style={{ marginTop: 8 }}>{people.map((p) => <label key={p.id}><input type="checkbox" name="user" value={p.id} /> {p.name}</label>)}</div></details>
          <p className="hint">It opens over the whole screen for each person, on the phone app and the website, and stays until they tick &quot;Yes, I have read this notice&quot;. Only the CEO and the admin can send.</p>
          <button className="btn primary" style={{ alignSelf: "flex-start" }}>Send notice</button>
        </form>
      )}
      {notices.length === 0 && <div className="empty"><b>No notices yet</b>{admin ? "Notices you send appear here with who has read them." : "Notices for you appear here."}</div>}
      {notices.map((n) => {
        const read = n.reads.filter((r) => r.readAt), not = n.reads.filter((r) => !r.readAt);
        const mine = n.reads.find((r) => r.userId === u.id);
        return (
          <div className="card" key={n.id}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <b style={{ overflowWrap: "anywhere" }}>{n.title}</b>
              {admin ? <span className={`pill ${not.length ? "p-amber" : "p-good"}`}>{read.length} of {n.reads.length} read</span> : mine?.readAt ? <span className="pill p-good">Read</span> : null}
            </div>
            <div className="small muted">{n.sender.name} · {fmtTime(n.createdAt)}{admin ? ` · to ${n.audience}` : ""}</div>
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 14 }}>{n.body}</div>
            {admin && (
              <details>
                <summary className="small linkb">Who has read it</summary>
                <div className="small" style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div><b>Not read yet ({not.length}):</b> {not.map((r) => r.user.name).join(", ") || "nobody"}</div>
                  <div><b>Read ({read.length}):</b> {read.map((r) => `${r.user.name} (${fmtTime(r.readAt!)})`).join(", ") || "nobody"}</div>
                </div>
                <form action={deleteNoticeAction} style={{ marginTop: 10 }}><input type="hidden" name="id" value={n.id} /><button className="btn sm">Remove this notice</button></form>
              </details>
            )}
          </div>
        );
      })}
    </>
  );
}
