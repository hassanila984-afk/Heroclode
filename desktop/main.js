// Firefly for Windows: the Firefly site in its own window, plus what a browser can't do, offered to the page
// as window.AndroidLuma (the same bridge the Android app has, with platform() = "windows"): Luma's bubble
// roaming the desktop, seeing the screen without asking each time, and her hands on the computer
// (open programs, scroll, click and type, always asked first for clicks and typing).
const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, desktopCapturer, shell, screen, session, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const hands = require("./hands");

const SITE = "https://firefly-3t9.pages.dev/";
const HOST = new URL(SITE).host;
const asset = (f) => path.join(__dirname, "assets", f);

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

// Never an error window (it would pop up over a game): anything unexpected goes quietly to errors.log.
const logError = (e) => { try { fs.appendFileSync(path.join(app.getPath("userData"), "errors.log"), new Date().toISOString() + " " + ((e && e.stack) || e) + "\n"); } catch (x) {} };
process.on("uncaughtException", logError);
process.on("unhandledRejection", logError);

// ---------- settings (kept in the app's own folder) ----------
const SETTINGS = path.join(app.getPath("userData"), "settings.json");
let settings = { control: false, bubble: true, autostart: true, toldTray: false };
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS, "utf8"))); } catch (e) {}
const save = () => { try { fs.writeFileSync(SETTINGS, JSON.stringify(settings)); } catch (e) {} };

let win = null, bubble = null, tray = null, quitting = false;
let stayWithMe = false, capturing = false, lastFrame = "", captureTimer = null;

// ---------- the main window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 460, height: 860, minWidth: 360, minHeight: 560,
    title: "Firefly", icon: asset("icon.png"), backgroundColor: "#0e0b26", autoHideMenuBar: true,
    show: !process.argv.includes("--hidden"),
    // not throttled when hidden: her ears and calls keep working next to the clock (the page rests its drawing)
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, backgroundThrottling: false },
  });
  win.loadURL(SITE);
  // hidden or minimized, the page's animations rest (see window.__resting in the page)
  const rest = () => { if (!win.isDestroyed()) win.webContents.executeJavaScript("window.__resting = " + !(win.isVisible() && !win.isMinimized())).catch(() => {}); };
  for (const ev of ["show", "hide", "minimize", "restore"]) win.on(ev, rest);
  win.webContents.on("did-finish-load", rest);
  // her own site stays here; every other link opens in the browser
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { try { if (new URL(url).host !== HOST) { e.preventDefault(); shell.openExternal(url); } } catch (x) { e.preventDefault(); } });
  // closing keeps her running next to the clock, with her bubble out
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault(); win.hide();
    if (!settings.toldTray && tray) { settings.toldTray = true; save(); try { tray.displayBalloon({ title: "Luma is still here 🌙", content: "Firefly keeps running next to the clock. Ctrl+Shift+L to talk to her.", icon: asset("icon.png") }); } catch (x) {} }
  });
  for (const ev of ["show", "hide", "minimize", "restore", "focus", "blur"]) win.on(ev, syncBubble);
}
const appVisible = () => win && win.isVisible() && !win.isMinimized();
function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
const js = (code) => { if (win && !win.isDestroyed()) win.webContents.executeJavaScript(code).catch(() => {}); };

// ---------- tray, shortcut, starting with Windows ----------
function createTray() {
  tray = new Tray(nativeImage.createFromPath(asset("tray.png")));
  tray.setToolTip("Firefly · Luma");
  tray.on("click", showWindow);
  refreshTray();
}
function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Firefly", click: showWindow },
    { label: "Talk to Luma\tCtrl+Shift+L", click: startCall },
    { type: "separator" },
    { label: "Luma's bubble on the desktop", type: "checkbox", checked: settings.bubble, click: (i) => { settings.bubble = i.checked; save(); syncBubble(); } },
    { label: "Luma can control this PC", type: "checkbox", checked: settings.control, click: (i) => setControl(i.checked) },
    { label: "Start with Windows", type: "checkbox", checked: settings.autostart, click: (i) => { settings.autostart = i.checked; save(); applyAutostart(); } },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
}
function applyAutostart() {
  if (process.platform !== "win32") return;
  app.setLoginItemSettings({ openAtLogin: settings.autostart, args: ["--hidden"] });
}
// in a game the call starts by voice only, without bringing Firefly over the game
function startCall() { if (!hands.isGaming()) showWindow(); js("window.__desktopCall && __desktopCall()"); }
function setControl(on) { settings.control = on; save(); refreshTray(); if (on) hands.start(); }

// ---------- her bubble on the desktop ----------
function createBubble() {
  bubble = new BrowserWindow({
    width: 380, height: 170, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    hasShadow: false, focusable: true, show: false, backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "bubble-preload.js"), contextIsolation: true, backgroundThrottling: false },
  });
  bubble.setAlwaysOnTop(true, "screen-saver");
  bubble.setVisibleOnAllWorkspaces(true);
  bubble.loadFile(path.join(__dirname, "bubble.html"));
  bubble.setIgnoreMouseEvents(true, { forward: true });   // see-through except where she is
  const wa = screen.getPrimaryDisplay().workArea;
  bubble.setPosition(wa.x + wa.width - 380, wa.y + wa.height - 170);
}
// out by herself whenever the Firefly window is closed or minimized (🫧 and the tray menu turn her off),
// away while it's in front. In games she stays; only her hands are off there (hands.js).
let bubbleWanted = true, asking = false;
function syncBubble() {
  if (!bubble) return;
  const want = asking || ((bubbleWanted || stayWithMe) && settings.bubble && !appVisible());
  if (want && !bubble.isVisible()) bubble.showInactive();
  else if (!want && bubble.isVisible()) bubble.hide();
}
const toBubble = (ch, data) => { if (bubble && !bubble.isDestroyed()) bubble.webContents.send(ch, data); };
ipcMain.on("bubble:mouse", (e, over) => bubble && bubble.setIgnoreMouseEvents(!over, { forward: true }));
ipcMain.on("bubble:move", (e, x, y) => {
  x = Number(x); y = Number(y);
  if (!bubble || bubble.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) return;   // a bad position is ignored, never a crash
  bubble.setPosition(Math.max(-30000, Math.min(30000, Math.round(x))), Math.max(-30000, Math.min(30000, Math.round(y))));
});
ipcMain.on("bubble:where", (e) => { e.returnValue = bubble ? bubble.getBounds() : null; });
ipcMain.on("bubble:area", (e) => { e.returnValue = screen.getDisplayMatching(bubble.getBounds()).workArea; });
ipcMain.on("bubble:open", () => { if (hands.autoScrolling()) return hands.stopAutoScroll(); showWindow(); });
ipcMain.on("bubble:typing", (e, on) => { if (on) bubble.focus(); });
ipcMain.on("bubble:send", (e, text) => js("window.__nativeBubbleSend && __nativeBubbleSend(" + JSON.stringify(String(text)) + ")"));
ipcMain.on("bubble:answer", (e, yes) => answerAsk(yes));

// ---------- seeing the screen ----------
async function grabFrame() {
  try {
    const d = screen.getPrimaryDisplay(), scale = Math.min(1, 1280 / d.size.width);
    const [src] = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.round(d.size.width * scale), height: Math.round(d.size.height * scale) } });
    if (src && !src.thumbnail.isEmpty()) lastFrame = src.thumbnail.toJPEG(70).toString("base64");
  } catch (e) {}
}
function setCapture(on) {
  capturing = on;
  clearInterval(captureTimer); captureTimer = null;
  if (on) { grabFrame(); captureTimer = setInterval(grabFrame, 1500); } else lastFrame = "";
}

// ---------- asking before her hands touch anything ----------
let pendingYes = null, askTimer = null;
function askFirst(question, yes) {
  pendingYes = yes; asking = true; syncBubble();
  toBubble("ask", question);
  js("window.__nativeAsk && __nativeAsk(" + JSON.stringify(question) + ")");
  clearTimeout(askTimer); askTimer = setTimeout(() => answerAsk(false), 30000);
}
function answerAsk(yes) {
  clearTimeout(askTimer);
  const run = pendingYes; pendingYes = null; asking = false;
  toBubble("asked", yes);
  js("window.__nativeAskDone && __nativeAskDone()");
  syncBubble();
  if (yes && run) setTimeout(run, 200);
}

// ---------- the bridge the page calls (window.AndroidLuma) ----------
ipcMain.on("luma:sync", (e, name, ...a) => {
  let v = null;
  switch (name) {
    case "version": v = app.getVersion(); break;
    case "bubbleOn": v = bubbleWanted && settings.bubble; break;
    case "capturing": v = capturing; break;
    case "frame": v = lastFrame; break;
    case "captureInfo": v = capturing ? (lastFrame ? "capturing" : "no picture yet") : "not capturing"; break;
    case "accessOn": v = settings.control; break;
    case "screen": v = settings.control ? hands.screenNow() : ""; break;
    case "autoScrolling": v = hands.autoScrolling(); break;
  }
  e.returnValue = v;
});
ipcMain.on("luma:do", (e, name, ...a) => {
  switch (name) {
    case "bubbleShow": bubbleWanted = true; syncBubble(); break;
    case "bubbleHide": bubbleWanted = false; syncBubble(); break;
    case "bubbleSay": toBubble("say", { text: a[0], mood: a[1] }); break;
    case "bubbleText": toBubble("words", a[0]); break;
    case "startCapture": setCapture(true); setTimeout(() => js("window.__nativeCapture && __nativeCapture(true)"), 300); break;
    case "stopCapture": setCapture(false); break;
    case "stayWithMe": stayWithMe = !!a[0]; syncBubble(); break;
    case "answerAsk": answerAsk(!!a[0]); break;
    case "accessOpen": setControl(!settings.control); break;
  }
});
ipcMain.handle("luma:act", (e, name, arg) => (settings.control || !hands.NEEDS_CONTROL.has(name) ? hands.act(name, String(arg || ""), askFirst) : "no_access"));
ipcMain.handle("luma:askCode", (e, text) => askCode(text));

// sign-in code: a small window instead of the browser's prompt (Electron has none)
function askCode(text) {
  return new Promise((done) => {
    const w = new BrowserWindow({ width: 380, height: 210, parent: win, modal: true, resizable: false, minimizable: false, maximizable: false, title: "Firefly",
      backgroundColor: "#1b1640", autoHideMenuBar: true, webPreferences: { contextIsolation: true, preload: path.join(__dirname, "code-preload.js") } });
    let answered = false;
    ipcMain.once("code:answer", (ev, v) => { answered = true; done(v); w.close(); });
    w.on("closed", () => { if (!answered) { ipcMain.removeAllListeners("code:answer"); done(null); } });
    w.loadFile(path.join(__dirname, "code.html"), { query: { t: String(text || "") } });
  });
}

app.whenReady().then(() => {
  // the mic for calls; nothing else is allowed to the page
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === "media" || perm === "notifications"));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === "media" || perm === "notifications");
  createWindow();
  createBubble();
  createTray();
  applyAutostart();
  globalShortcut.register("CommandOrControl+Shift+L", startCall);
  hands.init({
    onAutoScrollStop: () => toBubble("say", { text: "Okay, stopped scrolling~", mood: "happy" }),
    onGame: (on) => { if (on) toBubble("say", { text: "Game time! 🎮 My hands are off while you play, so no ban worries~", mood: "excited" }); },
  });
  hands.watch();   // which window is in front, so games are left alone
  if (settings.control) hands.start();
});
app.on("second-instance", showWindow);
app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => { globalShortcut.unregisterAll(); hands.stop(); });
app.on("window-all-closed", () => {});   // keeps running in the tray
