// Work Monitor engine: runs only between Start work and Stop work (the timer).
//  - screenshots: perTen pictures at random moments in every 10 minutes (all screens, compressed JPEG,
//    blurred when the rules say so); the person gets a small notice after each one
//  - every second: was there any mouse/keyboard input? (a count only, never which keys) -> activity %
//  - every 5 seconds: idle time + the app in front; sent once a minute
//  - idle: when the person comes back after an idle stretch, the rules keep it, discard it, or ask them
//  - live view: while an admin's live page is open, a small picture every 1.5 seconds (never saved)
const { desktopCapturer, powerMonitor, screen, net } = require("electron");
const { spawn } = require("node:child_process");
const os = require("node:os");

const TICK_MS = 5000;
const BEAT_MS = 60_000;
const PING_MS = 4000;
const LIVE_MS = 1500;

class Monitor {
  /** @param {{ server: () => string, token: () => string | null, onChange: (s: object) => void, onLiveStart: () => void, onAuthLost: () => void,
 *   onShot?: (at: Date) => void, askIdle?: (from: Date, to: Date) => Promise<boolean> }} o */
  constructor(o) {
    this.o = o;
    this.state = { working: false };
    this.rules = { minMin: 5, maxMin: 10, idleMin: 5, live: true, perTen: 1, blur: false, idleMode: "ask" };
    this.minuteAct = 0;
    this.slotStart = 0; this.slotAct = 0; this.slotSec = 0;
    this.idleFrom = null;
    this.shotTimers = [];
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
    this.state = { ...this.state, ...patch, minMin: this.rules.minMin, maxMin: this.rules.maxMin, perTen: this.rules.perTen };
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
      if (r.rules) this.rules = { ...this.rules, ...r.rules };
      this.activeSec = 0; this.idleSec = 0; this.samples = [];
      this.resetMinute();
      this.slotStart = 0; this.idleFrom = null;
      this.set({ working: true, since: r.startedAt || new Date().toISOString(), error: undefined, live: false, lastShotAt: undefined, act: undefined, ...this.totals(r) });
      this.startForeground();
      this.timers.push(setInterval(() => this.second(), 1000));
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
    for (const t of this.shotTimers) clearTimeout(t);
    this.shotTimers = [];
    clearTimeout(this.liveTimer);
    this.liveOn = false;
    this.sessionId = null;
    if (this.ps) { try { this.ps.kill(); } catch { /* gone */ } this.ps = null; }
  }

  // ---------- activity ----------

  resetMinute() {
    this.minute = new Map(); this.minuteIdle = 0; this.minuteTicks = 0; this.minuteStart = Date.now(); this.minuteAct = 0;
  }

  /** Today's / this week's worked seconds as the server counted them, and when. */
  totals(r) {
    return typeof r?.todaySec === "number" ? { todaySec: r.todaySec, weekSec: r.weekSec, totalsAt: new Date().toISOString() } : {};
  }

  /** Every second: any input in the last second? Only a yes/no count is kept. */
  second() {
    const now = Date.now();
    const slot = Math.floor(now / 600_000) * 600_000;
    if (slot !== this.slotStart) { this.slotStart = slot; this.slotAct = 0; this.slotSec = 0; }
    const input = powerMonitor.getSystemIdleTime() < 1;
    this.slotSec++;
    if (input) { this.minuteAct++; this.slotAct++; }
    if (this.slotSec % 10 === 0) {
      const act = Math.round((this.slotAct / this.slotSec) * 100);
      if (act !== this.state.act) this.set({ act });
    }
  }

  tick() {
    const idleFor = powerMonitor.getSystemIdleTime();
    const idle = idleFor >= this.rules.idleMin * 60;
    if (idle && !this.idleFrom) this.idleFrom = new Date(Date.now() - idleFor * 1000);
    if (!idle && this.idleFrom) {
      const from = this.idleFrom; const to = new Date(Date.now() - idleFor * 1000);
      this.idleFrom = null;
      this.idleBack(from, to);
    }
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
      this.samples.push({ at: new Date(this.minuteStart).toISOString(), app, title, idle: this.minuteIdle * 2 > this.minuteTicks, act: Math.min(60, this.minuteAct) });
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
      if (r.rules) this.setRules(r.rules);
      if (r.ended) {
        // The server closed the session (internet was down for a while). Carry on in a new one.
        this.halt();
        this.state.working = false;
        await this.start();
        return;
      }
      this.set({ error: undefined, ...this.totals(r) });
      if (r.live) this.liveStart();
    } catch (e) {
      // Offline: keep the minutes and try again next time.
      this.samples.unshift(...samples);
      this.samples.splice(0, Math.max(0, this.samples.length - 120));
      this.activeSec += activeSec; this.idleSec += idleSec;
      if (!e.auth) this.set({ error: "Offline. Will send when the internet is back." });
    }
  }

  setRules(next) {
    const before = this.rules.perTen;
    this.rules = { ...this.rules, ...next };
    // Screenshot count changed: plan the pictures again from now.
    if (this.sessionId && before !== this.rules.perTen) this.scheduleShot(false);
  }

  /** The person is back after an idle stretch. Keep, discard, or ask, as the rules say. */
  async idleBack(from, to) {
    const mode = this.rules.idleMode || "keep";
    if (mode === "keep" || !this.sessionId || to - from < 60_000) return;
    const sessionId = this.sessionId;
    let keep = false;
    if (mode === "ask") {
      try { keep = this.o.askIdle ? await this.o.askIdle(from, to) : true; } catch { keep = true; }
    }
    if (keep) return;
    try {
      const r = await this.api("idle", { sessionId, from: from.toISOString(), to: to.toISOString() });
      this.set(this.totals(r));
    } catch { /* stays counted; an admin can fix it */ }
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
    for (const t of this.shotTimers) clearTimeout(t);
    this.shotTimers = [];
    if (typeof this.rules.perTen === "number") return this.planBlock();
    const lo = Math.max(1, this.rules.minMin) * 60_000;
    const hi = Math.max(lo, this.rules.maxMin * 60_000);
    // The first picture comes within the first couple of minutes, then at random moments.
    const wait = first ? 30_000 + Math.random() * 90_000 : lo + Math.random() * (hi - lo);
    this.shotTimer = setTimeout(async () => {
      await this.shoot().catch(() => {});
      if (this.sessionId) this.scheduleShot(false);
    }, wait);
  }

  /** Hubstaff style: perTen pictures at random moments inside each 10-minute block of the clock. */
  planBlock() {
    if (!this.sessionId) return;
    const now = Date.now();
    const start = Math.floor(now / 600_000) * 600_000;
    const end = start + 600_000;
    const n = Math.max(0, Math.min(3, Math.round(this.rules.perTen)));
    const part = 600_000 / Math.max(1, n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(now + 20_000, start + i * part);
      const hi = start + (i + 1) * part - 5_000;
      if (hi <= lo) continue;
      const at = lo + Math.random() * (hi - lo);
      this.shotTimers.push(setTimeout(() => { if (this.sessionId) this.shoot().catch(() => {}); }, at - now));
    }
    this.shotTimer = setTimeout(() => this.planBlock(), end - now + 100);
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
      let img = s.thumbnail;
      if (this.rules.blur) {
        // Blur on this computer, before anything is sent: shrink hard, then grow back.
        const { width } = img.getSize();
        img = img.resize({ width: Math.max(24, Math.round(width / 14)), quality: "good" }).resize({ width, quality: "good" });
      }
      const jpg = img.toJPEG(55);
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
    if (sources.length) {
      this.set({ lastShotAt: new Date().toISOString() });
      if (this.o.onShot) this.o.onShot(new Date());
    }
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
