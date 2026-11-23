// Live location while checked in. Runs as an Android FOREGROUND SERVICE: the phone shows a
// notification the whole time it runs, and it only needs the normal "while using the app"
// location permission (no "allow all the time" / background location permission).
// It is started from the app (after the person agreed on the notice) when they check in,
// and stops when they check out, turn it off, or the server answers { track: false }.
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as SecureStore from "expo-secure-store";

export const LOC_TASK = "cma-live-location";
export const CFG_KEY = "cma_loc_cfg"; // { url, token }
export const CONSENT_KEY = "cma_loc_consent"; // "yes" after the person agreed on the notice

type Cfg = { url: string; token: string };

async function cfg(): Promise<Cfg | null> {
  try { return JSON.parse((await SecureStore.getItemAsync(CFG_KEY)) ?? "null"); } catch { return null; }
}

export async function stopSharing() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOC_TASK)) await Location.stopLocationUpdatesAsync(LOC_TASK);
  } catch { /* not running */ }
}

/** Tell the server why the phone stopped by itself (so the admin sees it), then stop. */
async function stopWith(why: string) {
  const c = await cfg();
  if (c) {
    fetch(c.url + "/api/location", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + c.token }, body: JSON.stringify({ stop: why }),
    }).catch(() => {});
  }
  await stopSharing();
}

TaskManager.defineTask(LOC_TASK, async ({ data, error }) => {
  if (error) {
    // Location was turned off or the permission was taken away on the phone.
    await stopWith("Location stopped on the phone: " + String(error.message ?? error).slice(0, 80));
    return;
  }
  const locs = ((data as { locations?: Location.LocationObject[] })?.locations ?? []);
  const c = await cfg();
  if (!c) { await stopSharing(); return; }
  const points = locs.map((l) => ({ at: l.timestamp, lat: l.coords.latitude, lng: l.coords.longitude, acc: l.coords.accuracy }));
  try {
    const r = await fetch(c.url + "/api/location", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + c.token },
      body: JSON.stringify({ points }),
    });
    if (r.status === 401) { await stopSharing(); return; }
    const j = (await r.json().catch(() => ({}))) as { track?: boolean };
    if (j.track === false) await stopSharing(); // checked out, turned off by the rules, office time over
  } catch {
    // No internet right now: this point is skipped, the next one is tried as usual.
  }
});

/** Start sharing (the page already checked the rules and the person agreed). */
export async function startSharing(c: Cfg, everyMin: number) {
  await SecureStore.setItemAsync(CFG_KEY, JSON.stringify(c));
  const every = Math.max(1, Math.min(30, everyMin || 5)) * 60_000;
  await stopSharing(); // restart with the newest interval
  await Location.startLocationUpdatesAsync(LOC_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: every,
    distanceInterval: 0,
    deferredUpdatesInterval: every,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: "CMA Office: sharing your location",
      notificationBody: "Only while you are checked in. It stops when you check out.",
      notificationColor: "#4a74b0",
      killServiceOnDestroy: false,
    },
  });
}
