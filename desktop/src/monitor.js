// Work Monitor engine: runs only between Start work and Stop work.
//  - a screenshot at a random moment every minMin..maxMin minutes (all screens, compressed JPEG)
//  - every 5 seconds: idle time + the app in front; sent once a minute
//  - live view: while an admin's live page is open, a small picture every 1.5 seconds (never saved)
const { desktopCapturer, powerMonitor, screen, net } = require("electron");
const { spawn } = require("node:child_process");
const os = require("node:os");

const TICK_MS = 5000;
const BEAT_MS = 60_000;
const PING_MS = 4000;
const LIVE_MS = 1500;

class Monitor {
  /** @param {{ server: () => string, token: () => string | null, onChange: (s: object) => void, onLiveStart: () => void, onAuthLost: () => void }} o */
  constructor(o) {
    this.o = o;
    this.state = { working: false };
    this.rules = { minMin: 5, maxMin: 10, idleMin: 5, live: true };
    this.sessionId = null;
    this.timers = [];
    this.samples = [];
    this.minute = new Map();
    this.minuteIdle = 0;
    this.minuteTicks = 0;
    this.minuteStart = Date.now();
    this.activeSec = 0;
    this.idleSec = 0;
    this.fg = { app: "", title: "" };
    this.ps = null;
    this.liveOn = false;
    this.liveBusy = false;
  }

  set(patch) {
    this.state = { ...this.state, ...patch, minMin: this.rules.minMin, maxMin: this.rules.maxMin };
    this.o.onChange(this.state);
  }

  async api(action, body, opts = {}) {
    const token = this.o.token();
    if (!token) throw Object.assign(new Error("Log in to CMA Office first."), { auth: true });
    const headers = { authorization: "Bearer " + token, ...(opts.headers || {}) };
    let payload = body;
    if (body && !(body instanceof FormData) && !Buffer.isBuffer(body)) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const r = await net.fetch(this.o.server() + "/api/monitor/agent/" + action, { method: "POST", headers, body: payload });
    if (r.status === 401) {
      this.o.onAuthLost();
      throw Object.assign(new Error("Log in again in CMA Office."), { auth: true });
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Server error " + r.status);
    return j;
  }

  /** Register this computer and report it is online + its area (from its IP).
   *  Runs whenever the app is logged in, even when not working, so a lost or
   *  stolen laptop can be found. Fails quietly when offline or not logged in. */
  async reportDevice(info) {
    if (!this.o.token()) return false;
    try {
      await this.api("device", info);
      return true;
    } catch {
      return false;
    }
  }

  async start() {
    if (this.state.working) return this.state;
    try {
      const r = await this.api("start", { device: os.hostname() });
      this.sessionId = r.sessionId;
      if (r.rules) this.rules = r.rules;
      this.activeSec = 0; this.idleSec = 0; this.samples = [];
      this.resetMinute();
      this.set({ working: true, since: r.startedAt || new Date().toISOString(), error: undefined, live: false, lastShotAt: undefined });
      this.startForeground();
      this.timers.push(setInterval(() => this.tick(), TICK_MS));
      this.timers.push(setInterval(() => this.beat(), BEAT_MS));
      this.timers.push(setInterval(() => this.ping(), PING_MS));
      this.scheduleShot(true);
    } catch (e) {
      this.set({ working: false, error: e.message });
    }
    return this.state;
  }

  async stop(reason = "stop") {
    if (!this.state.working) return this.state;
    const id = this.sessionId;
    this.halt();
    this.set({ working: false, live: false, since: undefined, error: undefined });
    try { await this.api("stop", { sessionId: id, reason }); } catch { /* the server closes silent sessions by itself */ }
    return this.state;
  }

  halt() {
    for (const t of this.timers) { clearInterval(t); clearTimeout(t); }
    this.timers = [];
    clearTimeout(this.shotTimer);
    clearTimeout(this.liveTimer);
    this.liveOn = false;
    this.sessionId = null;
    if (this.ps) { try { this.ps.kill(); } catch { /* gone */ } this.ps = null; }
  }

  // ---------- activity ----------

  resetMinute() {
    this.minute = new Map(); this.minuteIdle = 0; this.minuteTicks = 0; this.minuteStart = Date.now();
  }

  tick() {
    const idleFor = powerMonitor.getSystemIdleTime();
    const idle = idleFor >= this.rules.idleMin * 60;
    const sec = TICK_MS / 1000;
    if (idle) this.idleSec += sec; else this.activeSec += sec;
    this.minuteTicks++;
    if (idle) this.minuteIdle++;
    const key = JSON.stringify([this.fg.app || "", this.fg.title || ""]);
    this.minute.set(key, (this.minute.get(key) || 0) + 1);
    if (Date.now() - this.minuteStart >= 60_000) {
      let best = null; let n = -1;
      for (const [k, v] of this.minute) if (v > n) { best = k; n = v; }
      const [app, title] = best ? JSON.parse(best) : ["", ""];
      this.samples.push({ at: new Date(this.minuteStart).toISOString(), app, title, idle: this.minuteIdle * 2 > this.minuteTicks });
      if (this.samples.length > 120) this.samples.shift();
      this.resetMinute();
    }
  }

  async beat() {
    if (!this.sessionId) return;
    const samples = this.samples.splice(0);
    const activeSec = this.activeSec; const idleSec = this.idleSec;
    this.activeSec = 0; this.idleSec = 0;
    try {
      const r = await this.api("beat", { sessionId: this.sessionId, samples, activeSec, idleSec });
      if (r.rules) this.rules = r.rules;
      if (r.ended) {
        // The server closed the session (internet was down for a while). Carry on in a new one.
        this.halt();
        this.state.working = false;
        await this.start();
        return;
      }
      this.set({ error: undefined });
      if (r.live) this.liveStart();
    } catch (e) {
      // Offline: keep the minutes and try again next time.
      this.samples.unshift(...samples);
      this.samples.splice(0, Math.max(0, this.samples.length - 120));
      this.activeSec += activeSec; this.idleSec += idleSec;
      if (!e.auth) this.set({ error: "Offline. Will send when the internet is back." });
    }
  }

  async ping() {
    if (!this.sessionId || this.liveOn) return;
    try {
      const r = await this.api("ping");
      if (r.live) this.liveStart();
    } catch { /* next time */ }
  }

  // ---------- the app in front (Windows) ----------

  startForeground() {
    if (process.platform !== "win32" || this.ps) return;
    const script = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class CmaW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
while ($true) {
  $h = [CmaW]::GetForegroundWindow()
  $sb = New-Object Text.StringBuilder 512
  [void][CmaW]::GetWindowText($h, $sb, 512)
  $procId = 0
  [void][CmaW]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = ''
  try {
    $p = Get-Process -Id $procId -ErrorAction Stop
    $name = $p.ProcessName
    try { $d = $p.MainModule.FileVersionInfo.FileDescription; if ($d) { $name = $d } } catch {}
  } catch {}
  @{ app = $name; title = $sb.ToString() } | ConvertTo-Json -Compress
  Start-Sleep -Seconds 5
}`;
    const enc = Buffer.from(script, "utf16le").toString("base64");
    try {
      const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", enc], { windowsHide: true });
      this.ps = ps;
      let buf = "";
      ps.stdout.setEncoding("utf8");
      ps.stdout.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          try { const j = JSON.parse(line); this.fg = { app: String(j.app || ""), title: String(j.title || "") }; } catch { /* partial line */ }
        }
      });
      ps.on("exit", () => { if (this.ps === ps) this.ps = null; });
      ps.on("error", () => { if (this.ps === ps) this.ps = null; });
    } catch { this.ps = null; }
  }

  // ---------- screenshots ----------

  scheduleShot(first) {
    clearTimeout(this.shotTimer);
    const lo = Math.max(1, this.rules.minMin) * 60_000;
    const hi = Math.max(lo, this.rules.maxMin * 60_000);
    // The first picture comes within the first couple of minutes, then at random moments.
    const wait = first ? 30_000 + Math.random() * 90_000 : lo + Math.random() * (hi - lo);
    this.shotTimer = setTimeout(async () => {
      await this.shoot().catch(() => {});
      if (this.sessionId) this.scheduleShot(false);
    }, wait);
  }

  async capture(maxW, primaryOnly) {
    const displays = screen.getAllDisplays();
    const biggest = displays.reduce((a, d) => Math.max(a, d.size.width * d.scaleFactor), 1);
    const scale = Math.min(1, maxW / biggest);
    const big = displays.reduce((a, d) => ({ w: Math.max(a.w, d.size.width * d.scaleFactor), h: Math.max(a.h, d.size.height * d.scaleFactor) }), { w: 1, h: 1 });
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.round(big.w * scale), height: Math.round(big.h * scale) } });
    const primary = String(screen.getPrimaryDisplay().id);
    const list = primaryOnly ? [sources.find((s) => s.display_id === primary) || sources[0]].filter(Boolean) : sources;
    return list.filter((s) => !s.thumbnail.isEmpty());
  }

  async shoot() {
    if (!this.sessionId) return;
    const sources = await this.capture(1600, false);
    let i = 0;
    for (const s of sources.slice(0, 4)) {
      const jpg = s.thumbnail.toJPEG(55);
      const fd = new FormData();
      fd.set("sessionId", this.sessionId);
      fd.set("takenAt", new Date().toISOString());
      fd.set("screen", String(i++));
      fd.set("app", this.fg.app || "");
      fd.set("title", this.fg.title || "");
      fd.set("image", new Blob([jpg], { type: "image/jpeg" }), "screen.jpg");
      const r = await this.api("shot", fd).catch(() => null);
      if (r?.ended) return;
    }
    if (sources.length) this.set({ lastShotAt: new Date().toISOString() });
  }

  // ---------- live view ----------

  liveStart() {
    if (this.liveOn || !this.sessionId || !this.rules.live) return;
    this.liveOn = true;
    this.set({ live: true });
    this.o.onLiveStart();
    const loop = async () => {
      if (!this.liveOn || !this.sessionId) return this.liveEnd();
      try {
        const [s] = await this.capture(1280, true);
        if (s) {
          const r = await this.api("frame", s.thumbnail.toJPEG(45), { headers: { "content-type": "image/jpeg", "x-session": this.sessionId } });
          if (!r.live) return this.liveEnd();
        }
      } catch { /* try again */ }
      this.liveTimer = setTimeout(loop, LIVE_MS);
    };
    loop();
  }

  liveEnd() {
    this.liveOn = false;
    clearTimeout(this.liveTimer);
    if (this.state.live) this.set({ live: false });
  }
}

module.exports = { Monitor };
