"use server";

import { sendWhatsApp } from "@/lib/whatsapp";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { MODULES, ALL_RESPONSIBILITIES, defaultModuleAccess, type Level, findDuplicateNames } from "@cma/core";
import { prisma } from "@/lib/db";
import { createSession, destroySession, verifyPassword, requireUser, normalizePhone } from "@/lib/auth";
import {
  createInterview,
  attachChain,
  startTask,
  completeTask,
  failReview,
  markAlreadyDone,
  reassignTask,
  createSimpleTask,
  WorkflowError,
} from "@/lib/workflow";
import { notify } from "@/lib/notify";
import { importSnapshot } from "@/lib/dataImport";

const s = (f: FormData, k: string) => (f.get(k)?.toString() ?? "").trim();

function back(path: string, msg: { e?: string; ok?: string }): never {
  const q = new URLSearchParams(msg as Record<string, string>).toString();
  redirect(`${path}${path.includes("?") ? "&" : "?"}${q}`);
}

async function run(path: string, fn: () => Promise<unknown>, ok?: string) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof WorkflowError) back(path, { e: err.message });
    throw err;
  }
  revalidatePath("/", "layout");
  if (ok) back(path, { ok });
  redirect(path);
}

/* ---------- auth ---------- */

export async function loginAction(f: FormData) {
  const user = await verifyPassword(s(f, "phone"), s(f, "password"));
  if (!user) redirect("/login?e=1");
  await createSession(user.id);
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function changePasswordAction(f: FormData) {
  const u = await requireUser();
  const cur = s(f, "current");
  const next = s(f, "next");
  if (next.length < 6) back("/profile", { e: "New password must be at least 6 characters" });
  if (!(await bcrypt.compare(cur, u.passwordHash))) back("/profile", { e: "Current password is wrong" });
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
  back("/profile", { ok: "Password changed" });
}

export async function updateProfileAction(f: FormData) {
  const u = await requireUser();
  await prisma.user.update({
    where: { id: u.id },
    data: { whatsapp: normalizePhone(s(f, "whatsapp")) || null, whatsappOn: f.get("whatsappOn") === "on" },
  });
  back("/profile", { ok: "Saved" });
}

/* ---------- tasks ---------- */

export async function startTaskAction(f: FormData) {
  const u = await requireUser();
  const id = s(f, "id");
  await run(`/tasks/${id}`, () => startTask(id, u));
}

export async function completeTaskAction(f: FormData) {
  const u = await requireUser();
  const id = s(f, "id");
  await run(`/tasks/${id}`, () => completeTask(id, u, { link: s(f, "link") || null, note: s(f, "note") || null }), "Done. The next person has been told.");
}

export async function failReviewAction(f: FormData) {
  const u = await requireUser();
  const id = s(f, "id");
  await run(`/tasks/${id}`, () => failReview(id, u, s(f, "note")), "Sent back with your note.");
}

export async function alreadyDoneAction(f: FormData) {
  const u = await requireUser();
  const id = s(f, "id");
  await run(`/tasks/${id}`, () => markAlreadyDone(id, u, s(f, "note") || null), "Marked as already done.");
}

export async function reassignAction(f: FormData) {
  const u = await requireUser();
  const id = s(f, "id");
  await run(`/tasks/${id}`, () => reassignTask(id, u, s(f, "to"), s(f, "note") || undefined), "Reassigned.");
}

export async function simpleTaskDoneAction(f: FormData) {
  const u = await requireUser();
  const id = s(f, "id");
  await run(`/tasks/${id}`, async () => {
    const t = await prisma.task.findUniqueOrThrow({ where: { id } });
    if (t.assigneeId !== u.id && u.level !== "SUPER_ADMIN" && !u.has("assign")) throw new WorkflowError("This task is not yours");
    await prisma.task.update({ where: { id }, data: { status: "DONE", doneAt: new Date(), handoverNote: s(f, "note") || null } });
    await prisma.taskEvent.create({ data: { taskId: id, userId: u.id, type: "done", note: s(f, "note") || null } });
    if (t.checkerId) await notify([t.checkerId], { kind: "task", title: `Please check: ${t.title}`, body: s(f, "note") || undefined, link: `/tasks/${id}` });
  }, "Done.");
}

export async function createSimpleTaskAction(f: FormData) {
  const u = await requireUser();
  if (!(u.level === "SUPER_ADMIN" || u.has("assign"))) back("/tasks/new", { e: "Only managers with the assign duty can create tasks for others" });
  const title = s(f, "title");
  if (!title || !s(f, "assigneeId")) back("/tasks/new", { e: "Title and person are required" });
  const t = await createSimpleTask({
    title,
    description: s(f, "description") || undefined,
    assigneeId: s(f, "assigneeId"),
    checkerId: s(f, "checkerId") || null,
    companyId: s(f, "companyId") || null,
    dueDate: s(f, "dueDate") || null,
    createdById: u.id,
  });
  revalidatePath("/", "layout");
  redirect(`/tasks/${t.id}`);
}

/* ---------- interviews ---------- */

const InterviewInput = z.object({
  companyId: z.string().min(1),
  country: z.string().min(1, "Country is required"),
  interviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the interview date"),
  title: z.string().optional(),
  marketingPlanUsd: z.coerce.number().optional(),
  notes: z.string().optional(),
});

export async function createInterviewAction(f: FormData) {
  const u = await requireUser();
  if (!u.can("interviews", "EDIT")) back("/interviews/new", { e: "You cannot create interviews" });
  const parsed = InterviewInput.safeParse({
    companyId: s(f, "companyId"),
    country: s(f, "country"),
    interviewDate: s(f, "interviewDate"),
    title: s(f, "title") || undefined,
    marketingPlanUsd: s(f, "marketingPlanUsd") || undefined,
    notes: s(f, "notes") || undefined,
  });
  if (!parsed.success) back("/interviews/new", { e: parsed.error.issues[0].message });
  const iv = await createInterview({ ...parsed.data, createdById: u.id });
  revalidatePath("/", "layout");
  redirect(`/interviews/${iv.id}?ok=Timeline created. The writer has been told.`);
}

export async function checkCompanyName(name: string) {
  await requireUser();
  const rows = await prisma.interview.findMany({ select: { title: true, company: { select: { name: true } } } });
  return findDuplicateNames(
    name,
    rows.map((r) => ({ name: r.title ?? "", agency: r.company.name })),
  ).slice(0, 5);
}

/* ---------- requests ---------- */

export async function sendRequestAction(f: FormData) {
  const u = await requireUser();
  const toId = s(f, "toId");
  const type = s(f, "type") as Prisma.RequestCreateInput["type"];
  const message = s(f, "message");
  const taskId = s(f, "taskId") || null;
  const ret = s(f, "return") || "/requests";
  if (!toId || !message) back(ret, { e: "Pick a person and write a message" });
  const r = await prisma.request.create({ data: { fromId: u.id, toId, type, message, taskId } });
  await notify([toId], { kind: "request", title: `${u.name}: ${type.replace("_", " ").toLowerCase()} request`, body: message, link: `/requests?open=${r.id}` });
  revalidatePath("/", "layout");
  back(ret, { ok: "Request sent" });
}

export async function answerRequestAction(f: FormData) {
  const u = await requireUser();
  const id = s(f, "id");
  const r = await prisma.request.findUniqueOrThrow({ where: { id } });
  if (r.toId !== u.id) back("/requests", { e: "This request is not for you" });
  const answer = s(f, "answer");
  await prisma.request.update({ where: { id }, data: { status: "ANSWERED", answer, answeredAt: new Date() } });
  // Raw file request answered with a link: put it on the task for the editor.
  if (r.type === "RAW_FILE" && r.taskId && /^https?:\/\//.test(answer)) {
    await prisma.task.update({ where: { id: r.taskId }, data: { driveLink: answer } });
  }
  await notify([r.fromId], { kind: "request", title: `${u.name} answered your request`, body: answer, link: `/requests?tab=sent` });
  revalidatePath("/", "layout");
  back("/requests", { ok: "Answer sent" });
}

/* ---------- notifications ---------- */

export async function markAllReadAction() {
  const u = await requireUser();
  await prisma.notification.updateMany({ where: { userId: u.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
  redirect("/notifications");
}

/* ---------- users & permissions ---------- */

async function requireUsersAdmin() {
  const u = await requireUser();
  if (!u.can("users", "EDIT")) redirect("/?denied=users");
  return u;
}

export async function createUserAction(f: FormData) {
  const admin = await requireUsersAdmin();
  const phone = normalizePhone(s(f, "phone"));
  const name = s(f, "name");
  const level = (s(f, "level") || "STAFF") as Level;
  if (!name || phone.length < 10) back("/users/new", { e: "Name and an 11-digit phone are required" });
  if (level === "SUPER_ADMIN" && admin.level !== "SUPER_ADMIN") back("/users/new", { e: "Only a Super Admin can create a Super Admin" });
  const password = s(f, "password") || "cma12345";
  try {
    const u = await prisma.user.create({
      data: {
        name,
        shortName: name.split(" ").find((w) => !/^(md|mr)$/i.test(w)) ?? name,
        phone,
        whatsapp: phone,
        level,
        department: s(f, "department") || null,
        designation: s(f, "designation") || null,
        passwordHash: await bcrypt.hash(password, 10),
        permissions: {
          create: Object.entries(defaultModuleAccess(level)).map(([module, access]) => ({ module, access })),
        },
      },
    });
    await prisma.auditLog.create({ data: { userId: admin.id, action: "create", entity: "user", entityId: u.id } });
    revalidatePath("/users");
    redirect(`/users/${u.id}?ok=User created. First password: ${password}`);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") back("/users/new", { e: "This phone number is already used" });
    throw err;
  }
}

export async function saveUserAction(f: FormData) {
  const admin = await requireUsersAdmin();
  const id = s(f, "id");
  const target = await prisma.user.findUniqueOrThrow({ where: { id } });
  if (target.level === "SUPER_ADMIN" && admin.level !== "SUPER_ADMIN") back(`/users/${id}`, { e: "Only a Super Admin can change a Super Admin" });
  const level = (s(f, "level") || target.level) as Level;
  if (level === "SUPER_ADMIN" && admin.level !== "SUPER_ADMIN") back(`/users/${id}`, { e: "Only a Super Admin can make a Super Admin" });

  const companies = await prisma.company.findMany();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        name: s(f, "name") || target.name,
        phone: normalizePhone(s(f, "phone")) || target.phone,
        whatsapp: normalizePhone(s(f, "whatsapp")) || null,
        level,
        department: s(f, "department") || null,
        designation: s(f, "designation") || null,
        active: f.get("active") === "on",
        external: f.get("external") === "on",
      },
    });
    for (const m of MODULES) {
      const access = (s(f, `perm_${m.key}`) || "OFF") as "OFF" | "VIEW" | "EDIT";
      await tx.modulePermission.upsert({
        where: { userId_module: { userId: id, module: m.key } },
        update: { access },
        create: { userId: id, module: m.key, access },
      });
    }
    await tx.responsibility.deleteMany({ where: { userId: id } });
    for (const r of ALL_RESPONSIBILITIES) {
      if (f.get(`resp_${r.key}`) !== "on") continue;
      const cos = companies.filter((c) => f.get(`resp_${r.key}_co_${c.id}`) === "on").map((c) => c.id);
      await tx.responsibility.create({ data: { userId: id, key: r.key, companies: cos, contentTypes: f.getAll(`resp_${r.key}_ct`).map(String) } });
    }
    if (s(f, "newPassword")) {
      await tx.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(s(f, "newPassword"), 10) } });
    }
    await tx.auditLog.create({ data: { userId: admin.id, action: "update", entity: "user", entityId: id } });
  });
  revalidatePath("/users");
  back(`/users/${id}`, { ok: "Saved" });
}

/* ---------- settings ---------- */

export async function saveSettingsAction(f: FormData) {
  const u = await requireUser();
  if (!u.can("settings", "EDIT")) redirect("/?denied=settings");
  const num = (k: string, min: number, max: number) => Math.min(max, Math.max(min, Number(s(f, k)) || 0));
  await prisma.setting.upsert({
    where: { key: "timeline" },
    update: { value: {
      adsDaysBefore: num("adsDaysBefore", 1, 30),
      writerDaysBeforeAds: num("writerDaysBeforeAds", 1, 30),
      handoverDaysBeforeAds: num("handoverDaysBeforeAds", 0, 10),
      shootDaysBeforeHandover: num("shootDaysBeforeHandover", 1, 15),
    } },
    create: { key: "timeline", value: {} },
  });

  const companies = await prisma.company.findMany();
  const ROLE_KEYS = ["writer", "model", "editor", "qc", "ads", "broadcast_officer", "uploader"];
  await prisma.$transaction(async (tx) => {
    for (const c of companies) {
      for (const role of ROLE_KEYS) {
        const ids = f.getAll(`role_${c.id}_${role}`).map(String).filter(Boolean);
        await tx.companyRole.deleteMany({ where: { companyId: c.id, role } });
        for (const userId of [...new Set(ids)]) await tx.companyRole.create({ data: { companyId: c.id, role, userId } });
      }
    }
    for (const role of ["creative_lead", "content_director", "cinematographer"]) {
      const ids = f.getAll(`role_global_${role}`).map(String).filter(Boolean);
      await tx.companyRole.deleteMany({ where: { companyId: null, role } });
      for (const userId of [...new Set(ids)]) await tx.companyRole.create({ data: { companyId: null, role, userId } });
    }
    await tx.auditLog.create({ data: { userId: u.id, action: "update", entity: "settings" } });
  });
  revalidatePath("/settings");
  back("/settings", { ok: "Settings saved. New interviews use these." });
}

/* ---------- old data upload ---------- */

/** Returns a message instead of redirecting, so the page can show it next to the button. */
export async function uploadSnapshotAction(f: FormData): Promise<{ ok?: string; e?: string }> {
  const u = await requireUser();
  if (u.level !== "SUPER_ADMIN" || !u.can("settings", "EDIT")) return { e: "Only the super admin can upload data" };
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) return { e: "Choose the data file first" };
  let snap: Parameters<typeof importSnapshot>[0];
  try {
    snap = JSON.parse(await file.text());
    if (typeof snap !== "object" || !snap || !("recruitment" in snap || "log" in snap || "broadcast" in snap)) throw new Error();
  } catch {
    return { e: "This is not the CMA data file" };
  }
  try {
    const r = await importSnapshot(snap);
    await prisma.auditLog.create({ data: { userId: u.id, action: "import", entity: "snapshot", data: r } });
    revalidatePath("/", "layout");
    return { ok: `Done. Imported ${r.interviews} interviews, ${r.slots} call days, ${r.logRows} log rows.` };
  } catch (err) {
    console.error("snapshot import failed", err);
    return { e: "Import failed: " + String((err as Error)?.message ?? err).slice(0, 200) };
  }
}

export async function startTimelineAction(f: FormData) {
  const u = await requireUser();
  const id = s(f, "id");
  const to = f.get("back") === "marketing" ? "/marketing" : `/interviews/${id}`;
  if (!u.can("interviews", "EDIT")) back(to, { e: "You cannot start timelines" });
  await attachChain(id, { createdById: u.id });
  revalidatePath("/", "layout");
  back(to, { ok: "Timeline started. The writer has been told." });
}

/* ---------- WhatsApp ---------- */

export async function testWhatsAppAction(): Promise<{ ok?: string; e?: string }> {
  const u = await requireUser();
  if (!u.can("settings", "EDIT")) return { e: "Only an admin can test WhatsApp" };
  const me = await prisma.user.findUnique({ where: { id: u.id }, select: { whatsapp: true } });
  if (!me?.whatsapp) return { e: "Add your WhatsApp number in Profile first" };
  const r = await sendWhatsApp(me.whatsapp, "Test message. WhatsApp is connected");
  return r.ok ? { ok: `Sent to ${me.whatsapp}. Check your WhatsApp.` } : { e: `Not sent: ${r.error}` };
}
