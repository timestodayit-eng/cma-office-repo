import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { todayDhaka, initials, fmtDay } from "@/lib/format";
import { Flash } from "@/components/TaskCard";
import { LiveView } from "@/components/Monitor";
import { closeSilentSessions, getMonitorRules, SILENT_MS, mb, dur } from "@/lib/monitor";
import { monSaveRulesAction, monDeleteAction } from "@/app/monitorActions";

const DL = "https://github.com/timestodayit-eng/cma-office-repo/releases/tag/desktop-latest";
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dhakaStart = (day: Date) => new Date(day.getTime() - 6 * 3600_000);
const tm = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "numeric", minute: "2-digit", hour12: true }).format(d) : "");
/** "3 minutes ago", "2 hours ago", "4 days ago" — for a device's last-online time. */
function ago(d: Date): string {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
  const days = Math.round(h / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

export default async function Monitor({ searchParams }: { searchParams: Promise<{ tab?: string; user?: string; day?: string; live?: string; e?: string; ok?: string }> }) {
  const u = await requireUser();
  // Only the Work Monitor admins (Khalid and Jamil: super admins, or the "Work Monitor admin" duty).
  if (!u.has("monitor")) redirect("/?denied=monitor");
  const sp = await searchParams;
  await closeSilentSessions();
  const rules = await getMonitorRules();
  const tab = sp.live ? "live" : sp.user ? "person" : sp.tab === "settings" ? "settings" : sp.tab === "devices" ? "devices" : "now";
  const Tabs = (
    <div className="chips" style={{ marginBottom: 4 }}>
      <Link className="chip" href="/monitor" aria-current={tab === "now" ? "page" : undefined}>Now</Link>
      <Link className="chip" href="/monitor?tab=devices" aria-current={tab === "devices" ? "page" : undefined}>Devices</Link>
      <Link className="chip" href="/monitor?tab=settings" aria-current={tab === "settings" ? "page" : undefined}>Rules &amp; storage</Link>
      <a className="chip" href={DL} target="_blank" rel="noreferrer">Download the desktop app ↗</a>
    </div>
  );

  if (tab === "live") {
    const p = await prisma.user.findUnique({ where: { id: sp.live! }, select: { id: true, name: true } });
    if (!p) redirect("/monitor");
    return (
      <>
        <h1 className="h1">Work Monitor</h1>
        {Tabs}
        <Link href={`/monitor?user=${p.id}`} className="small">‹ Back to {p.name}</Link>
        {rules.live ? <LiveView userId={p.id} name={p.name} /> : <div className="warn">Live view is turned off. Turn it on in Rules &amp; storage.</div>}
      </>
    );
  }

  if (tab === "person") {
    const p = await prisma.user.findUnique({ where: { id: sp.user! }, select: { id: true, name: true, designation: true } });
    if (!p) redirect("/monitor");
    const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? new Date(sp.day + "T00:00:00Z") : todayDhaka();
    const from = dhakaStart(day);
    const to = new Date(from.getTime() + 86_400_000);
    const [sessions, shots, samples] = await Promise.all([
      prisma.workSession.findMany({ where: { userId: p.id, startedAt: { gte: from, lt: to } }, orderBy: { startedAt: "asc" } }),
      prisma.screenshot.findMany({ where: { userId: p.id, takenAt: { gte: from, lt: to } }, orderBy: { takenAt: "asc" } }),
      prisma.activitySample.findMany({ where: { userId: p.id, at: { gte: from, lt: to } }, select: { app: true, title: true, idle: true } }),
    ]);
    const working = sessions.find((s) => !s.endedAt && Date.now() - s.lastBeatAt.getTime() < SILENT_MS);
    const active = sessions.reduce((a, s) => a + s.activeSec, 0);
    const idle = sessions.reduce((a, s) => a + s.idleSec, 0);
    const apps = new Map<string, number>();
    const titles = new Map<string, number>();
    for (const s of samples) {
      if (s.idle) continue;
      const a = s.app || "Unknown";
      apps.set(a, (apps.get(a) ?? 0) + 1);
      if (s.title) { const k = `${a} — ${s.title}`; titles.set(k, (titles.get(k) ?? 0) + 1); }
    }
    const top = [...apps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topTitles = [...titles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const busiest = top[0]?.[1] ?? 1;
    return (
      <>
        <h1 className="h1">Work Monitor</h1>
        <Flash sp={sp} />
        {Tabs}
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="av">{initials(p.name)}</span>
          <span className="grow"><b>{p.name}</b><span className="small muted"> · {p.designation ?? ""}</span></span>
          {working ? <span className="pill p-good">Working since {tm(working.startedAt)}</span> : <span className="pill p-grey">Not working now</span>}
          {working && rules.live && <Link className="btn sm primary" href={`/monitor?live=${p.id}`}>● Live screen</Link>}
        </div>
        <form className="row" style={{ gap: 8 }}>
          <input type="hidden" name="user" value={p.id} />
          <input type="date" name="day" defaultValue={iso(day)} max={iso(todayDhaka())} className="inp" style={{ width: "auto" }} />
          <button className="btn sm">Show</button>
        </form>
        <div className="stats">
          <div className="stat"><b>{dur(active + idle)}</b><span>In work sessions</span></div>
          <div className="stat"><b>{dur(active)}</b><span>Active (mouse / keyboard)</span></div>
          <div className="stat"><b>{dur(idle)}</b><span>Idle (no input {rules.idleMin}+ min)</span></div>
          <div className="stat"><b>{shots.length}</b><span>Screenshots</span></div>
        </div>
        <div className="card">
          <b>Work sessions</b>
          {sessions.length === 0 && <p className="hint">No work session on this day.</p>}
          {sessions.map((s) => (
            <div key={s.id} className="row small" style={{ gap: 8 }}>
              <span className="mono">{tm(s.startedAt)} – {s.endedAt ? tm(s.endedAt) : "now"}</span>
              <span className="muted">active {dur(s.activeSec)} · idle {dur(s.idleSec)}</span>
              {s.endReason && s.endReason !== "stop" && <span className="pill p-grey">{({ lock: "PC locked / slept", quit: "app closed", silent: "app stopped reporting", logout: "logged out", restart: "started again" } as Record<string, string>)[s.endReason] ?? s.endReason}</span>}
              {s.device && <span className="muted">{s.device}</span>}
            </div>
          ))}
        </div>
        {top.length > 0 && (
          <div className="card">
            <b>Apps used (active minutes)</b>
            {top.map(([a, n]) => (
              <div key={a} className="row small" style={{ gap: 8 }}>
                <span style={{ width: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a}</span>
                <span style={{ flex: 1, display: "block", background: "var(--line)", borderRadius: 6, height: 8 }}><span style={{ display: "block", width: `${(n / busiest) * 100}%`, height: 8, borderRadius: 6, background: "var(--pri)" }} /></span>
                <span className="mono">{dur(n * 60)}</span>
              </div>
            ))}
            <details>
              <summary className="small">Window titles</summary>
              {topTitles.map(([k, n]) => <div key={k} className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span className="mono">{dur(n * 60)}</span> · {k}</div>)}
            </details>
          </div>
        )}
        <div className="card">
          <div className="row"><b className="grow">Screenshots</b>{shots.length > 0 && <span className="small muted">{mb(shots.reduce((a, s) => a + s.bytes, 0))}</span>}</div>
          {shots.length === 0 && <p className="hint">No screenshots on this day.</p>}
          <div className="shotgrid">
            {shots.map((s) => (
              <a key={s.id} href={`/api/monitor/shot/${s.id}`} target="_blank" rel="noreferrer" className="shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/monitor/shot/${s.id}`} alt={`Screen at ${tm(s.takenAt)}`} loading="lazy" />
                <span className="small"><b>{tm(s.takenAt)}</b>{s.screen > 0 ? ` · screen ${s.screen + 1}` : ""} · {s.app ?? ""}</span>
              </a>
            ))}
          </div>
          {shots.length > 0 && (
            <form action={monDeleteAction} className="row small" style={{ gap: 8 }}>
              <input type="hidden" name="userId" value={p.id} /><input type="hidden" name="from" value={iso(day)} /><input type="hidden" name="to" value={iso(day)} /><input type="hidden" name="return" value="person" />
              <label className="row" style={{ gap: 4 }}><input type="checkbox" name="sure" />Yes, delete</label>
              <button className="btn sm bad">Delete this day&apos;s screenshots of {p.name.split(" ")[0]}</button>
            </form>
          )}
        </div>
      </>
    );
  }

  if (tab === "devices") {
    const devices = await prisma.device.findMany({ orderBy: { lastSeenAt: "desc" } });
    const people = await prisma.user.findMany({ where: { id: { in: devices.map((d) => d.userId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
    const name = new Map(people.map((p) => [p.id, p.name]));
    const onlineN = devices.filter((d) => Date.now() - d.lastSeenAt.getTime() < SILENT_MS).length;
    return (
      <>
        <h1 className="h1">Work Monitor</h1>
        <Flash sp={sp} />
        {Tabs}
        <div className="stats">
          <div className="stat"><b>{devices.length}</b><span>Company devices</span></div>
          <div className="stat"><b>{onlineN}</b><span>Online now</span></div>
        </div>
        <p className="hint">Every computer with the CMA Office desktop app reports itself while the app is open — even when nobody has pressed Start work. Use this to find a lost or stolen office laptop by its last-online time and last known area. Area is from the internet connection (city level), not GPS.</p>
        {devices.length === 0 && <p className="hint">No device has reported yet. Devices appear here after the desktop app is installed and someone logs in.</p>}
        <div className="grid">
          {devices.map((d) => {
            const online = Date.now() - d.lastSeenAt.getTime() < SILENT_MS;
            const place = [d.city, d.region, d.country].filter(Boolean).join(", ");
            const maps = d.lat != null && d.lng != null ? `https://www.google.com/maps?q=${d.lat},${d.lng}` : place ? `https://www.google.com/maps?q=${encodeURIComponent(place)}` : null;
            return (
              <div key={d.id} className="card">
                <div className="row" style={{ gap: 8 }}>
                  <span className="grow"><b>{d.machineName || "Unknown computer"}</b>{d.platform ? <span className="small muted"> · {d.platform}{d.osVersion ? ` ${d.osVersion}` : ""}</span> : null}</span>
                  {online ? <span className="pill p-good">Online</span> : <span className="pill p-grey">Offline</span>}
                </div>
                <div className="small muted">Last user: {d.userId ? name.get(d.userId) ?? "Former staff" : "—"}</div>
                <div className="small muted">Last online: {online ? "now" : ago(d.lastSeenAt)} · {tm(d.lastSeenAt)}, {fmtDay(d.lastSeenAt)}</div>
                <div className="small muted">
                  Location: {place || "unknown"}
                  {maps ? <> · <a href={maps} target="_blank" rel="noreferrer">map ↗</a></> : null}
                </div>
                {d.publicIp ? <div className="small muted mono">IP {d.publicIp}</div> : null}
                {d.appVersion ? <div className="small muted">App v{d.appVersion}</div> : null}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  if (tab === "settings") {
    const [people, total, per, oldest] = await Promise.all([
      prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.screenshot.aggregate({ _sum: { bytes: true }, _count: true }),
      prisma.screenshot.groupBy({ by: ["userId"], _sum: { bytes: true }, _count: true }),
      prisma.screenshot.findFirst({ orderBy: { takenAt: "asc" }, select: { takenAt: true } }),
    ]);
    const name = new Map(people.map((p) => [p.id, p.name]));
    return (
      <>
        <h1 className="h1">Work Monitor</h1>
        <Flash sp={sp} />
        {Tabs}
        <form action={monSaveRulesAction} className="card">
          <b>Screenshot rules</b>
          <p className="hint">The desktop app takes a picture of the screen at a random moment between these two times, only while the person has pressed Start work.</p>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <label className="field">Every (min) from<input type="number" name="minMin" min={1} max={60} defaultValue={rules.minMin} className="inp" /></label>
            <label className="field">to (min)<input type="number" name="maxMin" min={1} max={120} defaultValue={rules.maxMin} className="inp" /></label>
            <label className="field">Idle after (min without mouse/keyboard)<input type="number" name="idleMin" min={1} max={60} defaultValue={rules.idleMin} className="inp" /></label>
            <label className="field">Delete screenshots after (days, 0 = never)<input type="number" name="keepDays" min={0} max={365} defaultValue={rules.keepDays} className="inp" /></label>
          </div>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="live" defaultChecked={rules.live} />Allow live screen view (only while the person is working; they see a notice)</label>
          <button className="btn primary" style={{ alignSelf: "flex-start" }}>Save rules</button>
        </form>
        <div className="card">
          <b>Storage</b>
          <div className="stats">
            <div className="stat"><b>{total._count}</b><span>Screenshots</span></div>
            <div className="stat"><b>{mb(total._sum.bytes ?? 0)}</b><span>Space used</span></div>
            <div className="stat"><b>{oldest ? fmtDay(oldest.takenAt) : "—"}</b><span>Oldest</span></div>
          </div>
          {per.sort((a, b) => (b._sum.bytes ?? 0) - (a._sum.bytes ?? 0)).map((r) => (
            <div key={r.userId} className="row small" style={{ gap: 8 }}><span className="grow">{name.get(r.userId) ?? "Former staff"}</span><span>{r._count} pictures</span><span className="mono">{mb(r._sum.bytes ?? 0)}</span></div>
          ))}
          <p className="hint">{rules.keepDays > 0 ? `Screenshots older than ${rules.keepDays} days are deleted by themselves.` : "Auto-delete is off: screenshots stay until you delete them."} One picture is about 100–200 KB.</p>
        </div>
        <form action={monDeleteAction} className="card">
          <b>Delete screenshots</b>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <label className="field">Person<select name="userId" className="inp" defaultValue=""><option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="field">From day<input type="date" name="from" className="inp" /></label>
            <label className="field">To day<input type="date" name="to" className="inp" /></label>
          </div>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="all" />Everything (no dates, no person chosen)</label>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="sure" />Yes, delete these screenshots for good</label>
          <button className="btn bad" style={{ alignSelf: "flex-start" }}>Delete</button>
          <p className="hint">Work times and app usage stay; only the pictures are deleted.</p>
        </form>
      </>
    );
  }

  // Now: everyone, who is working, latest picture, today's time.
  const today = todayDhaka();
  const from = dhakaStart(today);
  const [people, sessions, lastShots, lastApps] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true } }),
    prisma.workSession.findMany({ where: { OR: [{ startedAt: { gte: from } }, { endedAt: null }] } }),
    prisma.screenshot.findMany({ where: { takenAt: { gte: from } }, orderBy: { takenAt: "desc" }, distinct: ["userId"], select: { id: true, userId: true, takenAt: true, app: true } }),
    prisma.activitySample.findMany({ where: { at: { gte: new Date(Date.now() - 10 * 60_000) } }, orderBy: { at: "desc" }, distinct: ["userId"], select: { userId: true, app: true, title: true, idle: true } }),
  ]);
  const shotBy = new Map(lastShots.map((s) => [s.userId, s]));
  const appBy = new Map(lastApps.map((s) => [s.userId, s]));
  const rows = people.map((p) => {
    const mine = sessions.filter((s) => s.userId === p.id);
    const open = mine.find((s) => !s.endedAt && Date.now() - s.lastBeatAt.getTime() < SILENT_MS);
    const secs = mine.reduce((a, s) => a + s.activeSec + s.idleSec, 0);
    const active = mine.reduce((a, s) => a + s.activeSec, 0);
    return { p, open, secs, active, shot: shotBy.get(p.id), app: appBy.get(p.id), used: mine.length > 0 };
  });
  rows.sort((a, b) => Number(!!b.open) - Number(!!a.open) || Number(b.used) - Number(a.used) || a.p.name.localeCompare(b.p.name));
  const workingN = rows.filter((r) => r.open).length;
  const idleN = rows.filter((r) => r.open && r.app?.idle).length;
  return (
    <>
      <h1 className="h1">Work Monitor</h1>
      <Flash sp={sp} />
      {Tabs}
      <div className="stats">
        <div className="stat"><b>{workingN}</b><span>Working now</span></div>
        <div className="stat"><b>{idleN}</b><span>Working but idle</span></div>
        <div className="stat"><b>{rows.filter((r) => r.used).length}</b><span>Worked today</span></div>
        <div className="stat"><b>{rules.minMin}–{rules.maxMin} min</b><span>Screenshot every</span></div>
      </div>
      {rows.every((r) => !r.used) && <p className="hint">Nobody has started work in the desktop app today.</p>}
      <div className="grid">
        {rows.filter((r) => r.used).map(({ p, open, secs, active, shot, app, used }) => (
          <Link key={p.id} href={`/monitor?user=${p.id}`} className="card moncard">
            <div className="row" style={{ gap: 8 }}>
              <span className="av sm">{initials(p.name)}</span>
              <span className="grow"><b>{p.name}</b><span className="small muted"> · {p.designation ?? ""}</span></span>
              {open ? (app?.idle ? <span className="pill p-amber">Idle</span> : <span className="pill p-good">Working</span>) : <span className="pill p-grey">{used ? "Stopped" : "Not started"}</span>}
            </div>
            {shot
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={`/api/monitor/shot/${shot.id}`} alt={`Latest screen of ${p.name}`} loading="lazy" className="monshot" />
              : <div className="monshot empty small muted">No screenshot today</div>}
            <div className="small muted">
              {open ? `Since ${tm(open.startedAt)}` : used ? "Today" : "—"}
              {used && ` · ${dur(secs)} in sessions, ${dur(active)} active`}
              {open && app?.app && ` · now: ${app.app}`}
              {shot && ` · last picture ${tm(shot.takenAt)}`}
            </div>
          </Link>
        ))}
      </div>
      {rows.some((r) => !r.used) && (
        <div className="card">
          <b>Not started today</b>
          <div className="row small" style={{ gap: 6, flexWrap: "wrap" }}>
            {rows.filter((r) => !r.used).map(({ p }) => <Link key={p.id} href={`/monitor?user=${p.id}`} className="chip">{p.name}</Link>)}
          </div>
        </div>
      )}
      <p className="hint">Only you and the other Work Monitor admin can see this page. Staff are told about the monitoring when they install the app and always see when it is on.</p>
    </>
  );
}
