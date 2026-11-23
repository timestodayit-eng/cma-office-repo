// Talking to the CMA Office mobile app from the page (the page runs inside the app's WebView).
// The page posts {type, id, ...}; the app answers with window.__cmaReply(id, answer).
// "wifi" is answered through window.__cmaWifi, which the first app version used.
"use client";

type W = Window & {
  ReactNativeWebView?: { postMessage: (s: string) => void };
  __cmaWifi?: (id: string, a: unknown) => void;
  __cmaReply?: (id: string, a: unknown) => void;
  __cmaWait?: Map<string, (a: unknown) => void>;
};

export const inApp = () => typeof window !== "undefined" && !!(window as W).ReactNativeWebView;

let seq = 0;
/** Ask the app something. Null in a normal browser. Times out with { error } when an old app does not know the question. */
export function askApp<T extends { error?: string }>(type: string, extra: Record<string, unknown> = {}, waitMs = 8000): Promise<T | null> {
  const w = window as W;
  if (!w.ReactNativeWebView) return Promise.resolve(null);
  if (!w.__cmaWait) {
    w.__cmaWait = new Map();
    const done = (id: string, a: unknown) => { const f = w.__cmaWait!.get(id); if (f) { w.__cmaWait!.delete(id); f(a); } };
    w.__cmaReply = done;
    w.__cmaWifi = done;
  }
  return new Promise((resolve) => {
    const id = `${Date.now()}-${++seq}`;
    const t = setTimeout(() => { w.__cmaWait!.delete(id); resolve({ error: "The app did not answer. Update the CMA Office app (new version) and try again." } as T); }, waitMs);
    w.__cmaWait!.set(id, (a) => { clearTimeout(t); resolve(a as T); });
    w.ReactNativeWebView!.postMessage(JSON.stringify({ type, id, ...extra }));
  });
}

export type Wifi = { bssid?: string; ssid?: string; error?: string };
export type Shot = { photo?: string; lat?: number; lng?: number; acc?: number; error?: string; cancelled?: boolean };
export type TrackAnswer = { on?: boolean; declined?: boolean; error?: string; oldApp?: boolean };

const OLD_APP = "This needs the new CMA Office app. Ask your admin for the update, install it, then try again.";
/** 2 = the app with selfie + live location. The first app version does not answer, so it counts as 1. */
export async function appVersion() {
  const a = await askApp<{ v?: number; error?: string }>("ping", {}, 3000);
  return a && !a.error && typeof a.v === "number" ? a.v : 1;
}
export async function takeSelfie(): Promise<Shot | null> {
  if (!inApp()) return null;
  if ((await appVersion()) < 2) return { error: OLD_APP };
  return askApp<Shot>("selfie", {}, 3 * 60_000);
}
export type Order = { on: true; token: string; everyMin: number } | { on: false; why: string };

/** Hand the app a start/stop order for live location. Starting may show the app's notice first (no time limit then). */
export async function sendOrder(o: Order): Promise<TrackAnswer | null> {
  if (!inApp()) return null;
  if ((await appVersion()) < 2) return o.on ? { error: OLD_APP, oldApp: true } : null;
  return o.on
    ? askApp<TrackAnswer>("track", { on: true, token: o.token, everyMin: o.everyMin, url: location.origin }, 10 * 60_000)
    : askApp<TrackAnswer>("track", { on: false, why: o.why });
}
