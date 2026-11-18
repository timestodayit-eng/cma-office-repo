import type { User } from "@prisma/client";
import type { BcGroup } from "@/lib/broadcast";
import { fmtDay } from "@/lib/format";
import { tickBroadcastAction } from "@/app/logActions";

export const AGENCY_COLOR: Record<string, string> = { CI: "#4a74b0", CM: "#3a8a63", SM: "#b7792a" };

export function AgPill({ short, name }: { short: string; name: string }) {
  const c = AGENCY_COLOR[short] ?? "#4a74b0";
  return <span className="pill" style={{ background: `${c}1f`, color: c }}>{name}</span>;
}

/** One call day: 1. Missed call sent, 2. Received call sent, SMS sent. */
export function BcCard({ g, today, officer, meId, canEdit, back }: { g: BcGroup; today: Date; officer?: User; meId: string; canEdit: boolean; back: string }) {
  const mine = officer?.id === meId;
  const isToday = g.date.getTime() === today.getTime();
  const dueToday = g.due.getTime() === today.getTime();
  const B = ({ field, on, label }: { field: string; on: boolean; label: string }) => (
    <button className={`btn sm${on ? " good" : ""}`} name="field" value={field} disabled={field === "received" && !g.missed && !on}>{on ? "✓ " : ""}{label}</button>
  );
  return (
    <div className={`task${mine && !g.done ? " mine" : ""}`}>
      <div className="meta">
        <AgPill short={g.company.short} name={g.company.name} />
        <span className="pill p-grey mono">{g.slot}{g.slots.length > 1 ? " · Bridge" : ""}</span>
        <span style={{ marginLeft: "auto" }}>
          {g.done ? <span className="pill p-good">Sent</span>
            : isToday ? <span className="pill p-bad">Call is today</span>
            : dueToday ? <span className="pill p-amber">Send today</span>
            : <span>Send {fmtDay(g.due)}</span>}
        </span>
      </div>
      <div className="t">Call broadcast for {fmtDay(g.date)}</div>
      <div className="meta"><span>{g.slots.map((s) => `${(s.interview.title ?? "").replace(/\s+/g, " ")} (interview ${fmtDay(s.interview.interviewDate)})`).join(" + ")}</span></div>
      <div className="meta"><span>Hotline series {g.company.hotlines.join(" / ")}</span><span>·</span><span>Missed first, Received 3 hours later</span></div>
      <div className="meta"><span className="av sm">{(officer?.name ?? "?")[0]}</span><span>{officer ? officer.name : "No broadcast officer set (Settings)"}{mine ? " (you)" : ""}</span></div>
      {mine || canEdit ? (
        <form action={tickBroadcastAction} className="row">
          <input type="hidden" name="ids" value={g.slots.map((s) => s.id).join(",")} />
          <input type="hidden" name="back" value={back} />
          <B field="missed" on={g.missed} label={g.missed ? "Missed call sent" : "1. Missed call sent"} />
          <B field="received" on={g.received} label={g.received ? "Received call sent" : "2. Received call sent"} />
          <B field="sms" on={g.sms} label="SMS sent" />
        </form>
      ) : (
        <div className="meta">
          <span className={`pill ${g.missed ? "p-good" : "p-amber"}`}>Missed {g.missed ? "sent" : "pending"}</span>
          <span className={`pill ${g.received ? "p-good" : "p-amber"}`}>Received {g.received ? "sent" : "pending"}</span>
          <span className={`pill ${g.sms ? "p-good" : "p-grey"}`}>SMS {g.sms ? "sent" : "not sent"}</span>
        </div>
      )}
    </div>
  );
}
