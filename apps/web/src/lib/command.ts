// Command Center: the AI answers from the app's data through these tools, and (for people
// allowed to) creates tasks and interviews. Every tool checks the asking user's own permissions.
import { prisma } from "./db";
import type { CurrentUser } from "./auth";
import { aiTurn, type AiMessage, type AiTool } from "./ai";
import { createSimpleTask, createInterview } from "./workflow";
import { todayDhaka } from "./format";

type U = NonNullable<CurrentUser>;
type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const dayOf = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? new Date(str(v) + "T00:00:00Z") : null);
const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

async function findPerson(name: string) {
  const people = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true } });
  const k = key(name);
  const hits = people.filter((p) => key(p.name) === k);
  return hits.length ? hits : people.filter((p) => key(p.name).includes(k) || k.split(" ").some((w) => w.length > 2 && key(p.name).split(" ").includes(w)));
}
async function findCompany(name: string) {
  const cs = await prisma.company.findMany();
  const k = key(name);
  return cs.find((c) => key(c.name) === k || key(c.short) === k) ?? cs.find((c) => key(c.name).includes(k) || k.includes(key(c.name).split(" ")[0]));
}

const canAssign = (u: U) => u.level === "SUPER_ADMIN" || u.has("assign");

type Tool = AiTool & { allowed: (u: U) => boolean; run: (a: Args, u: U) => Promise<unknown> };

const TOOLS: Tool[] = [
  {
    name: "list_people",
    description: "The team: name, level, designation and working roles of each active person.",
    parameters: { type: "object", properties: {} },
    allowed: () => true,
    run: async () =>
      (await prisma.user.findMany({ where: { active: true }, include: { responsibilities: true }, orderBy: { name: "asc" } }))
        .map((p) => ({ name: p.name, level: p.level, designation: p.designation, roles: p.responsibilities.map((r) => r.key) })),
  },
  {
    name: "list_tasks",
    description: "Tasks with filters. Use it for questions like who has what work, what is late, what is due today. Returns at most 60 tasks plus the total count.",
    parameters: {
      type: "object",
      properties: {
        person: { type: "string", description: "Assignee name or part of it" },
        state: { type: "string", enum: ["open", "late", "done", "waiting", "all"], description: "open = to do or in progress (default); late = open and past due" },
        company: { type: "string", description: "Agency name or short code (CI, CM, SM)" },
        dueFrom: { type: "string", description: "yyyy-mm-dd" },
        dueTo: { type: "string", description: "yyyy-mm-dd" },
      },
    },
    allowed: (u) => u.can("tasks"),
    run: async (a, u) => {
      const today = todayDhaka();
      const state = str(a.state) || "open";
      const seeAll = u.level !== "STAFF";
      const person = str(a.person) ? await findPerson(str(a.person)) : null;
      const company = str(a.company) ? await findCompany(str(a.company)) : null;
      const where = {
        ...(state === "open" ? { status: { in: ["TODO", "IN_PROGRESS"] as ("TODO" | "IN_PROGRESS")[] } }
          : state === "late" ? { status: { in: ["TODO", "IN_PROGRESS"] as ("TODO" | "IN_PROGRESS")[] }, dueDate: { lt: today } }
          : state === "done" ? { status: "DONE" as const }
          : state === "waiting" ? { status: "WAITING" as const } : {}),
        ...(person ? { assigneeId: { in: person.map((p) => p.id) } } : {}),
        ...(seeAll ? {} : { assigneeId: u.id }),
        ...(company ? { companyId: company.id } : {}),
        ...(dayOf(a.dueFrom) || dayOf(a.dueTo) ? { dueDate: { ...(state === "late" ? { lt: today } : {}), ...(dayOf(a.dueFrom) ? { gte: dayOf(a.dueFrom)! } : {}), ...(dayOf(a.dueTo) ? { lte: dayOf(a.dueTo)! } : {}) } } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.task.count({ where }),
        prisma.task.findMany({ where, include: { assignee: true, company: true, interview: true }, orderBy: [{ dueDate: "asc" }], take: 60 }),
      ]);
      return {
        total,
        note: seeAll ? undefined : "This person is staff and sees only their own tasks.",
        tasks: rows.map((t) => ({ title: t.title, interview: t.interview?.title ?? null, company: t.company?.name ?? null, assignee: t.assignee?.name ?? (t.pool ? "open for the company's editors" : null), status: t.status, due: iso(t.dueDate), link: `/tasks/${t.id}` })),
      };
    },
  },
  {
    name: "list_interviews",
    description: "Interviews from the Recruitment sheet and the app, with date, agency, country, status and (if this person may see recruitment numbers) passports, leads and cost.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "yyyy-mm-dd, default today" },
        to: { type: "string", description: "yyyy-mm-dd" },
        company: { type: "string" },
        search: { type: "string", description: "Part of the interview / company name or country" },
      },
    },
    allowed: (u) => u.can("interviews") || u.can("recruitment") || u.can("marketing"),
    run: async (a, u) => {
      const company = str(a.company) ? await findCompany(str(a.company)) : null;
      const q = str(a.search);
      const rows = await prisma.interview.findMany({
        where: {
          interviewDate: { gte: dayOf(a.from) ?? (q || dayOf(a.to) ? undefined : todayDhaka()), lte: dayOf(a.to) ?? undefined },
          ...(company ? { companyId: company.id } : {}),
          ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { country: { contains: q, mode: "insensitive" as const } }] } : {}),
        },
        include: { company: true, tasks: { where: { status: { in: ["TODO", "IN_PROGRESS"] } }, include: { assignee: true }, take: 1 } },
        orderBy: { interviewDate: "asc" },
        take: 80,
      });
      const money = u.can("recruitment");
      return rows.map((r) => ({
        title: r.title, agency: r.company.name, country: r.country, date: iso(r.interviewDate), status: r.status,
        videoStep: r.tasks[0] ? `${r.tasks[0].title} (${r.tasks[0].assignee?.name ?? "not assigned"})` : null,
        ...(money ? { passports: r.passports, leads: r.leads, costBdt: r.totalCostBdt ? Number(r.totalCostBdt) : null, costUsd: r.totalCostUsd ? Number(r.totalCostUsd) : null, planUsd: r.marketingPlanUsd ? Number(r.marketingPlanUsd) : null } : {}),
        link: `/interviews/${r.id}`,
      }));
    },
  },
  {
    name: "recruitment_totals",
    description: "Totals of finished interviews per agency for a period: interviews, passports (PC), leads, cost in BDT, CPP (cost per passport) and conversion %.",
    parameters: { type: "object", properties: { from: { type: "string", description: "yyyy-mm-dd" }, to: { type: "string", description: "yyyy-mm-dd, default today" } } },
    allowed: (u) => u.can("recruitment"),
    run: async (a) => {
      const rows = await prisma.interview.findMany({
        where: { interviewDate: { gte: dayOf(a.from) ?? undefined, lte: dayOf(a.to) ?? todayDhaka() } },
        include: { company: true },
      });
      const by: Record<string, { interviews: number; passports: number; leads: number; costBdt: number }> = {};
      for (const r of rows) {
        const b = (by[r.company.name] ??= { interviews: 0, passports: 0, leads: 0, costBdt: 0 });
        b.interviews++; b.passports += r.passports ?? 0; b.leads += r.leads ?? 0; b.costBdt += Number(r.totalCostBdt ?? 0);
      }
      return Object.entries(by).map(([agency, b]) => ({ agency, ...b, cppBdt: b.passports ? Math.round(b.costBdt / b.passports) : null, conversionPct: b.leads ? +((b.passports / b.leads) * 100).toFixed(2) : null }));
    },
  },
  {
    name: "log_sheet",
    description: "Rows of the Digital Media Solution Log Sheet (content log) for a day or a range, with optional filters. Returns at most 80 rows plus counts by status.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "yyyy-mm-dd, default today" },
        to: { type: "string", description: "yyyy-mm-dd, default same as from" },
        status: { type: "string" },
        company: { type: "string" },
        person: { type: "string", description: "Matches script writer, presenter, cinematographer or video editor" },
        search: { type: "string", description: "Part of the content title" },
      },
    },
    allowed: (u) => u.can("logsheet"),
    run: async (a) => {
      const from = dayOf(a.from) ?? todayDhaka();
      const to = dayOf(a.to) ?? from;
      const c = (v: unknown) => ({ contains: str(v), mode: "insensitive" as const });
      const where = {
        date: { gte: from, lte: to }, title: str(a.search) ? c(a.search) : { not: null },
        ...(str(a.status) ? { status: c(a.status) } : {}),
        ...(str(a.company) ? { company: c(a.company) } : {}),
        ...(str(a.person) ? { OR: [{ scriptWriter: c(a.person) }, { presenter: c(a.person) }, { cinematographer: c(a.person) }, { videoEditor: c(a.person) }] } : {}),
      };
      const [rows, groups] = await Promise.all([
        prisma.logRow.findMany({ where, orderBy: [{ date: "desc" }, { rowIndex: "asc" }], take: 80 }),
        prisma.logRow.groupBy({ by: ["status"], where, _count: true }),
      ]);
      return {
        countsByStatus: Object.fromEntries(groups.map((g) => [g.status ?? "(no status)", g._count])),
        rows: rows.map((r) => ({ date: iso(r.date), title: r.title, company: r.company, type: r.contentType, status: r.status, deadline: r.deadline, writer: r.scriptWriter, presenter: r.presenter, cinematographer: r.cinematographer, editor: r.videoEditor })),
      };
    },
  },
  {
    name: "broadcast_days",
    description: "Banglalink call broadcast days (V1..V7) in a date range, with whether the Missed and Received calls were sent.",
    parameters: { type: "object", properties: { from: { type: "string", description: "yyyy-mm-dd, default today" }, to: { type: "string", description: "yyyy-mm-dd, default 7 days after from" } } },
    allowed: (u) => u.can("broadcast"),
    run: async (a) => {
      const from = dayOf(a.from) ?? todayDhaka();
      const to = dayOf(a.to) ?? new Date(from.getTime() + 7 * 86400_000);
      const rows = await prisma.broadcastSlot.findMany({ where: { callDate: { gte: from, lte: to } }, include: { interview: { include: { company: true } } }, orderBy: { callDate: "asc" }, take: 120 });
      return rows.map((s) => ({ callDate: iso(s.callDate), slot: s.slot, interview: s.interview.title, agency: s.interview.company.name, interviewDate: iso(s.interview.interviewDate), missedSent: s.missedSent, receivedSent: s.receivedSent }));
    },
  },
  {
    name: "create_task",
    description: "Create a task and hand it to a person (they get a notification). Only when the user clearly asked to give work to someone. One call per task.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, clear task title" },
        person: { type: "string", description: "Who does it (name)" },
        dueDate: { type: "string", description: "yyyy-mm-dd" },
        description: { type: "string" },
        company: { type: "string", description: "Agency, if the work is for one" },
        checker: { type: "string", description: "Person who checks it when done (optional)" },
      },
      required: ["title", "person"],
    },
    allowed: canAssign,
    run: async (a, u) => {
      if (!str(a.title)) return { error: "A title is needed" };
      const who = await findPerson(str(a.person));
      if (who.length !== 1) return { error: who.length ? `More than one person matches: ${who.map((p) => p.name).join(", ")}. Ask which one.` : `Nobody named "${str(a.person)}". Use list_people.` };
      const checker = str(a.checker) ? await findPerson(str(a.checker)) : [];
      if (str(a.checker) && checker.length !== 1) return { error: `Checker "${str(a.checker)}" is not one clear person. Ask.` };
      const company = str(a.company) ? await findCompany(str(a.company)) : null;
      const t = await createSimpleTask({
        title: str(a.title).slice(0, 200), description: str(a.description) || undefined, assigneeId: who[0].id,
        checkerId: checker[0]?.id ?? null, companyId: company?.id ?? null, dueDate: dayOf(a.dueDate) ? str(a.dueDate) : null, createdById: u.id,
      });
      await prisma.auditLog.create({ data: { userId: u.id, action: "ai.create_task", entity: "task", data: { id: t.id, title: t.title, to: who[0].name } } });
      return { created: true, title: t.title, assignee: who[0].name, due: iso(t.dueDate), link: `/tasks/${t.id}` };
    },
  },
  {
    name: "create_interview",
    description: "Add a new interview. This starts the whole video timeline (10 tasks, the writer is notified) and adds a row to the Recruitment Google Sheet, so it is hard to undo. First call it with confirmed=false to get a summary, show the summary to the user, and call it with confirmed=true only after the user says yes.",
    parameters: {
      type: "object",
      properties: {
        company: { type: "string", description: "Agency: Creative International, Coastal Manpower or SM Enterprise" },
        country: { type: "string" },
        interviewDate: { type: "string", description: "yyyy-mm-dd" },
        title: { type: "string", description: "Company / project name as it should appear in the sheet" },
        confirmed: { type: "boolean" },
      },
      required: ["company", "country", "interviewDate", "confirmed"],
    },
    allowed: (u) => u.can("interviews", "EDIT"),
    run: async (a, u) => {
      const company = str(a.company) ? await findCompany(str(a.company)) : null;
      if (!company) return { error: "Which agency? Creative International, Coastal Manpower or SM Enterprise." };
      const date = dayOf(a.interviewDate);
      if (!date || !str(a.country)) return { error: "Country and interview date (yyyy-mm-dd) are needed." };
      if (date < todayDhaka()) return { error: "The interview date is in the past." };
      const summary = { agency: company.name, country: str(a.country), interviewDate: iso(date), title: str(a.title) || `${company.name} · ${str(a.country)}` };
      if (a.confirmed !== true) return { needsConfirmation: true, summary, say: "Show this to the user and ask them to confirm." };
      const iv = await createInterview({ companyId: company.id, country: str(a.country), interviewDate: str(a.interviewDate), title: str(a.title) || undefined, createdById: u.id });
      await prisma.auditLog.create({ data: { userId: u.id, action: "ai.create_interview", entity: "interview", data: { id: iv.id, ...summary } } });
      return { created: true, ...summary, link: `/interviews/${iv.id}` };
    },
  },
];

/**
 * The model sometimes puts a made-up website in front of an in-app link. Keep only the in-app path,
 * and drop any other web address it did not get from the app.
 */
export function cleanLinks(text: string) {
  return text
    .replace(/https?:\/\/[^\s/)\]]+(\/(?:tasks|interviews|logsheet|recruitment|broadcast|marketing|attendance|requests|settings|users)(?:[/?][^\s)\]]*)?)/gi, "$1")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/g, "$1");
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

function systemPrompt(u: U) {
  const today = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date());
  return `You are the Command Center of CMA Office, the internal work app of a media team in Dhaka that serves three recruitment agencies: Creative International (CI), Coastal Manpower (CM) and SM Enterprise (SM). The team makes interview campaign videos: script, shoot, edit, QC, publish, ads, plus Banglalink call broadcasts before each interview.

You are talking with ${u.name} (${u.level.replace("_", " ").toLowerCase()}${u.designation ? ", " + u.designation : ""}). Today is ${today} (Asia/Dhaka).

How to work:
- Answer only from what the tools return. If the tools do not have it, say so plainly; never make up names, numbers or dates.
- Reply in the language the person writes in. Bangla written in English letters (Banglish) gets a simple Bangla reply. Keep replies short and plain; use a small list when there are several items.
- Dates in replies: like 12 Dec. Money: BDT with a thousands comma.
- When you mention a task or interview that has a link, write it as [title](link) with the link copied exactly as the tool gave it. Links start with / (for example /tasks/abc). Never put a website address or domain in front of a link and never invent a link.
- Giving work: when the person clearly asks to give someone a task, create it. If the person, the work or the date is unclear, ask one short question first. After creating, say what was created, for whom and the due date.
- A new interview needs the person's yes before it is created (see the tool).
- A tool that is missing from your list means this person is not allowed to use that part of the app; say that they do not have that permission.
- You cannot change settings, users, attendance or salary, delete anything or edit sheets directly.`;
}

/** One question -> answer, running tools in between. `history` is the earlier chat on this screen. */
export async function runCommand(u: U, history: ChatTurn[], question: string): Promise<{ text: string; did: string[] }> {
  const tools = TOOLS.filter((t) => t.allowed(u));
  const defs: AiTool[] = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const messages: AiMessage[] = [
    { role: "system", content: systemPrompt(u) },
    ...history.slice(-12).map((h) => ({ role: h.role, content: h.content.slice(0, 4000) }) as AiMessage),
    { role: "user", content: question.slice(0, 4000) },
  ];
  const did: string[] = [];
  for (let i = 0; i < 8; i++) {
    const turn = await aiTurn(messages, defs);
    if (!turn.toolCalls.length) return { text: cleanLinks(turn.text || "…"), did };
    messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });
    for (const c of turn.toolCalls) {
      const tool = tools.find((t) => t.name === c.name);
      let out: unknown;
      try { out = tool ? await tool.run(c.args, u) : { error: "This person may not use that tool" }; }
      catch (e) { console.error("command tool", c.name, e); out = { error: "The app could not do this: " + String((e as Error).message ?? e).slice(0, 200) }; }
      const o = out as { created?: boolean; title?: string; link?: string } | null;
      if (o?.created && o.link) did.push(o.link);
      messages.push({ role: "tool", toolCallId: c.id, content: JSON.stringify(out).slice(0, 30000) });
    }
  }
  return { text: "This took too many steps. Please ask in a simpler way.", did };
}
