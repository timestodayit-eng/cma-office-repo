import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fmtTime } from "@/lib/format";
import { Flash } from "@/components/TaskCard";
import { answerRequestAction, sendRequestAction } from "@/app/actions";

const QUICK: Record<string, string[]> = {
  REVIEW: ["Looks good", "Please change a few things"],
  QC: ["QC passed", "QC failed, see note"],
  MODIFY: ["Will do today", "Done"],
  APPROVAL: ["Approved", "Not approved"],
  RAW_FILE: ["Today", "Tomorrow", "Collect from me"],
  CUSTOM: ["OK", "Will check"],
};

export default async function Requests({ searchParams }: { searchParams: Promise<{ tab?: string; e?: string; ok?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab ?? "for";
  const where = tab === "sent" ? { fromId: u.id } : tab === "answered" ? { toId: u.id, status: "ANSWERED" } : { toId: u.id, status: "OPEN" };
  const [list, users] = await Promise.all([
    prisma.request.findMany({ where, include: { from: true, to: true, task: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.user.findMany({ where: { active: true, id: { not: u.id } }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <h1 className="h1">Requests</h1>
      <p className="hint">Anyone can send anyone a request: review, QC, modify, approval, raw files or a message.</p>
      <Flash sp={sp} />
      <nav className="seg">
        <Link href="/requests" aria-current={tab === "for" ? "page" : undefined}>For me</Link>
        <Link href="/requests?tab=sent" aria-current={tab === "sent" ? "page" : undefined}>Sent by me</Link>
        <Link href="/requests?tab=answered" aria-current={tab === "answered" ? "page" : undefined}>Answered</Link>
      </nav>
      <div className="grid">
        {list.length === 0 && <div className="empty">No requests here.</div>}
        {list.map((r) => (
          <div key={r.id} className="card">
            <div className="row small muted" style={{ justifyContent: "space-between" }}>
              <span><b style={{ color: "var(--ink)" }}>{tab === "sent" ? `To ${r.to.name}` : r.from.name}</b> · {r.type.replace("_", " ").toLowerCase()}</span>
              <span>{fmtTime(r.createdAt)}</span>
            </div>
            {r.task && <Link href={`/tasks/${r.task.id}`} className="small">Task: {r.task.title}</Link>}
            <div className="rmsg">{r.message}</div>
            {r.answer && <div className="rmsg" style={{ background: "var(--pri-soft)" }}><b>Answer:</b> {r.answer}</div>}
            {r.status === "OPEN" && r.toId === u.id && (
              <form className="stack" action={answerRequestAction}>
                <input type="hidden" name="id" value={r.id} />
                <div className="row">
                  {QUICK[r.type].map((q) => <button key={q} className="btn sm" name="answer" value={q}>{q}</button>)}
                </div>
                <div className="row">
                  <input className="inp" style={{ flex: 1 }} name="answer" placeholder={r.type === "RAW_FILE" ? "Paste the Drive link or write a reply" : "Write a reply"} />
                  <button className="btn primary sm">Send</button>
                </div>
              </form>
            )}
            {r.status === "OPEN" && r.fromId === u.id && <span className="pill p-amber">Waiting for answer</span>}
          </div>
        ))}
      </div>
      <form className="card stack" action={sendRequestAction} style={{ maxWidth: 560 }}>
        <b>Send a new request</b>
        <div className="two">
          <label className="field">To
            <select name="toId" required><option value="">Pick a person</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
          <label className="field">Type
            <select name="type"><option value="REVIEW">Review</option><option value="QC">QC</option><option value="MODIFY">Modify</option><option value="APPROVAL">Approval</option><option value="RAW_FILE">Raw files</option><option value="CUSTOM">Message</option></select>
          </label>
        </div>
        <label className="field">Message<textarea name="message" required /></label>
        <button className="btn primary">Send</button>
      </form>
    </>
  );
}
