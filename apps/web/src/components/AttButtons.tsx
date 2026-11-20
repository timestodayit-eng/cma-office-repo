"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { attCheckAction, attAddWifiAction } from "@/app/attActions";

type Wifi = { bssid?: string; ssid?: string; error?: string };
type W = Window & { ReactNativeWebView?: { postMessage: (s: string) => void }; __cmaWifi?: (id: string, w: Wifi) => void };

/** Ask the CMA Office mobile app which WiFi router the phone is on. Null in a normal browser. */
function readWifi(): Promise<Wifi | null> {
  const w = window as W;
  if (!w.ReactNativeWebView) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = String(Date.now());
    const t = setTimeout(() => resolve({ error: "The app did not answer. Update the CMA Office app and try again." }), 8000);
    w.__cmaWifi = (rid, wifi) => { if (rid === id) { clearTimeout(t); resolve(wifi); } };
    w.ReactNativeWebView!.postMessage(JSON.stringify({ type: "wifi", id }));
  });
}

function useInApp() {
  const [inApp, setInApp] = useState<boolean | null>(null);
  useEffect(() => { setInApp(!!(window as W).ReactNativeWebView); }, []);
  return inApp;
}

export function AttButtons({ state }: { state: "none" | "in" | "done" | "off" }) {
  const inApp = useInApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; e?: string } | null>(null);
  async function go(kind: "in" | "out") {
    setBusy(true); setMsg(null);
    const wifi = await readWifi();
    const r = wifi?.error ? { e: wifi.error } : await attCheckAction(kind, wifi).catch(() => ({ e: "Could not reach the server. Check the internet." }));
    setMsg(r); setBusy(false);
    if (r.ok) router.refresh();
  }
  if (state === "off") return null;
  return (
    <>
      {inApp === false && state !== "done" && <p className="hint">Check in and check out work in the <b>CMA Office mobile app</b>, on the office WiFi. This is a normal browser, so the buttons are off.</p>}
      {inApp && state === "none" && <button type="button" className="btn primary big" disabled={busy} onClick={() => go("in")}>{busy ? "Checking the WiFi…" : "Check in"}</button>}
      {inApp && state === "in" && <button type="button" className="btn big" disabled={busy} onClick={() => go("out")}>{busy ? "Checking the WiFi…" : "Check out"}</button>}
      {msg?.ok && <div className="ok">{msg.ok}</div>}
      {msg?.e && <div className="err">{msg.e}</div>}
    </>
  );
}

export function SetOfficeWifi() {
  const inApp = useInApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; e?: string } | null>(null);
  if (inApp === false) return <p className="hint">To add the office WiFi, open this page in the <b>CMA Office mobile app</b> while the phone is on the office WiFi. The app reads the router&apos;s MAC ID by itself.</p>;
  if (!inApp) return null;
  return (
    <>
      <button type="button" className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={async () => {
        setBusy(true); setMsg(null);
        const wifi = await readWifi();
        const r = wifi?.error ? { e: wifi.error } : await attAddWifiAction(wifi).catch(() => ({ e: "Could not reach the server." }));
        setMsg(r); setBusy(false);
        if (r.ok) router.refresh();
      }}>{busy ? "Reading the WiFi…" : "Set this WiFi as office"}</button>
      {msg?.ok && <div className="ok">{msg.ok}</div>}
      {msg?.e && <div className="err">{msg.e}</div>}
    </>
  );
}
