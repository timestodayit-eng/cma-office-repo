import Link from "next/link";
import { notFound } from "next/navigation";
import { VIDEO_CHAIN } from "@cma/core";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fmtDay, fmtTime, todayDhaka, dueLabel } from "@/lib/format";
import { Flash } from "@/components/TaskCard";
import {
  startTaskAction, completeTaskAction, failReviewAction, alreadyDoneAction,
  reassignAction, simpleTaskDoneAction, sendRequestAction,
} from "@/app/actions";

const LINK_LABEL: Record<string, string> = {
  scriptLink: "Script link (Google Doc)",
  driveLink: "Raw files Google Drive link",
  videoLink: "Edited video link",
  postLink: "Published post link",
};

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const today = todayDhaka();
  const t = await prisma.task.findUnique({
    where: { id },
    include: {
      company: true, assignee: true, checker: true, interview: { include: { company: true } },
      events: { include: { user: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!t) notFound();

  const chain = t.interviewId
    ? await prisma.task.findMany({ where: { interviewId: t.interviewId }, include: { assignee: true }, orderBy: { order: "asc" } })
    : [];
  const def = VIDEO_CHAIN.find((s) => s.key === t.stepKey);
  const next = chain.find((c) => c.order > t.order && c.status !== "SKIPPED");
  const raw = chain.find((c) => c.stepKey === "raw_upload");
  const cinematographer = raw?.assignee;
  const script = chain.find((c) => c.stepKey === "script");
  const edit = chain.find((c) => c.stepKey === "edit");

  const companyHolders = t.pool && t.role && t.companyId
    ? (await prisma.companyRole.findMany({ where: { companyId: t.companyId, role: t.role } })).map((r) => r.userId)
    : [];
  const isMine = t.assigneeId === u.id || (t.pool && !t.assigneeId && companyHolders.includes(u.id));
  const canManage = u.level === "SUPER_ADMIN" || u.has("assign");
  const canAct = isMine || canManage;
  const open = t.status === "TODO" || t.status === "IN_PROGRESS";
  const due = dueLabel(today, t.dueDate);
  const users = canManage || open ? await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [];

  return (
    <>
      {t.interview && <Link href={`/interviews/${t.interview.id}`} className="small">← {t.interview.title}</Link>}
      <h1 className="h1">{t.title}</h1>
      <div className="row small muted">
        {t.company && <span className="pill p-pri">{t.company.name}</span>}
        <span className={`pill ${open ? due.cls : "p-good"}`}>{open ? due.text || "No deadline" : t.status === "SKIPPED" ? "Skipped" : t.status === "WAITING" ? "Waiting for earlier step" : "Done"}</span>
        {t.assignee ? <span>Assigned to <b>{t.assignee.name}</b></span> : t.pool ? <span>Any of the company&apos;s editors can take it</span> : <span>Nobody assigned yet</span>}
        {t.checker && <span>· Checker: {t.checker.name}</span>}
      </div>
      <Flash sp={sp} />

      <div className="grid">
        <div className="card">
          {t.description && <p style={{ margin: 0 }}>{t.description}</p>}
          {t.handoverNote && <div className="rmsg"><b>Note from previous step:</b> {t.handoverNote}</div>}

          {t.stepKey === "edit" && (
            raw?.driveLink
              ? <a className="rawl" href={raw.driveLink} target="_blank" rel="noreferrer">📁 Raw files: {raw.driveLink}</a>
              : <div className="rawl" style={{ color: "var(--amber)", background: "var(--amber-soft)" }}>No raw file link yet. Contact: {cinematographer?.name ?? "the cinematographer"}</div>
          )}
          {["script_approve", "shoot_slot", "shoot"].includes(t.stepKey ?? "") && script?.scriptLink && (
            <a className="rawl" href={script.scriptLink} target="_blank" rel="noreferrer">📝 Script: {script.scriptLink}</a>
          )}
          {["qc", "handover", "publish", "ads"].includes(t.stepKey ?? "") && edit?.videoLink && (
            <a className="rawl" href={edit.videoLink} target="_blank" rel="noreferrer">🎬 Edited video: {edit.videoLink}</a>
          )}

          {open && canAct && (
            <>
              {t.status === "TODO" && (
                <form action={startTaskAction}><input type="hidden" name="id" value={t.id} />
                  <button className="btn primary">{t.pool && !t.assigneeId ? "✋ I'll do this" : "▶ Start"}</button>
                </form>
              )}
              <form className="stack" action={t.chain ? completeTaskAction : simpleTaskDoneAction}>
                <input type="hidden" name="id" value={t.id} />
                {def?.requiresLink && (
                  <label className="field">{LINK_LABEL[def.requiresLink]}
                    <input name="link" type="url" required placeholder="https://" defaultValue={(t as Record<string, unknown>)[def.requiresLink] as string ?? ""} />
                  </label>
                )}
                <label className="field">{def?.review ? "QC note" : "Note for the next person (optional)"}<textarea name="note" /></label>
                <div className="row">
                  <button className="btn good">✓ {def?.review ? "Passed" : "Done"}{next ? ` & hand to ${next.assignee?.shortName ?? (next.pool ? "editors" : "next step")}` : ""}</button>
                  {def?.review && <button className="btn bad" formAction={failReviewAction}>✗ Needs changes (send back)</button>}
                  {def?.alreadyDoneSkipsTo && <button className="btn" formAction={alreadyDoneAction} formNoValidate>Already done / in Log Sheet</button>}
                </div>
                {def?.review && <p className="hint">Needs changes sends it back to {def.review.failBackTo === "edit" ? "the editor" : "the writer"} with your note.</p>}
              </form>
            </>
          )}
          {open && !canAct && <p className="hint">This task belongs to {t.assignee?.name ?? "someone else"}. You can send them a request below.</p>}
        </div>

        {chain.length > 0 && (
          <div className="card">
            <b>Timeline</b>
            <ol className="steps">
              {chain.map((c) => (
                <li key={c.id} className={c.status === "DONE" ? "done" : c.status === "SKIPPED" ? "done skip" : c.status === "TODO" || c.status === "IN_PROGRESS" ? "cur" : ""}>
                  <span className="n">{c.order}</span>
                  <span>
                    <Link href={`/tasks/${c.id}`} style={{ color: "var(--ink)", fontWeight: c.id === t.id ? 700 : 500 }}>{c.title}</Link>
                    <div className="sub">{c.assignee?.name ?? (c.pool ? "Editors pick" : "—")}{c.doneAt ? ` · done ${fmtTime(c.doneAt)}` : ""}</div>
                  </span>
                  <span className="small muted">{fmtDay(c.dueDate)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <div className="grid">
        <form className="card stack" action={sendRequestAction}>
          <b>Send a request</b>
          <input type="hidden" name="taskId" value={t.id} />
          <input type="hidden" name="return" value={`/tasks/${t.id}`} />
          <div className="two">
            <label className="field">To
              <select name="toId" required defaultValue={t.stepKey === "edit" ? cinematographer?.id : ""}>
                <option value="">Pick a person</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="field">Type
              <select name="type" defaultValue={t.stepKey === "edit" && !raw?.driveLink ? "RAW_FILE" : "REVIEW"}>
                <option value="REVIEW">Review</option><option value="QC">QC</option><option value="MODIFY">Modify</option>
                <option value="APPROVAL">Approval</option><option value="RAW_FILE">Raw files</option><option value="CUSTOM">Message</option>
              </select>
            </label>
          </div>
          <label className="field">Message<textarea name="message" required /></label>
          <button className="btn">Send</button>
        </form>

        {canManage && open && (
          <form className="card stack" action={reassignAction}>
            <b>Give this task to someone else</b>
            <input type="hidden" name="id" value={t.id} />
            <label className="field">Person
              <select name="to" required><option value="">Pick a person</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            </label>
            <label className="field">Note<input name="note" /></label>
            <button className="btn">Reassign</button>
          </form>
        )}

        <div className="card">
          <b>History</b>
          {t.events.map((e) => (
            <div key={e.id} className="small"><span className="muted">{fmtTime(e.createdAt)}</span> · {e.user?.name ?? "System"} · {e.type.replace("_", " ")}{e.note ? `: ${e.note}` : ""}</div>
          ))}
        </div>
      </div>
    </>
  );
}
