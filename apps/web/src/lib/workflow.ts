// Interview -> automatic video chain. Start, Done & hand over, claim, QC pass/fail,
// "Already done". Every change writes a TaskEvent, notifies the next person and keeps
// the Log Sheet backup row in step.
import { Prisma, type Task } from "@prisma/client";
import {
  VIDEO_CHAIN,
  planTimeline,
  broadcastDays,
  DEFAULT_TIMELINE,
  stepIndex,
  type StepKey,
  type TimelineSettings,
} from "@cma/core";
import { prisma } from "./db";
import { notify } from "./notify";

type Tx = Prisma.TransactionClient;

export class WorkflowError extends Error {}

/** Log Sheet status shown while a step is open. */
const LOG_STATUS: Record<StepKey, string> = {
  script: "Script Writing",
  script_approve: "Script Ready",
  shoot_slot: "Script Approved",
  shoot: "Shooting Pending",
  raw_upload: "Shooting Done",
  edit: "Raw Uploaded",
  qc: "Edit Submitted",
  handover: "Approved",
  publish: "For Upload",
  ads: "Uploaded",
};

export async function getTimelineSettings(db: Tx | typeof prisma = prisma): Promise<TimelineSettings> {
  const s = await db.setting.findUnique({ where: { key: "timeline" } });
  return { ...DEFAULT_TIMELINE, ...((s?.value as object) ?? {}) };
}

/** Role holders: company-specific first, then global. */
async function roleHolders(db: Tx, role: string, companyId: string) {
  const rows = await db.companyRole.findMany({
    where: { role, OR: [{ companyId }, { companyId: null }] },
    orderBy: { companyId: { sort: "desc", nulls: "last" } },
  });
  const company = rows.filter((r) => r.companyId === companyId);
  return (company.length ? company : rows).map((r) => r.userId);
}

export async function createInterview(input: {
  companyId: string;
  country: string;
  interviewDate: string; // yyyy-mm-dd
  title?: string;
  marketingPlanUsd?: number | null;
  notes?: string | null;
  createdById: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const settings = await getTimelineSettings(tx);
    const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId } });
    const plan = planTimeline(input.interviewDate, settings);
    const interview = await tx.interview.create({
      data: {
        companyId: input.companyId,
        country: input.country,
        interviewDate: plan.interviewDate,
        title: input.title || `${company.name} · ${input.country}`,
        marketingPlanUsd: input.marketingPlanUsd ?? undefined,
        notes: input.notes ?? undefined,
        createdById: input.createdById,
      },
    });

    let firstAssignee: string | null = null;
    for (const step of plan.steps) {
      const holders = await roleHolders(tx, step.role, input.companyId);
      const assigneeId = step.pool ? null : holders[0] ?? null;
      if (step.order === 1) firstAssignee = assigneeId;
      await tx.task.create({
        data: {
          interviewId: interview.id,
          companyId: input.companyId,
          chain: "video",
          stepKey: step.key,
          order: step.order,
          title: step.title,
          role: step.role,
          pool: !!step.pool,
          assigneeId,
          status: step.order === 1 ? "TODO" : "WAITING",
          startDate: step.startDate,
          dueDate: step.dueDate,
          events: { create: { type: "created", userId: input.createdById } },
        },
      });
    }

    for (const b of broadcastDays(plan.interviewDate)) {
      await tx.broadcastSlot.create({ data: { interviewId: interview.id, slot: b.slot, callDate: b.date } });
    }

    // Log Sheet backup row, on the day tab the work starts.
    await tx.logRow.create({
      data: {
        date: plan.writerStart,
        title: `${company.short} ${input.country} interview ${plan.interviewDate.toISOString().slice(0, 10)}`,
        company: company.name,
        mainCategory: "Interview & Conversion",
        contentType: "Interview",
        priority: "High",
        deadline: plan.handover.toISOString().slice(0, 10),
        status: LOG_STATUS.script,
        taskId: interview.id,
      },
    });

    return { interview, firstAssignee, plan };
  });

  await notify([result.firstAssignee], {
    kind: "task",
    title: `New interview video: ${result.interview.title}`,
    body: `Script due ${result.plan.steps[0].dueDate.toISOString().slice(0, 10)}. If the video already exists, tap "Already done".`,
    link: `/interviews/${result.interview.id}`,
  });
  return result.interview;
}

type Actor = { id: string; level: string; has: (r: string) => boolean };

async function loadTask(tx: Tx, id: string) {
  const t = await tx.task.findUnique({ where: { id }, include: { interview: true } });
  if (!t) throw new WorkflowError("Task not found");
  return t;
}

async function canAct(tx: Tx, t: Task, actor: Actor) {
  if (actor.level === "SUPER_ADMIN" || actor.has("assign")) return true;
  if (t.assigneeId === actor.id) return true;
  if (t.pool && !t.assigneeId && t.role && t.companyId) {
    const holders = await roleHolders(tx, t.role, t.companyId);
    return holders.includes(actor.id);
  }
  return false;
}

async function logEvent(tx: Tx, taskId: string, userId: string, type: string, note?: string | null) {
  await tx.taskEvent.create({ data: { taskId, userId, type, note: note || null } });
}

async function syncLogRow(tx: Tx, interviewId: string | null, status: string, patch: Prisma.LogRowUpdateManyMutationInput = {}) {
  if (!interviewId) return;
  await tx.logRow.updateMany({ where: { taskId: interviewId }, data: { status, ...patch } });
}

export async function startTask(taskId: string, actor: Actor) {
  const t = await prisma.$transaction(async (tx) => {
    const t = await loadTask(tx, taskId);
    if (t.status !== "TODO") throw new WorkflowError("This task is not ready to start");
    if (!(await canAct(tx, t, actor))) throw new WorkflowError("This task is not yours");
    const assigneeId = t.assigneeId ?? actor.id; // claiming a pool step
    await tx.task.update({ where: { id: t.id }, data: { status: "IN_PROGRESS", startedAt: new Date(), assigneeId } });
    await logEvent(tx, t.id, actor.id, t.pool && !t.assigneeId ? "claimed" : "started");
    if (t.stepKey === "edit") {
      const editor = await tx.user.findUnique({ where: { id: assigneeId } });
      await syncLogRow(tx, t.interviewId, "On Edit", { videoEditor: editor?.shortName ?? editor?.name });
    }
    return t;
  });
  return t;
}

/** Mark done and open the next step. Links are saved on the task. */
export async function completeTask(
  taskId: string,
  actor: Actor,
  input: { link?: string | null; note?: string | null } = {},
) {
  const next = await prisma.$transaction(async (tx) => {
    const t = await loadTask(tx, taskId);
    if (!["TODO", "IN_PROGRESS"].includes(t.status)) throw new WorkflowError("This task is already closed");
    if (!(await canAct(tx, t, actor))) throw new WorkflowError("This task is not yours");
    const def = VIDEO_CHAIN.find((s) => s.key === t.stepKey);
    const data: Prisma.TaskUpdateInput = {
      status: "DONE",
      doneAt: new Date(),
      handoverNote: input.note || null,
      assignee: t.assigneeId ? undefined : { connect: { id: actor.id } },
    };
    if (def?.requiresLink) {
      const link = input.link?.trim();
      if (!link) throw new WorkflowError("Please paste the link before marking done");
      (data as Record<string, unknown>)[def.requiresLink] = link;
    }
    await tx.task.update({ where: { id: t.id }, data });
    await logEvent(tx, t.id, actor.id, def?.review ? "qc_pass" : "done", input.note);

    if (t.stepKey === "script" && input.link) await syncLogRow(tx, t.interviewId, LOG_STATUS.script, { scriptLink: input.link });
    if (t.stepKey === "raw_upload" && input.link) await syncLogRow(tx, t.interviewId, LOG_STATUS.edit, { rawFile: input.link });
    if (t.stepKey === "edit" && input.link) await syncLogRow(tx, t.interviewId, LOG_STATUS.qc, { finalOutput: input.link });
    if (t.stepKey === "publish" && input.link) await syncLogRow(tx, t.interviewId, "Uploaded", { uploadFacebook: input.link });

    return openNext(tx, t);
  });
  if (next) await notifyTurn(next, input.note);
  return next;
}

async function openNext(tx: Tx, t: Task) {
  if (!t.interviewId) return null;
  const next = await tx.task.findFirst({
    where: { interviewId: t.interviewId, order: { gt: t.order }, status: { in: ["WAITING", "TODO"] } },
    orderBy: { order: "asc" },
  });
  if (!next) {
    await syncLogRow(tx, t.interviewId, "In Ads");
    await tx.interview.update({ where: { id: t.interviewId }, data: { status: "Ads running" } });
    return null;
  }
  const opened = await tx.task.update({ where: { id: next.id }, data: { status: "TODO" } });
  if (next.stepKey) await syncLogRow(tx, t.interviewId, LOG_STATUS[next.stepKey as StepKey]);
  return opened;
}

async function notifyTurn(task: Task, note?: string | null) {
  let ids: string[] = task.assigneeId ? [task.assigneeId] : [];
  if (!ids.length && task.pool && task.role && task.companyId) {
    ids = await prisma.$transaction((tx) => roleHolders(tx, task.role!, task.companyId!));
  }
  await notify(ids, {
    kind: "task",
    title: `Your turn: ${task.title}`,
    body: note ? `Note: ${note}` : task.pool ? "Tap \"I'll do this\" to take it." : undefined,
    link: `/tasks/${task.id}`,
  });
}

/** QC / approval failed: note is required, work goes back to the earlier step. */
export async function failReview(taskId: string, actor: Actor, note: string) {
  if (!note?.trim()) throw new WorkflowError("Please write what needs to change");
  const back = await prisma.$transaction(async (tx) => {
    const t = await loadTask(tx, taskId);
    const def = VIDEO_CHAIN.find((s) => s.key === t.stepKey);
    if (!def?.review) throw new WorkflowError("This step has no pass / fail");
    if (!["TODO", "IN_PROGRESS"].includes(t.status)) throw new WorkflowError("This task is already closed");
    if (!(await canAct(tx, t, actor))) throw new WorkflowError("This task is not yours");
    const backTo = await tx.task.findFirstOrThrow({ where: { interviewId: t.interviewId, stepKey: def.review.failBackTo } });
    // Everything from the earlier step up to this one waits again.
    await tx.task.updateMany({
      where: { interviewId: t.interviewId, order: { gt: backTo.order, lte: t.order } },
      data: { status: "WAITING", doneAt: null, startedAt: null },
    });
    const reopened = await tx.task.update({
      where: { id: backTo.id },
      data: { status: "TODO", doneAt: null, startedAt: null, handoverNote: note },
    });
    await logEvent(tx, t.id, actor.id, "qc_fail", note);
    await logEvent(tx, backTo.id, actor.id, "sent_back", note);
    await syncLogRow(tx, t.interviewId, def.review.failBackTo === "edit" ? "Revision Needed" : "Script Writing");
    return reopened;
  });
  await notify([back.assigneeId], {
    kind: "qc",
    title: `Needs changes: ${back.title}`,
    body: note,
    link: `/tasks/${back.id}`,
  });
  return back;
}

/** Writer says the video already exists: skip straight to handover. */
export async function markAlreadyDone(taskId: string, actor: Actor, note?: string | null) {
  const opened = await prisma.$transaction(async (tx) => {
    const t = await loadTask(tx, taskId);
    const def = VIDEO_CHAIN.find((s) => s.key === t.stepKey);
    if (!def?.alreadyDoneSkipsTo) throw new WorkflowError("Not available for this step");
    if (!["TODO", "IN_PROGRESS"].includes(t.status)) throw new WorkflowError("This task is already closed");
    if (!(await canAct(tx, t, actor))) throw new WorkflowError("This task is not yours");
    const target = stepIndex(def.alreadyDoneSkipsTo) + 1;
    await tx.task.updateMany({
      where: { interviewId: t.interviewId, order: { gte: t.order, lt: target } },
      data: { status: "SKIPPED", doneAt: new Date() },
    });
    await logEvent(tx, t.id, actor.id, "already_done", note);
    const h = await tx.task.findFirstOrThrow({ where: { interviewId: t.interviewId, order: target } });
    await syncLogRow(tx, t.interviewId, LOG_STATUS[def.alreadyDoneSkipsTo]);
    return tx.task.update({ where: { id: h.id }, data: { status: "TODO", handoverNote: note || "Video already exists (Log Sheet)" } });
  });
  await notifyTurn(opened, note || "Video already exists");
  return opened;
}

/** Manual reassignment (Creative Lead, Jamil, Khalid: the `assign` responsibility). */
export async function reassignTask(taskId: string, actor: Actor, toUserId: string, note?: string) {
  if (!(actor.level === "SUPER_ADMIN" || actor.has("assign"))) throw new WorkflowError("Only managers with the assign duty can do this");
  const t = await prisma.task.update({ where: { id: taskId }, data: { assigneeId: toUserId } });
  await prisma.taskEvent.create({ data: { taskId, userId: actor.id, type: "reassigned", note: note || null } });
  if (t.status === "TODO" || t.status === "IN_PROGRESS") {
    await notify([toUserId], { kind: "task", title: `Assigned to you: ${t.title}`, body: note, link: `/tasks/${t.id}` });
  }
  return t;
}

/** A simple task outside the interview chain, with an optional checker. */
export async function createSimpleTask(input: {
  title: string;
  description?: string;
  assigneeId: string;
  checkerId?: string | null;
  companyId?: string | null;
  dueDate?: string | null;
  createdById: string;
}) {
  const t = await prisma.task.create({
    data: {
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId,
      checkerId: input.checkerId || null,
      companyId: input.companyId || null,
      status: "TODO",
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      events: { create: { type: "created", userId: input.createdById } },
    },
  });
  await notify([input.assigneeId], { kind: "task", title: `New task: ${t.title}`, link: `/tasks/${t.id}` });
  return t;
}
