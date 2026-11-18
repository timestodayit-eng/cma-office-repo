"use client";
import { useState } from "react";
import { planTimeline, isoDay, findDuplicateNames, type TimelineSettings, type NameRecord } from "@cma/core";

const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);

export function NewInterviewPreview({ companies, settings, existing }: { companies: { id: string; name: string }[]; settings: TimelineSettings; existing: NameRecord[] }) {
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const plan = date ? planTimeline(date, settings) : null;
  const dups = title.length > 2 ? findDuplicateNames(title, existing) : [];
  return (
    <>
      <div className="two">
        <label className="field">Company
          <select name="companyId" required>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="field">Country<input name="country" required placeholder="Malaysia" /></label>
        <label className="field">Interview date<input name="interviewDate" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field">Employer / title (optional)<input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Al Baik Restaurant" /></label>
      </div>
      {dups.length > 0 && (
        <div className="warn"><b>Same name already exists:</b> {dups.map((d) => `${d.name} (${d.agency})`).join(", ")}. You can still continue.</div>
      )}
      {plan && (
        <div className="dates">
          <div><b>{fmt(plan.writerStart)}</b><span>Writer told</span></div>
          <div><b>{fmt(plan.shoot)}</b><span>Shoot</span></div>
          <div><b>{fmt(plan.handover)}</b><span>Handover</span></div>
          <div className="hi"><b>{fmt(plan.adsStart)}</b><span>Ads start</span></div>
          <div className="hi"><b>{fmt(plan.interviewDate)}</b><span>Interview</span></div>
        </div>
      )}
      {plan && plan.writerStart < new Date(isoDay(new Date())) && (
        <div className="warn">The writer start date is already past. Steps will show as late; you can still create it.</div>
      )}
    </>
  );
}
