import { describe, it, expect } from "vitest";
import { planTimeline, isoDay, broadcastDays, DEFAULT_TIMELINE } from "../src/timeline";
import { normalizeCompanyName, findDuplicateNames } from "../src/companyName";
import { statusCheck, countReport, ordinal } from "../src/logsheet";
import { canAccess, defaultModuleAccess } from "../src/access";

describe("timeline", () => {
  it("counts back from the interview (Coastal, Malaysia, 9 Dec)", () => {
    const p = planTimeline("2026-12-09");
    expect(isoDay(p.adsStart)).toBe("2026-12-02");
    expect(isoDay(p.handover)).toBe("2026-12-01");
    expect(isoDay(p.shoot)).toBe("2026-11-28");
    expect(isoDay(p.writerStart)).toBe("2026-11-26");
    const due = Object.fromEntries(p.steps.map((s) => [s.key, isoDay(s.dueDate)]));
    expect(due).toEqual({
      script: "2026-11-27",
      script_approve: "2026-11-27",
      shoot_slot: "2026-11-27",
      shoot: "2026-11-28",
      raw_upload: "2026-11-29",
      edit: "2026-11-30",
      qc: "2026-12-01",
      handover: "2026-12-01",
      publish: "2026-12-02",
      ads: "2026-12-02",
    });
  });
  it("never has a due date before its start, even with tight settings", () => {
    const p = planTimeline("2026-12-09", { ...DEFAULT_TIMELINE, writerDaysBeforeAds: 2, shootDaysBeforeHandover: 1 });
    for (const s of p.steps) expect(s.dueDate >= s.startDate).toBe(true);
  });
  it("broadcast: 4 days before plus interview day", () => {
    expect(broadcastDays("2026-12-09").map((d) => isoDay(d.date))).toEqual([
      "2026-12-05", "2026-12-06", "2026-12-07", "2026-12-08", "2026-12-09",
    ]);
  });
});

describe("company name check", () => {
  it("treats & as and and ignores punctuation/case", () => {
    expect(normalizeCompanyName("Al-Habib & Sons Ltd.")).toBe("alhabibandsonsltd");
    const dup = findDuplicateNames("al habib and sons ltd", [
      { name: "Al-Habib & Sons Ltd.", agency: "Coastal Manpower", row: 12 },
      { name: "Other", agency: "SM Enterprise" },
    ]);
    expect(dup).toHaveLength(1);
  });
  it("keeps Bangla letters", () => {
    expect(normalizeCompanyName("রহমান ট্রেডার্স")).not.toBe("");
  });
});

describe("log sheet", () => {
  const rows = [
    { date: "2026-11-18", title: "A", status: "On Edit", company: "Coastal Manpower", contentType: "Interview" },
    { date: "2026-11-17", title: "B", status: "Uploaded", company: "Coastal Manpower", contentType: "Interview" },
    { date: "2026-11-16", title: "C", status: "Script Ready", company: "SM Enterprise", contentType: "Bio" },
    { date: "2026-09-01", title: "D", status: "On Edit", company: "SM Enterprise", contentType: "Bio" },
  ];
  it("status check = open rows, last 35 days, newest first", () => {
    expect(statusCheck(rows, "2026-11-18").map((r) => r.title)).toEqual(["A", "C"]);
  });
  it("report counts and ranks", () => {
    const t = countReport(rows, (r) => r.company, { from: "2026-11-01", to: "2026-11-18", today: "2026-11-18" });
    expect(t.totals).toEqual({ "Coastal Manpower": 2, "SM Enterprise": 1 });
    expect(t.rank["Coastal Manpower"]).toBe(1);
    expect(t.today["Coastal Manpower"]).toBe(1);
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(23)).toBe("23rd");
  });
});

describe("access", () => {
  it("super admin sees everything, staff cannot see recruitment by default", () => {
    expect(canAccess("SUPER_ADMIN", {}, "monitor", "EDIT")).toBe(true);
    const staff = defaultModuleAccess("STAFF");
    expect(canAccess("STAFF", staff, "recruitment")).toBe(false);
    expect(canAccess("STAFF", staff, "tasks", "EDIT")).toBe(true);
  });
});
