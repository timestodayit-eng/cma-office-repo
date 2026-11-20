import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { getTimelineSettings } from "@/lib/workflow";
import { Flash } from "@/components/TaskCard";
import { createInterviewAction } from "@/app/actions";
import { NewInterviewPreview } from "./preview";

export default async function NewInterview({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  await requireModule("interviews", "EDIT");
  const sp = await searchParams;
  const [companies, settings, names] = await Promise.all([
    prisma.company.findMany({ orderBy: { sortOrder: "asc" } }),
    getTimelineSettings(),
    prisma.interview.findMany({ select: { title: true, company: { select: { name: true } } } }),
  ]);
  return (
    <>
      <h1 className="h1">New interview</h1>
      <p className="hint">Give company, country and date. The whole timeline (script, shoot, edit, QC, handover, ads, call broadcast) is made automatically, and each person is told on their day.</p>
      <Flash sp={sp} />
      <form className="card stack" action={createInterviewAction} style={{ maxWidth: 640 }}>
        <NewInterviewPreview
          companies={companies.map((c) => ({ id: c.id, name: c.name }))}
          settings={settings}
          existing={names.map((n) => ({ name: n.title ?? "", agency: n.company.name }))}
        />
        <label className="field">Marketing plan ($, optional)<input name="marketingPlanUsd" type="number" step="1" min="0" /></label>
        <label className="field">Notes (optional)<textarea name="notes" /></label>
        <button className="btn primary">Create timeline</button>
      </form>
    </>
  );
}
