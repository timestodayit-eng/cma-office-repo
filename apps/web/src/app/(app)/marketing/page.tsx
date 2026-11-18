import Link from "next/link";
import { addDays, VIDEO_CHAIN } from "@cma/core";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { fmtDay, todayDhaka, initials } from "@/lib/format";
import { getTimelineSettings } from "@/lib/workflow";
import { getSheetConfig } from "@/lib/outbox";
import { AgPill } from "@/components/BcCard";
import { Flash } from "@/components/TaskCard";
import { SyncBar } from "@/components/SyncBar";
import { startTimelineAction } from "@/app/actions";

const STAGE: Record<string, [string, string]> = {
  script: ["Script", "p-grey"], script_approve: ["Script check", "p-violet"], shoot_slot: ["Shoot slot", "p-grey"], shoot: ["Shoot", "p-grey"],
  raw_upload: ["Raw upload", "p-grey"], edit: ["Editing", "p-amber"], qc: ["QC", "p-violet"], handover: ["For review", "p-violet"],
  publish: ["Approved", "p-good"], ads: ["Published", "p-good"],
};

/** Every coming interview (from the sheet or the app) with where its video stands and when ads start. */
export default async function Marketing({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const u = await requireModule("marketing");
  const sp = await searchParams;
  const today = todayDhaka();
  const [ivs, tl, cfg, done] = await Promise.all([
    prisma.interview.findMany({
      where: { OR: [{ interviewDate: { gte: today } }, { tasks: { some: { chain: "video", status: { in: ["TODO", "IN_PROGRESS", "WAITING"] } } } }] },
      include: { company: true, tasks: { where: { chain: "video" }, orderBy: { order: "asc" }, include: { assignee: true } } },
      orderBy: { interviewDate: "asc" },
      take: 60,
    }),
    getTimelineSettings(),
    getSheetConfig(),
    prisma.interview.findMany({ where: { interviewDate: { lte: today }, passports: { gt: 0 } }, select: { passports: true, totalCostBdt: true } }),
  ]);
  const pc = done.reduce((a, r) => a + (r.passports ?? 0), 0);
  const bdt = done.reduce((a, r) => a + Number(r.totalCostBdt ?? 0), 0);
  const adsDone = (iv: (typeof ivs)[number]) => iv.tasks.some((t) => t.stepKey === "ads" && t.status === "DONE");
  const running = ivs.filter(adsDone).length;
  const canStart = u.can("interviews", "EDIT");
  return (
    <>
      <h1 className="h1">Marketing</h1>
      <Flash sp={sp} />
      <SyncBar last={cfg.last?.recruitment} label="the Recruitment Google Sheet" />
      <div className="stats three">
        <div className="stat"><b>{ivs.length - running}</b><span>Coming / handed</span></div>
        <div className="stat"><b>{running}</b><span>Running / done</span></div>
        <div className="stat"><b>৳{pc ? Math.round(bdt / pc).toLocaleString("en-US") : "—"}</b><span>CPP (synced)</span></div>
      </div>
      <div className="h2">Final approval and ads</div>
      {!ivs.length && <div className="empty">No coming interviews yet. They appear here when they are added in the app or typed in the Recruitment sheet.</div>}
      <div className="grid">
        {ivs.map((iv) => {
          const ads = addDays(iv.interviewDate, -tl.adsDaysBefore);
          const cur = iv.tasks.find((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
          const stage = adsDone(iv) ? ["Ads running", "p-good"] : cur?.stepKey ? STAGE[cur.stepKey] : null;
          const late = cur?.dueDate && cur.dueDate < today;
          return (
            <div className="task" key={iv.id}>
              <div className="meta">
                <AgPill short={iv.company.short} name={iv.company.name} />
                {stage ? <span className={`pill ${stage[1]}`}>{stage[0]}</span> : <span className="pill p-grey">No timeline yet</span>}
                <span style={{ marginLeft: "auto" }}>
                  {late ? <span className="pill p-bad">Late · {fmtDay(cur!.dueDate)}</span> : cur?.dueDate ? <span>Due {fmtDay(cur.dueDate)}</span> : null}
                </span>
              </div>
              <Link href={`/interviews/${iv.id}`} className="t">{iv.title}</Link>
              <div className="meta">Interview {fmtDay(iv.interviewDate)} · Ads from {fmtDay(ads)}{iv.country ? ` · ${iv.country}` : ""}</div>
              {cur && (
                <div className="meta"><span className="av sm">{initials(cur.assignee?.name ?? "?")}</span>{cur.assignee?.name ?? "Not assigned"} · {cur.title}</div>
              )}
              {iv.tasks.length > 0 ? (
                <div className="chain">
                  {VIDEO_CHAIN.map((st) => {
                    const t = iv.tasks.find((x) => x.stepKey === st.key);
                    const c = !t ? "" : t.status === "DONE" || t.status === "SKIPPED" ? "done" : t.status === "WAITING" ? "" : "cur";
                    return <i key={st.key} className={c} title={st.title} />;
                  })}
                </div>
              ) : canStart ? (
                <form action={startTimelineAction}>
                  <input type="hidden" name="id" value={iv.id} />
                  <input type="hidden" name="back" value="marketing" />
                  <button className="btn sm">Start the video timeline</button>
                </form>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
