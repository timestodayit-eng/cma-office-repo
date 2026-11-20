"use client";
import { useEffect, useRef, useState } from "react";

// ---------- inside the desktop app: the Start work / Stop work bar ----------

type DeskState = {
  working: boolean; since?: string; live?: boolean; lastShotAt?: string; error?: string; minMin?: number; maxMin?: number;
  /** New desktop apps: screenshots per 10 minutes, activity % of this 10 minutes, today's and this week's worked seconds. */
  perTen?: number; act?: number; todaySec?: number; weekSec?: number; totalsAt?: string;
};
type Desk = {
  authUser(): Promise<string | null>;
  setAuth(a: { token: string; userId: string; name: string }): Promise<void>;
  state(): Promise<DeskState>;
  onState(cb: (s: DeskState) => void): () => void;
  start(): Promise<DeskState>;
  stop(): Promise<DeskState>;
};
const desk = () => (typeof window === "undefined" ? undefined : (window as Window & { cmaDesktop?: Desk }).cmaDesktop);

const hms = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const hm = (sec: number) => hms(sec).slice(0, -3);
const t = (iso?: string) => (iso ? new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)) : "");

/** Shown only inside the CMA Office desktop app (it adds window.cmaDesktop). */
export function DesktopBar({ userId }: { userId: string }) {
  const [st, setSt] = useState<DeskState | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setNow] = useState(0);

  useEffect(() => {
    const d = desk();
    if (!d) return;
    let off = () => {};
    (async () => {
      // Give the app its own token for this person (once, or when another person logs in).
      if ((await d.authUser()) !== userId) {
        const r = await fetch("/api/monitor/token", { method: "POST" });
        if (r.ok) await d.setAuth(await r.json());
      }
      setSt(await d.state());
      off = d.onState(setSt);
    })().catch(() => setSt({ working: false, error: "The desktop app did not answer." }));
    return () => off();
  }, [userId]);

  useEffect(() => {
    if (!st?.working) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [st?.working]);

  if (!st) return null;
  const extra = st.working && st.totalsAt ? (Date.now() - new Date(st.totalsAt).getTime()) / 1000 : 0;
  const today = typeof st.todaySec === "number" ? st.todaySec + extra : null;
  const week = typeof st.weekSec === "number" ? st.weekSec + extra : null;
  const shotsText = typeof st.perTen === "number"
    ? (st.perTen > 0 ? `${st.perTen} screenshot${st.perTen > 1 ? "s" : ""} every 10 min` : "no screenshots")
    : `screen pictures every ${st.minMin ?? 5}–${st.maxMin ?? 10} min`;
  const go = async (fn: "start" | "stop") => {
    setBusy(true);
    try { setSt(await desk()![fn]()); } finally { setBusy(false); }
  };
  return (
    <div className={`deskbar ${st.working ? "on" : ""}`}>
      <span className="dot" />
      {st.working ? (
        <span className="grow">
          <b>{today != null ? <span className="mono">Today {hms(today)}</span> : <>Tracking since {t(st.since)}</>}</b>
          <span className="small">
            {week != null && ` · week ${hm(week)}`}
            {st.act != null && ` · activity ${st.act}%`}
            {` · ${shotsText}`}{st.lastShotAt ? ` · last ${t(st.lastShotAt)}` : ""}
          </span>
          {st.live && <span className="pill p-bad" style={{ marginLeft: 6 }}>Admin is viewing your screen</span>}
        </span>
      ) : (
        <span className="grow"><b>Timer off</b>{today != null && <span className="small mono"> · today {hm(today)}</span>}<span className="small"> · press Start work when you sit down to work. Nothing is recorded until then.</span></span>
      )}
      {st.error && <span className="small" style={{ color: "var(--bad)" }}>{st.error}</span>}
      {st.working
        ? <button type="button" className="btn sm" disabled={busy} onClick={() => go("stop")}>Stop work</button>
        : <button type="button" className="btn sm primary" disabled={busy} onClick={() => go("start")}>Start work</button>}
    </div>
  );
}

// ---------- admin: live screen ----------

export function LiveView({ userId, name }: { userId: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState("Asking the desktop app for the screen…");
  const [at, setAt] = useState<number | null>(null);
  const url = useRef<string | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch(`/api/monitor/live/${userId}`, { cache: "no-store" });
        if (r.status === 200) {
          const blob = await r.blob();
          const next = URL.createObjectURL(blob);
          if (url.current) URL.revokeObjectURL(url.current);
          url.current = next;
          setSrc(next);
          setAt(Number(r.headers.get("x-frame-at")) || Date.now());
          setState("");
        } else if (r.status === 204) {
          setState((s) => s || "Waiting for the next picture…");
        } else if (r.status === 409) {
          const j = await r.json().catch(() => ({}));
          setState(j.state === "off" ? "Live view is turned off in the rules." : `${name} is not in a work session now. Live view works only while they are working.`);
          setSrc(null);
        } else setState("Not allowed.");
      } catch {
        setState("Cannot reach the server.");
      }
      if (!stop) setTimeout(tick, 1500);
    };
    tick();
    return () => {
      stop = true;
      if (url.current) URL.revokeObjectURL(url.current);
      fetch(`/api/monitor/live/${userId}?stop=1`).catch(() => {});
    };
  }, [userId, name]);

  return (
    <div className="card">
      <div className="row" style={{ gap: 8 }}>
        <span className="pill p-bad">● Live</span>
        <b className="grow">{name}</b>
        {at && <span className="small muted">picture from {new Date(at).toLocaleTimeString()}</span>}
      </div>
      {state && <p className="hint">{state}</p>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt={`Live screen of ${name}`} style={{ width: "100%", borderRadius: 10, border: "1px solid var(--line)" }} />}
      <p className="hint">{name} sees “Admin is viewing your screen” in the app while this page is open. Pictures are not saved.</p>
    </div>
  );
}
