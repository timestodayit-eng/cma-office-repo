// Runs against the real database (DATABASE_URL), after `pnpm db:seed`.
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../src/lib/db";
import { createInterview, startTask, completeTask, failReview, markAlreadyDone, WorkflowError } from "../src/lib/workflow";

const created: string[] = [];
afterAll(async () => {
  await prisma.logRow.deleteMany({ where: { taskId: { in: created } } });
  await prisma.interview.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

async function actor(name: string) {
  const u = await prisma.user.findFirstOrThrow({ where: { name }, include: { responsibilities: true } });
  const r = new Set(u.responsibilities.map((x) => x.key));
  return { id: u.id, level: u.level as string, has: (k: string) => u.level === "SUPER_ADMIN" || r.has(k) };
}
async function steps(id: string) {
  const t = await prisma.task.findMany({ where: { interviewId: id }, orderBy: { order: "asc" }, include: { assignee: true } });
  return Object.fromEntries(t.map((x) => [x.stepKey!, x]));
}

describe("interview chain", () => {
  it("runs the whole Coastal chain with a QC fail on the way", async () => {
    const jamil = await actor("Md Jamil Ahammed");
    const cm = await prisma.company.findUniqueOrThrow({ where: { short: "CM" } });
    const iv = await createInterview({ companyId: cm.id, country: "Malaysia", interviewDate: "2026-12-09", createdById: jamil.id });
    created.push(iv.id);

    let s = await steps(iv.id);
    expect(Object.keys(s)).toHaveLength(10);
    expect(s.script.assignee?.name).toBe("Atik Mahmud");
    expect(s.script.status).toBe("TODO");
    expect(s.shoot.assignee?.name).toBe("Rakib Hossain Hridoy");
    expect(s.edit.pool).toBe(true);
    expect(await prisma.broadcastSlot.count({ where: { interviewId: iv.id } })).toBe(5);

    const atik = await actor("Atik Mahmud");
    const rakib = await actor("Rakib Hossain Hridoy");
    const solaiman = await actor("Solaiman Rafi");
    const sohel = await actor("Sohel Ariyan");
    const dipu = await actor("MD Dipu"); // SM editor, not Coastal
    const zahid = await actor("Zahid Hasan Antor"); // Coastal editor

    await expect(completeTask(s.script.id, rakib)).rejects.toThrow(WorkflowError); // not his
    await expect(completeTask(s.script.id, atik)).rejects.toThrow(/link/); // link required
    await startTask(s.script.id, atik);
    await completeTask(s.script.id, atik, { link: "https://docs.google.com/script" });
    await completeTask(s.script_approve.id, solaiman);
    await completeTask(s.shoot_slot.id, sohel);
    await completeTask(s.shoot.id, rakib);
    await completeTask(s.raw_upload.id, rakib, { link: "https://drive.google.com/raw" });

    await expect(startTask(s.edit.id, dipu)).rejects.toThrow(WorkflowError); // wrong company
    await startTask(s.edit.id, zahid); // claims
    await completeTask(s.edit.id, zahid, { link: "https://drive.google.com/v1" });

    await failReview(s.qc.id, solaiman, "Logo missing at the end");
    s = await steps(iv.id);
    expect(s.edit.status).toBe("TODO");
    expect(s.edit.assignee?.name).toBe("Zahid Hasan Antor");
    expect(s.qc.status).toBe("WAITING");
    const zahidNote = await prisma.notification.findFirst({ where: { userId: zahid.id, kind: "qc" }, orderBy: { createdAt: "desc" } });
    expect(zahidNote?.body).toBe("Logo missing at the end");

    await completeTask(s.edit.id, zahid, { link: "https://drive.google.com/v2" });
    await completeTask(s.qc.id, solaiman, { note: "OK" });
    await completeTask(s.handover.id, solaiman);
    await completeTask(s.publish.id, atik, { link: "https://facebook.com/post/1" });
    const ariful = await actor("Ariful Islam");
    await completeTask(s.ads.id, ariful);

    const fresh = await prisma.interview.findUniqueOrThrow({ where: { id: iv.id } });
    expect(fresh.status).toBe("Ads running");
    const log = await prisma.logRow.findFirstOrThrow({ where: { taskId: iv.id } });
    expect(log.status).toBe("In Ads");
    expect(log.videoEditor).toBe("Zahid");
    expect(log.finalOutput).toBe("https://drive.google.com/v2");
  });

  it("'Already done' skips straight to handover", async () => {
    const jamil = await actor("Md Jamil Ahammed");
    const ci = await prisma.company.findUniqueOrThrow({ where: { short: "CI" } });
    const iv = await createInterview({ companyId: ci.id, country: "Saudi Arabia", interviewDate: "2026-12-15", createdById: jamil.id });
    created.push(iv.id);
    const s = await steps(iv.id);
    const mosahead = await actor("Mosahead Hasan");
    await markAlreadyDone(s.script.id, mosahead, "Same as Nov video");
    const after = await steps(iv.id);
    expect(after.qc.status).toBe("SKIPPED");
    expect(after.handover.status).toBe("TODO");
    expect(after.handover.assignee?.name).toBe("Solaiman Rafi");
  });
});
