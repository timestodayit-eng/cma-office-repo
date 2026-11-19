// CMA Office for Windows: the same office app as the website, in its own window,
// plus Work Monitor (Start work / Stop work, screenshots, activity, live view for admins).
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, powerMonitor, safeStorage, nativeImage, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { Monitor } = require("./monitor");

const ROOT = path.join(__dirname, "..");
const CONFIG = () => path.join(app.getPath("userData"), "config.json");
const NOTICE = fs.readFileSync(path.join(ROOT, "build", "notice.txt"), "utf8").replace(/^﻿/, "");

/** @type {{ server?: string, consentAt?: string, token?: string, tokenUser?: string, tokenName?: string }} */
let cfg = {};
let win = null;
let setupWin = null;
let tray = null;
let quitting = false;

function load() {
  try { cfg = JSON.parse(fs.readFileSync(CONFIG(), "utf8")); } catch { cfg = {}; }
}
function save() {
  fs.mkdirSync(path.dirname(CONFIG()), { recursive: true });
  fs.writeFileSync(CONFIG(), JSON.stringify(cfg, null, 2));
}
function getToken() {
  if (!cfg.token) return null;
  try {
    return cfg.token.startsWith("enc:") ? safeStorage.decryptString(Buffer.from(cfg.token.slice(4), "base64")) : cfg.token;
  } catch { return null; }
}
function setToken(t) {
  if (!t) { delete cfg.token; delete cfg.tokenUser; delete cfg.tokenName; save(); return; }
  cfg.token = safeStorage.isEncryptionAvailable() ? "enc:" + safeStorage.encryptString(t).toString("base64") : t;
  save();
}

/** "187.1.2.3:3000" -> "http://187.1.2.3:3000"; names without a scheme get https. */
function cleanUrl(v) {
  const s = String(v || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return (/^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(s) ? "http://" : "https://") + s;
}

const monitor = new Monitor({
  server: () => cfg.server,
  token: getToken,
  onChange: (s) => {
    updateTray();
    if (win && !win.isDestroyed()) win.webContents.send("cma:state", s);
  },
  onLiveStart: () => notify("Admin is viewing your screen", "A Work Monitor admin opened the live view of your screen."),
  onAuthLost: () => { setToken(null); monitor.stop("logout"); },
});

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, icon: path.join(ROOT, "build", "icon.png") }).show();
}

// ---------- windows ----------

function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) return setupWin.focus();
  setupWin = new BrowserWindow({
    width: 620, height: 720, resizable: true, title: "CMA Office setup", icon: path.join(ROOT, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "setup-preload.js"), contextIsolation: true, sandbox: true },
  });
  setupWin.loadFile(path.join(__dirname, "setup.html"));
  setupWin.on("closed", () => {
    setupWin = null;
    if (!cfg.server || !cfg.consentAt) app.quit();
  });
}

function openMain(show = true) {
  if (win && !win.isDestroyed()) { if (show) { win.show(); win.focus(); } return; }
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, show, title: "CMA Office",
    icon: path.join(ROOT, "build", "icon.png"), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  win.loadURL(cfg.server);
  const sameSite = (u) => { try { return new URL(u).origin === new URL(cfg.server).origin; } catch { return false; } };
  // Links to other sites (Google Sheets, Drive, Facebook) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameSite(url)) return { action: "allow" };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!sameSite(url)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  // Logged out in the page: stop work and forget this person's token.
  win.webContents.on("did-navigate", (_e, url) => {
    try {
      if (new URL(url).pathname.startsWith("/login") && cfg.token) { monitor.stop("logout"); setToken(null); }
    } catch { /* ignore */ }
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    win.loadFile(path.join(__dirname, "offline.html"), { query: { url: cfg.server, why: desc } });
  });
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (monitor.state.working) notify("CMA Office is still running", "You are still working. Use Stop work in the tray icon when you finish.");
  });
}

// ---------- tray ----------

function trayIcon(kind) {
  return nativeImage.createFromPath(path.join(ROOT, "build", `tray-${kind}.png`));
}
const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

function updateTray() {
  if (!tray) return;
  const s = monitor.state;
  tray.setImage(trayIcon(s.live ? "live" : s.working ? "work" : "idle"));
  tray.setToolTip(s.live ? "CMA Office: admin is viewing your screen" : s.working ? `CMA Office: working since ${timeOf(s.since)} (screen pictures on)` : "CMA Office: not working (nothing recorded)");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: s.live ? "● Admin is viewing your screen" : s.working ? `● Working since ${timeOf(s.since)}` : "Not working: nothing is recorded", enabled: false },
    ...(s.error ? [{ label: s.error, enabled: false }] : []),
    { type: "separator" },
    s.working
      ? { label: "Stop work", click: () => monitor.stop("stop") }
      : { label: "Start work", enabled: !!getToken(), click: () => monitor.start() },
    ...(!getToken() ? [{ label: "Log in first (open CMA Office)", enabled: false }] : []),
    { label: "Open CMA Office", click: () => openMain(true) },
    { type: "separator" },
    { label: "What is recorded?", click: () => dialog.showMessageBox({ type: "info", title: "Work Monitor", message: "Work Monitor", detail: NOTICE }) },
    { label: "Change the office app address…", click: () => openSetup() },
    { label: "Quit", click: () => quit() },
  ]));
}

async function quit() {
  quitting = true;
  if (monitor.state.working) await monitor.stop("quit");
  app.quit();
}

// ---------- page <-> app ----------

ipcMain.handle("cma:authUser", () => (getToken() ? cfg.tokenUser || null : null));
ipcMain.handle("cma:setAuth", (_e, a) => {
  if (!a || typeof a.token !== "string") return;
  if (cfg.tokenUser && cfg.tokenUser !== a.userId && monitor.state.working) monitor.stop("logout");
  setToken(a.token);
  cfg.tokenUser = String(a.userId || ""); cfg.tokenName = String(a.name || "");
  save();
  updateTray();
});
ipcMain.handle("cma:state", () => monitor.state);
ipcMain.handle("cma:start", () => monitor.start());
ipcMain.handle("cma:stop", () => monitor.stop("stop"));

ipcMain.handle("setup:info", () => ({ server: cfg.server || "", notice: NOTICE, consent: !!cfg.consentAt }));
ipcMain.handle("setup:save", async (_e, v) => {
  const url = cleanUrl(v);
  if (!url) return { error: "Write the office app address." };
  try {
    const { net } = require("electron");
    const r = await net.fetch(url + "/login", { method: "GET" });
    if (!r.ok) return { error: `The address answered with error ${r.status}. Check it with your admin.` };
  } catch (e) {
    return { error: "Cannot reach " + url + ". Check the address and the internet. (" + e.message + ")" };
  }
  if (cfg.server && cfg.server !== url) setToken(null);
  cfg.server = url;
  cfg.consentAt = cfg.consentAt || new Date().toISOString();
  save();
  if (setupWin) { const w = setupWin; setupWin = null; w.close(); }
  if (win && !win.isDestroyed()) { win.loadURL(url); win.show(); } else openMain(true);
  updateTray();
  return { ok: true };
});
ipcMain.handle("offline:retry", () => { if (win) win.loadURL(cfg.server); });

// ---------- app life ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => openMain(true));
  app.whenReady().then(() => {
    load();
    app.setAppUserModelId("com.cmaoffice.desktop");
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
    tray = new Tray(trayIcon("idle"));
    tray.on("click", () => openMain(true));
    updateTray();
    if (!cfg.server || !cfg.consentAt) openSetup();
    else openMain(!process.argv.includes("--hidden"));

    // Locking the PC or sleep ends the work session; the person presses Start work again.
    const pause = (why) => {
      if (!monitor.state.working) return;
      monitor.stop("lock");
      notify("Work stopped", `${why}, so work was stopped. Press Start work when you are back.`);
    };
    powerMonitor.on("lock-screen", () => pause("The PC was locked"));
    powerMonitor.on("suspend", () => pause("The PC went to sleep"));
    powerMonitor.on("shutdown", () => { if (monitor.state.working) monitor.stop("quit"); });
  });
  app.on("window-all-closed", () => { /* keep running in the tray */ });
  app.on("before-quit", () => { quitting = true; });
}
