// Time tracker views shared by the admin Work Monitor page and the staff "My time" page.
import Link from "next/link";
import { daySlots, usage, pct, hm, CAT_LABEL, workedByDay, sumDays, type Cats, type Usage } from "@/lib/timetrack";
import { dur } from "@/lib/monitor";
import { monShotDeleteAction, myShotDeleteAction, monSaveCatAction } from "@/app/monitorActions";

const tm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
const hourOf = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "numeric", hour12: true }).format(d);
export const actColor = (p: number | null) => (p == null ? "var(--line)" : p > 60 ? "var(--good)" : p > 20 ? "var(--amber)" : "var(--bad)");
export const actPill = (p: number | null) => (p == null ? <span className="pill p-grey">—</span> : <span className={`pill ${p > 60 ? "p-good" : p > 20 ? "p-amber" : "p-bad"}`}>{p}%</span>);
const END: Record<string, string> = { lock: "PC locked / slept", quit: "app closed", silent: "app stopped reporting", logout: "logged out", restart: "started again" };

/** One person's day: totals, then every 10 minutes with its activity, main app and screenshots. */
export async function Timeline({ userId, day, mode, staffDelete, back }: { userId: string; day: Date; mode: "admin" | "own"; staffDelete: boolean; back: string }) {
  const [{ slots, entries, sessions }, totals] = await Promise.all([daySlots(userId, day), workedByDay(day, day, [userId])]);
  const t = sumDays(totals.get(userId));
  const idleSec = sessions.reduce((a, s) => a + s.idleSec, 0);
  const shots = slots.reduce((a, s) => a + s.shots.length, 0);
  const hours = new Map<string, typeof slots>();
  for (const s of slots) { const h = hourOf(s.at); hours.set(h, [...(hours.get(h) ?? []), s]); }
  const canDelete = mode === "admin" || staffDelete;
  const del = mode === "admin" ? monShotDeleteAction : myShotDeleteAction;
  return (
    <>
      <div className="stats">
        <div className="stat"><b>{hm(t.sec)}</b><span>Worked</span></div>
        <div className="stat"><b>{pct(t) == null ? "—" : `${pct(t)}%`}</b><span>Activity (mouse / keyboard)</span></div>
        <div className="stat"><b>{dur(idleSec)}</b><span>Idle{t.cut ? ` · ${dur(t.cut)} removed` : ""}</span></div>
        <div className="stat"><b>{shots}</b><span>Screenshots{t.manual ? ` · ${dur(t.manual)} manual` : ""}</span></div>
      </div>
      <div className="card">
        <b>Work sessions</b>
        {sessions.length === 0 && <p className="hint">No tracked time on this day.</p>}
        {sessions.map((s) => (
          <div key={s.id} className="row small" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="mono">{tm(s.startedAt)} – {s.endedAt ? tm(s.endedAt) : "now"}</span>
            <span className="muted">{dur(s.activeSec + s.idleSec)} (idle {dur(s.idleSec)})</span>
            {s.endReason && s.endReason !== "stop" && <span className="pill p-grey">{END[s.endReason] ?? s.endReason}</span>}
            {s.device && <span className="muted">{s.device}</span>}
          </div>
        ))}
        {entries.filter((e) => e.status !== "CANCELLED").map((e) => (
          <div key={e.id} className="row small" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="mono">{tm(e.from)} – {tm(e.to)}</span>
            {e.kind === "MANUAL"
              ? <span className={`pill ${e.status === "APPROVED" ? "p-violet" : e.status === "PENDING" ? "p-amber" : "p-grey"}`}>Manual · {e.status === "APPROVED" ? "approved" : e.status === "PENDING" ? "waiting" : "not approved"}</span>
              : <span className="pill p-grey">{e.kind === "CUT_IDLE" ? "Idle removed" : "Screenshot deleted"} · −{dur(e.sec)}</span>}
            {e.reason && e.kind === "MANUAL" && <span className="muted">{e.reason}</span>}
          </div>
        ))}
      </div>
      {slots.length > 0 && (
        <div className="card">
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <b className="grow">Every 10 minutes</b>
            <span className="small muted"><i className="lg" style={{ background: "var(--good)" }} />61–100%</span>
            <span className="small muted"><i className="lg" style={{ background: "var(--amber)" }} />21–60%</span>
            <span className="small muted"><i className="lg" style={{ background: "var(--bad)" }} />0–20%</span>
          </div>
          {[...hours.entries()].map(([h, list]) => (
            <div key={h} className="thour">
              <span className="small mono muted">{h}</span>
              <div className="tslots">
                {list.map((s) => {
                  const p = pct(s);
                  const idle = s.idleMin * 2 > s.min && s.min > 0;
                  return (
                    <div key={s.at.toISOString()} className={`tslot${idle ? " idle" : ""}`}>
                      {s.shots.length ? (
                        <a href={`/api/monitor/shot/${s.shots[0].id}`} target="_blank" rel="noreferrer" className="tshot" title={s.shots[0].title ?? ""}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/monitor/shot/${s.shots[0].id}`} alt={`Screen at ${tm(s.shots[0].takenAt)}`} loading="lazy" />
                          {s.shots.length > 1 && <span className="tcount">+{s.shots.length - 1}</span>}
                        </a>
                      ) : <div className="tshot none small muted">{idle ? "Idle" : "No picture"}</div>}
                      <div className="tact"><i style={{ width: `${p ?? 0}%`, background: actColor(p) }} /></div>
                      <div className="tmeta small">
                        <span className="mono">{tm(s.at)}</span>
                        <b>{p == null ? "—" : `${p}%`}</b>
                      </div>
                      <div className="tapp small muted" title={s.title ?? ""}>{s.site ?? s.app ?? (idle ? "Idle" : "—")}</div>
                      {canDelete && s.shots.map((x) => (
                        <form key={x.id} action={del}>
                          <input type="hidden" name="id" value={x.id} /><input type="hidden" name="return" value={back} />
                          <button className="linkbtn small" title={mode === "own" ? "Deletes the picture and removes these 10 minutes from your time" : "Deletes the picture; the time stays"}>
                            Delete {tm(x.takenAt)}{x.screen > 0 ? ` (screen ${x.screen + 1})` : ""}
                          </button>
                        </form>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {mode === "own" && staffDelete && <p className="hint">If a picture shows something private, delete it. The 10 minutes around it are then removed from your time.</p>}
        </div>
      )}
    </>
  );
}

const CAT_COLOR = { P: "var(--good)", N: "var(--muted)", U: "var(--bad)" } as const;

/** Apps and websites with their minutes; admins can label each one. */
export async function UsageList({ from, to, userId, userIds, dept, cats, admin, back, limit = 25 }: {
  from: Date; to: Date; userId?: string; userIds?: string[]; dept?: string | null; cats: Cats; admin: boolean; back: string; limit?: number;
}) {
  const list = await usage(from, to, { userId, userIds, dept, cats });
  const total = list.reduce((a, u) => a + u.min, 0);
  const by = (c: Usage["cat"]) => list.filter((u) => u.cat === c).reduce((a, u) => a + u.min, 0);
  const top = list[0]?.min ?? 1;
  if (!list.length) return <div className="card"><b>Apps &amp; websites</b><p className="hint">Nothing tracked in these days.</p></div>;
  return (
    <div className="card">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <b className="grow">Apps &amp; websites</b>
        {(["P", "N", "U"] as const).map((c) => <span key={c} className="small muted"><i className="lg" style={{ background: CAT_COLOR[c] }} />{CAT_LABEL[c]} {total ? Math.round((by(c) / total) * 100) : 0}%</span>)}
      </div>
      {list.slice(0, limit).map((u) => (
        <div key={u.name} className="ubar">
          <span className="uname small" title={u.name}>{u.kind === "site" ? "🌐 " : ""}{u.name}</span>
          <span className="utrack"><i style={{ width: `${(u.min / top) * 100}%`, background: CAT_COLOR[u.cat] }} /></span>
          <span className="small mono muted" style={{ textAlign: "right" }}>{dur(u.min * 60)}</span>
          {admin && (
            <form action={monSaveCatAction} className="ucat">
              <input type="hidden" name="name" value={u.name} /><input type="hidden" name="return" value={back} />
              {dept !== undefined && <input type="hidden" name="dept" value={dept ?? ""} />}
              {(["P", "N", "U"] as const).map((c) => (
                <button key={c} name="cat" value={c} className={`catbtn${u.cat === c ? " on" : ""}`} style={u.cat === c ? { background: CAT_COLOR[c] } : undefined} title={`Mark as ${CAT_LABEL[c]}${dept ? ` for ${dept}` : ""}`}>{c}</button>
              ))}
            </form>
          )}
        </div>
      ))}
      {list.length > limit && <p className="hint">{list.length - limit} more not shown.</p>}
      <p className="hint">Websites come from the browser tab title (Chrome, Edge, Firefox), so a site that does not put its name in the title shows under its page name.{admin ? " P / N / U = Productive / Neutral / Unproductive." : ""}</p>
    </div>
  );
}

/** Small link to a person's day. */
export const DayLink = ({ userId, day, children }: { userId: string; day: string; children: React.ReactNode }) => <Link href={`/monitor?user=${userId}&day=${day}`}>{children}</Link>;
