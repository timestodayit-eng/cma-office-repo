"use client";
// Attendance → Live map (Attendance admins only). OpenStreetMap map tiles drawn with Leaflet.
// Live: everyone checked in today with their last point (refreshes every 30 s).
// History: pick a person (and a day) to draw their path with the times.
import { useCallback, useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

type P = { lat: number; lng: number; acc?: number | null; at?: string };
type Person = {
  id: string; name: string; designation: string | null; tracked: boolean;
  status: string | null; checkIn: string | null; checkOut: string | null; late: boolean; method: string | null;
  selfieIn: string | null; selfieOut: string | null; inAt: P | null;
  sharing: boolean; note: string | null; declined: boolean; last: P | null;
};
type Hist = { points: P[]; checkIn: string | null; checkOut: string | null; method: string | null; inAt: P | null; outAt: P | null; selfieIn: string | null; selfieOut: string | null };

/* eslint-disable @typescript-eslint/no-explicit-any */
type L = any;
let Lf: L = null;
/** Leaflet touches `window`, so it is loaded only in the browser. */
async function loadLeaflet(): Promise<L> {
  if (!Lf) { const m: any = await import("leaflet"); Lf = m.default ?? m; }
  return Lf;
}

const t = (s: string | null | undefined) => (s ? new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", hour: "numeric", minute: "2-digit" }).format(new Date(s)) : "");
const ago = (s: string, now: number) => { const m = Math.round((now - new Date(s).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };
const ini = (n: string) => n.replace(/^md\.?\s+/i, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const DHAKA: [number, number] = [23.7806, 90.4078];
const gmaps = (p: P) => `https://www.google.com/maps?q=${p.lat},${p.lng}`;
const gLink = (p: P) => `<br><a href="${gmaps(p)}" target="_blank" rel="noreferrer">Open in Google Maps ↗</a>`;
/** The whole path as Google Maps directions (Google takes up to ~10 stops, so the path is thinned). */
function gPath(pts: P[]) {
  if (pts.length < 2) return pts[0] ? gmaps(pts[0]) : "";
  const step = Math.max(1, Math.ceil(pts.length / 10));
  const pick = pts.filter((_, i) => i % step === 0);
  if (pick[pick.length - 1] !== pts[pts.length - 1]) pick.push(pts[pts.length - 1]);
  return "https://www.google.com/maps/dir/" + pick.slice(0, 11).map((p) => `${p.lat},${p.lng}`).join("/");
}

export function LiveMap({ today, everyMin }: { today: string; everyMin: number }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L>(null);
  const layer = useRef<L>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [now, setNow] = useState(0);
  const [pick, setPick] = useState<string>("");
  const [day, setDay] = useState(today);
  const [hist, setHist] = useState<Hist | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fitted = useRef(false);
  const freshMs = (everyMin * 2 + 3) * 60_000;

  useEffect(() => {
    let dead = false;
    loadLeaflet().then(() => {
      if (dead || !box.current || map.current) return;
      map.current = Lf.map(box.current, { zoomControl: true }).setView(DHAKA, 12);
      Lf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map.current);
      layer.current = Lf.layerGroup().addTo(map.current);
      setNow(Date.now());
    }, () => setErr("The map could not load. Refresh the page."));
    return () => { dead = true; };
  }, []);

  const loadLive = useCallback(async () => {
    const r = await fetch("/api/location/live", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const j = await r.json();
    setPeople(j.people); setNow(j.now);
  }, []);
  useEffect(() => { loadLive(); const i = setInterval(loadLive, 30_000); return () => clearInterval(i); }, [loadLive]);

  useEffect(() => {
    if (!pick) { setHist(null); return; }
    let dead = false;
    fetch(`/api/location/history?userId=${encodeURIComponent(pick)}&date=${day}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (!dead) { setHist(j); fitted.current = false; } }, () => {});
    return () => { dead = true; };
  }, [pick, day, now]);

  // Draw
  useEffect(() => {
    if (!Lf || !map.current || !layer.current) return;
    layer.current.clearLayers();
    const pts: [number, number][] = [];
    const pin = (p: P, cls: string, label: string, pop: string) => {
      pts.push([p.lat, p.lng]);
      return Lf.marker([p.lat, p.lng], { icon: Lf.divIcon({ className: "", html: `<span class="mpin ${cls}">${esc(label)}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] }) }).bindPopup(pop).addTo(layer.current);
    };
    const selfie = (u: string | null) => (u ? `<br><img src="${u}" alt="selfie" style="width:90px;border-radius:8px;margin-top:6px">` : "");
    if (pick && hist) {
      const who = people.find((p) => p.id === pick);
      const line = hist.points.map((p) => [p.lat, p.lng] as [number, number]);
      if (line.length > 1) Lf.polyline(line, { color: "#4a74b0", weight: 4, opacity: 0.8 }).addTo(layer.current);
      hist.points.forEach((p, i) => {
        pts.push([p.lat, p.lng]);
        Lf.circleMarker([p.lat, p.lng], { radius: i === hist.points.length - 1 ? 7 : 4, color: "#fff", weight: 1.5, fillColor: i === hist.points.length - 1 ? "#3a8a63" : "#4a74b0", fillOpacity: 1 })
          .bindTooltip(`${t(p.at)}${p.acc ? ` · ±${Math.round(p.acc)} m` : ""}`).addTo(layer.current);
      });
      if (hist.inAt) pin(hist.inAt, "in", "IN", `<b>${esc(who?.name ?? "")}</b><br>Checked in ${t(hist.checkIn)}${hist.method === "field" ? " (field)" : ""}${selfie(hist.selfieIn)}`);
      if (hist.outAt) pin(hist.outAt, "out", "OUT", `<b>${esc(who?.name ?? "")}</b><br>Checked out ${t(hist.checkOut)}${selfie(hist.selfieOut)}`);
    } else {
      for (const p of people) {
        const at = p.last && p.checkIn && new Date(p.last.at!).getTime() >= new Date(p.checkIn).getTime() ? p.last : null;
        if (at) {
          const live = p.sharing && !p.checkOut && now - new Date(at.at!).getTime() < freshMs;
          pin(at, live ? "live" : "old", ini(p.name), `<b>${esc(p.name)}</b><br>${live ? "Live" : "Last seen"} ${t(at.at)} (${ago(at.at!, now)})${at.acc ? ` · ±${Math.round(at.acc)} m` : ""}${gLink(at)}${selfie(p.selfieIn)}`);
        } else if (p.inAt) {
          pin(p.inAt, "in", ini(p.name), `<b>${esc(p.name)}</b><br>Checked in here ${t(p.checkIn)}${p.method === "field" ? " (field)" : ""}${gLink(p.inAt)}${selfie(p.selfieIn)}`);
        }
      }
    }
    if (pts.length && !fitted.current) {
      fitted.current = true;
      if (pts.length === 1) map.current.setView(pts[0], 16); else map.current.fitBounds(pts, { padding: [40, 40], maxZoom: 17 });
    }
  }, [people, hist, pick, now, freshMs]);

  const inToday = people.filter((p) => p.checkIn);
  const row = (p: Person) => {
    const at = p.last && p.checkIn && new Date(p.last.at!).getTime() >= new Date(p.checkIn).getTime() ? p.last : null;
    const live = !!at && p.sharing && !p.checkOut && now - new Date(at.at!).getTime() < freshMs;
    const state = p.checkOut ? <span className="pill p-grey">Checked out {t(p.checkOut)}</span>
      : p.declined ? <span className="pill p-amber" title={p.note ?? ""}>Location off</span>
      : live ? <span className="pill p-good">● Live</span>
      : at ? <span className="pill p-grey">Last {ago(at.at!, now)}</span>
      : !p.tracked ? <span className="pill p-grey">Not tracked</span>
      : <span className="pill p-grey" title={p.note ?? ""}>No location yet</span>;
    return (
      <div key={p.id} role="button" tabIndex={0} className={`maprow${pick === p.id ? " on" : ""}`} onClick={() => { setPick(pick === p.id ? "" : p.id); fitted.current = false; }} onKeyDown={(e) => { if (e.key === "Enter") { setPick(pick === p.id ? "" : p.id); fitted.current = false; } }}>
        {p.selfieIn ? <img src={p.selfieIn} alt="" className="selfie-thumb" /> : <span className="av sm">{ini(p.name)}</span>}
        <span className="grow"><b>{p.name}</b><span className="small muted">In {t(p.checkIn)}{p.method === "field" ? " · field" : ""}{p.late ? " · late" : ""}</span></span>
        {state}
        {(at ?? p.inAt) && <a className="small" href={gmaps((at ?? p.inAt)!)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open in Google Maps">📍</a>}
      </div>
    );
  };

  return (
    <div className="livemap">
      <div className="card mapcard">
        <div ref={box} className="mapbox" />
        {err && <div className="err">{err}</div>}
      </div>
      <div className="card" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <b className="grow">{pick ? "Path of the day" : `Checked in today · ${inToday.length}`}</b>
          <select className="inp" style={{ width: "auto" }} value={pick} onChange={(e) => { setPick(e.target.value); fitted.current = false; }}>
            <option value="">Everyone (live)</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {pick && <input type="date" className="inp" style={{ width: "auto" }} value={day} max={today} onChange={(e) => { setDay(e.target.value); fitted.current = false; }} />}
        </div>
        {pick && hist && (
          <div className="small">
            {hist.points.length ? <>{hist.points.length} points · {t(hist.points[0].at)} – {t(hist.points[hist.points.length - 1].at)}</> : "No live location points for this day."}
            {hist.checkIn && <> · in {t(hist.checkIn)}</>}{hist.checkOut && <> · out {t(hist.checkOut)}</>}
            {hist.points.length > 0 && <> · <a href={gmaps(hist.points[hist.points.length - 1])} target="_blank" rel="noreferrer">Last place in Google Maps ↗</a> · <a href={gPath(hist.points)} target="_blank" rel="noreferrer">Path in Google Maps ↗</a></>}
            {(hist.selfieIn || hist.selfieOut) && (
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                {hist.selfieIn && <a href={hist.selfieIn} target="_blank" rel="noreferrer"><img src={hist.selfieIn} alt="Check-in selfie" className="selfie-thumb big" /></a>}
                {hist.selfieOut && <a href={hist.selfieOut} target="_blank" rel="noreferrer"><img src={hist.selfieOut} alt="Check-out selfie" className="selfie-thumb big" /></a>}
              </div>
            )}
          </div>
        )}
        {!pick && (inToday.length ? <div className="maplist">{inToday.map(row)}</div> : <p className="hint">Nobody has checked in yet today.</p>)}
        <p className="hint">Green = sent its location in the last {everyMin * 2 + 3} minutes. Location is only sent between check in and check out, with a notification on the person&apos;s phone. Tap a name to see their path.</p>
      </div>
    </div>
  );
}
