"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { attCheckAction, attAddWifiAction, locConsentAction, locResumeAction, locStopAction } from "@/app/attActions";
import { askApp, inApp as isInApp, sendOrder, takeSelfie, type Order, type Shot, type Wifi } from "@/lib/bridge";

/** Ask the CMA Office mobile app which WiFi router the phone is on. Null in a normal browser. */
const readWifi = () => askApp<Wifi>("wifi");

function useInApp() {
  const [inApp, setInApp] = useState<boolean | null>(null);
  useEffect(() => { setInApp(isInApp()); }, []);
  return inApp;
}

/** Give the phone the start/stop order and tell the server what the person chose on the phone's notice. */
async function applyOrder(o: Order | undefined): Promise<string | null> {
  if (!o) return null;
  const a = await sendOrder(o);
  if (!o.on || !a) return null;
  if (a.oldApp) return a.error ?? null; // old app: nothing to record, the person just needs the update
  if (a.on) { await locConsentAction(true); return "Live location is on while you are checked in. You will see a notification on the phone."; }
  if (a.declined) { await locConsentAction(false); return "You did not agree to share your location. Your admin will see that location sharing is off."; }
  if (a.error) { await locConsentAction(false, a.error); return a.error; }
  return null;
}

export function AttButtons({ state, selfie }: { state: "none" | "in" | "done" | "off"; selfie?: { in: boolean; out: boolean; field: boolean } }) {
  const inApp = useInApp();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; e?: string; info?: string | null } | null>(null);
  async function go(kind: "in" | "out") {
    setBusy("Checking the WiFi…"); setMsg(null);
    const wifi = await readWifi();
    // Field staff may be away from the office WiFi: the server decides with the selfie + GPS.
    if (wifi?.error && !selfie?.field) { setMsg({ e: wifi.error }); setBusy(null); return; }
    let shot: Shot | null = null;
    if (kind === "in" ? selfie?.in : selfie?.out) {
      setBusy("Take a selfie…");
      shot = await takeSelfie();
      if (shot?.cancelled) { setMsg({ e: "No selfie, so you are not checked " + kind + ". Tap again to take one." }); setBusy(null); return; }
      if (shot?.error) { setMsg({ e: shot.error }); setBusy(null); return; }
    }
    setBusy(kind === "in" ? "Checking in…" : "Checking out…");
    const r: Awaited<ReturnType<typeof attCheckAction>> = await attCheckAction(kind, wifi, shot).catch(() => ({ e: "Could not reach the server. Check the internet." }));
    const info = r.ok ? await applyOrder(r.track) : null;
    setMsg({ ...r, info }); setBusy(null);
    if (r.ok) router.refresh();
  }
  if (state === "off") return null;
  const note = selfie?.field ? " You can check in away from the office (field work) with a selfie and your location." : selfie?.in ? " A selfie is taken with the front camera." : "";
  return (
    <>
      {inApp === false && state !== "done" && <p className="hint">Check in and check out work in the <b>CMA Office mobile app</b>, on the office WiFi. This is a normal browser, so the buttons are off.</p>}
      {inApp && state !== "done" && note && <p className="hint">{note.trim()}</p>}
      {inApp && state === "none" && <button type="button" className="btn primary big" disabled={!!busy} onClick={() => go("in")}>{busy ?? (selfie?.in ? "📷 Check in with selfie" : "Check in")}</button>}
      {inApp && state === "in" && <button type="button" className="btn big" disabled={!!busy} onClick={() => go("out")}>{busy ?? (selfie?.out ? "📷 Check out with selfie" : "Check out")}</button>}
      {msg?.ok && <div className="ok">{msg.ok}</div>}
      {msg?.info && <div className="hint">{msg.info}</div>}
      {msg?.e && <div className="err">{msg.e}</div>}
    </>
  );
}

/** On every app start while checked in: make sure the phone shares (or stops) as the server says.
 *  Never shows anything in a normal browser. The phone shows its own notice the first time. */
export function TrackSync({ order }: { order: Order }) {
  const sent = useRef("");
  useEffect(() => {
    if (!isInApp()) return;
    const key = order.on ? "on" : "off:" + order.why;
    if (sent.current === key) return;
    sent.current = key;
    applyOrder(order).catch(() => {});
  }, [order]);
  return null;
}

/** "My day": what live location is doing for me, with a button to turn it off or on again. */
export function MyLocation({ status, everyMin, canResume }: { status: "on" | "off-by-me" | "waiting"; everyMin: number; canResume: boolean }) {
  const inApp = useInApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function stop() {
    setBusy(true);
    await sendOrder({ on: false, why: "Turned off by the person" });
    await locStopAction();
    setBusy(false); router.refresh();
  }
  async function resume() {
    setBusy(true); setMsg(null);
    const o = await locResumeAction();
    setMsg(o.on ? await applyOrder(o) : o.why);
    setBusy(false); router.refresh();
  }
  return (
    <div className="locbox">
      <div className="row" style={{ gap: 8 }}>
        <span className={`dot ${status === "on" ? "live" : ""}`} />
        <b className="grow">Live location {status === "on" ? "is on" : status === "off-by-me" ? "is off" : "starts when you check in"}</b>
      </div>
      <p className="hint">
        {status === "off-by-me"
          ? "You turned it off. Your admin sees that location sharing is off."
          : `While you are checked in, the app sends your location every ${everyMin} minute${everyMin > 1 ? "s" : ""} and shows a notification. It stops when you check out. Only HR / the CEO can see it.`}
      </p>
      {inApp && status === "on" && <button type="button" className="btn sm" disabled={busy} onClick={stop} style={{ alignSelf: "flex-start" }}>Turn off</button>}
      {inApp && status === "off-by-me" && canResume && <button type="button" className="btn sm primary" disabled={busy} onClick={resume} style={{ alignSelf: "flex-start" }}>Turn on again</button>}
      {msg && <div className="hint">{msg}</div>}
    </div>
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
