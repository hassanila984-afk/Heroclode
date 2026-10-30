// Luma's hands on the computer. On Windows a small PowerShell helper (helper.ps1) does the work: it lists
// and starts programs, scrolls, presses keys, and finds, clicks or types into buttons and fields by their
// words. Here: which window she's working in, what she's allowed to touch, and asking before clicks/typing.
const { shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

const WIN = process.platform === "win32";
// her hands only work with "Luma can control this PC" on; opening programs and links always does (like on the phone)
const NEEDS_CONTROL = new Set(["tap", "type", "type_here", "scroll", "autoscroll", "back", "home", "notifications", "key", "switch_to", "window"]);
// never touched: money, passwords, system settings, terminals, and Firefly itself
const OFF_LIMITS = /bank|pay|wallet|money|cash|crypto|coin|binance|trade|finance|password|passkey|authenticator|keepass|bitwarden|1password|lastpass|vault|SystemSettings|SecHealthUI|Windows Security|regedit|\bmmc\b|\bcmd\b|powershell|pwsh|WindowsTerminal|Firefly|electron/i;

let helper = null, seq = 0, buf = "";
const waiting = new Map();
let apps = [], appsAt = 0;
let target = null;                 // the last window they were in that isn't Firefly
let snap = { at: 0, json: "" };    // what's in that window, for her
let fgTimer = null, opts = {};
let scroll = null;                 // { timer, every, app }
// Games: while one is in front, her hands stay off completely (no clicks, keys, scrolling or reading its
// buttons), so nothing she does could ever look like a cheat to anti-cheat software. She herself stays.
const GAMES = /valorant|FortniteClient|\bcs2\b|csgo|League of Legends|LeagueClient|r5apex|GTA5|RainbowSix|Overwatch|ModernWarfare|BlackOps|\bcod\b|Warzone|EscapeFromTarkov|TslGame|PUBG|RocketLeague|Destiny2|dota2|FiveM|RobloxPlayer|Minecraft|eldenring|Diablo|\bWow\b|Battlefield|bf2042|deadlock|Marvel|TheFinals|Palworld|Genshin|ZenlessZoneZero|StarRail|osu|eFootball|FC2[0-9]|fifa/i;
let gaming = false;
// full screen but not a game they're playing: browsers, video players, and someone else's stream (Discord, Twitch…)
const WATCHING = /chrome|msedge|firefox|opera|brave|vivaldi|vlc|mpc|potplayer|netflix|Video\.UI|Photos|discord|twitch|obs64|obs32|streamlabs|kick|youtube|spotify|steamwebhelper|teams|zoom|skype|whatsapp|telegram/i;
let gamingKnown = false;   // the game is a known one (not just something full screen)

function init(o) { opts = o || {}; }

function ensureHelper() {
  if (!WIN || helper) return;
  const file = path.join(__dirname, "helper.ps1").replace("app.asar", "app.asar.unpacked");
  helper = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], { windowsHide: true });
  helper.stdout.setEncoding("utf8");
  helper.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try { const r = JSON.parse(line); const w = waiting.get(r.id); if (w) { waiting.delete(r.id); clearTimeout(w.t); w.done(r); } } catch (e) {}
    }
  });
  helper.on("exit", () => { helper = null; for (const w of waiting.values()) w.done({ error: "helper stopped" }); waiting.clear(); });
}
function ask(cmd, extra = {}, ms = 9000) {
  if (!WIN) return Promise.resolve(stub(cmd, extra));
  ensureHelper();
  if (!helper) return Promise.resolve({ error: "no helper" });
  const id = ++seq;
  return new Promise((done) => {
    const t = setTimeout(() => { waiting.delete(id); done({ error: "timeout" }); }, ms);
    waiting.set(id, { done, t });
    helper.stdin.write(JSON.stringify(Object.assign({ id, cmd }, extra)) + "\n");
  });
}
// away from Windows (testing): a pretend computer with one window open
function stub(cmd, x) {
  if (cmd === "fg") return process.env.FIREFLY_FAKE_GAME ? { hwnd: 2, app: "VALORANT-Win64-Shipping", title: "VALORANT", fullscreen: true } : { hwnd: 1, app: "Chrome", title: "Webtoon - Chrome", fullscreen: false };
  if (cmd === "apps") return { apps: [{ n: "Spotify", id: "Spotify.exe" }, { n: "Manga Slayer", id: "MangaSlayer" }] };
  if (cmd === "screen") return { hwnd: 1, app: "Chrome", title: "Webtoon - Chrome", items: ["button: Next episode", "button: Like", "field: Search"], private: false };
  if (cmd === "find") return /next|like|search/i.test(x.name || "") || x.field ? { found: true, label: x.field ? "Search" : "Next episode" } : { found: false };
  (stub.log || (stub.log = [])).push(cmd + " " + JSON.stringify(x));
  return { ok: true };
}

// ---------- which window she's working in ----------
async function pollForeground() {
  const r = await ask("fg");
  // a known game, or anything full screen that isn't a browser or video player (a full-screen YouTube isn't a game)
  const nowGaming = !!(r && r.hwnd && !/Firefly|electron|explorer/i.test(r.app || "") &&
    (GAMES.test(r.app || "") || GAMES.test(r.title || "") || (r.fullscreen && !WATCHING.test(r.app || "") && !WATCHING.test(r.title || ""))));
  if (nowGaming !== gaming) {
    gaming = nowGaming;
    gamingKnown = nowGaming && (GAMES.test(r.app || "") || GAMES.test(r.title || ""));
    if (gaming) stopAutoScroll();
    if (opts.onGame) opts.onGame(gaming);
  }
  if (r && r.hwnd && !OFF_LIMITS.test(r.app || "") ) {
    if (!target || target.hwnd !== r.hwnd) { target = r; snap.at = 0; }
  } else if (r && r.hwnd && /Firefly|electron/i.test(r.app || "")) {
    // in Firefly itself: keep the window they were in before
  } else if (r && r.hwnd) target = Object.assign({}, r, { private: true });
  // they went somewhere else: the hands-free scrolling stops
  if (scroll && r && r.hwnd && !/Firefly|electron/i.test(r.app || "") && r.hwnd !== scroll.hwnd) stopAutoScroll();
}
// watching which window is in front (games included) runs from the start; her hands only with control on
function watch() { if (!fgTimer) { pollForeground(); fgTimer = setInterval(pollForeground, 2000); } }
function start() {
  ensureHelper();
  watch();
  refreshApps();
}
function stop() {
  clearInterval(fgTimer); fgTimer = null; stopAutoScroll();
  if (helper) { try { helper.kill(); } catch (e) {} helper = null; }
}
async function refreshApps() {
  if (Date.now() - appsAt < 10 * 60000 && apps.length) return;
  const r = await ask("apps", {}, 20000);
  if (r && Array.isArray(r.apps)) { apps = r.apps; appsAt = Date.now(); }
}

// ---------- what she sees in their window (button and field names) ----------
function screenNow() {
  if (!target) return "";
  if (gaming) return JSON.stringify({ app: (target && target.app) || "a game", game: true, known: gamingKnown });
  if (Date.now() - snap.at > 3000) refreshScreen();
  return snap.json;
}
let snapping = false;
async function refreshScreen() {
  if (snapping || !target) return;
  snapping = true; snap.at = Date.now();
  try {
    if (target.private) { snap.json = JSON.stringify({ app: target.app, private: true }); return; }
    const r = await ask("screen", { hwnd: target.hwnd }, 12000);
    if (r && !r.error) snap.json = JSON.stringify(r.private ? { app: r.app, private: true } : { app: r.app + (r.title ? " (" + r.title.slice(0, 60) + ")" : ""), items: r.items || [] });
  } finally { snapping = false; }
}

// the installed program whose name is closest to what was heard (letters only), if it's close enough
function soundsLike(want) {
  const w = want.replace(/[^a-z0-9]/g, "");
  if (w.length < 4) return null;
  let best = null, top = 0;
  for (const a of apps) {
    const n = String(a.n).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!n) continue;
    const d = Array.from({ length: n.length + 1 }, (_, j) => j);
    for (let i = 1; i <= w.length; i++) {
      let prev = d[0]; d[0] = i;
      for (let j = 1; j <= n.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (w[i - 1] === n[j - 1] ? 0 : 1)); prev = t; }
    }
    const score = 1 - d[n.length] / Math.max(w.length, n.length);
    if (score > top) { top = score; best = a; }
  }
  return top >= (w.length >= 8 ? 0.5 : 0.6) ? best : null;
}

// ---------- doing things (clicks and typing asked first) ----------
// Returns "ok", "ok:<app>", "asking", "not_found", "private", "no_access" or "failed".
async function act(name, arg, askFirst) {
  switch (name) {
    case "open_app": {
      await refreshApps();
      const want = arg.toLowerCase().trim();
      let best = null, score = 0;
      for (const a of apps) {
        const l = String(a.n).toLowerCase();
        const s = l === want ? 3 : l.startsWith(want) ? 2 : l.includes(want) || (l.length > 2 && want.includes(l)) ? 1 : 0;
        if (s > score) { score = s; best = a; }
      }
      if (!best) best = soundsLike(want);   // misheard ("Minecraft player" for Manga Slayer): the closest name
      if (!best) return "not_found";
      const r = await ask("launch", { app: best.id });
      return r && r.ok ? "ok:" + best.n : "failed";
    }
    case "open_url": { const u = /^https?:\/\//i.test(arg) ? arg : "https://" + arg; if (!/^https?:\/\//i.test(u)) return "failed"; await shell.openExternal(u); return "ok"; }
    case "claude": await shell.openExternal("https://claude.ai/new?q=" + encodeURIComponent(arg)); return "ok";   // hand a job to Claude
    case "open_path": { const r = await shell.openPath(arg.replace(/^~(?=[\\/])/, require("os").homedir())); return r ? "not_found" : "ok"; }
    case "media": {   // play/pause, next, previous, volume: works for whatever is playing (never in games)
      if (gaming) return "game";
      const k = /next/i.test(arg) ? "next_track" : /prev|back/i.test(arg) ? "prev_track" : /mute/i.test(arg) ? "mute" : /up|louder|raise/i.test(arg) ? "volume_up" : /down|quieter|lower/i.test(arg) ? "volume_down" : "play_pause";
      const times = /volume/.test(k) ? Math.min(10, parseInt(arg.match(/\d+/) || [5], 10)) : 1;
      for (let i = 0; i < times; i++) await ask("keys", { hwnd: 0, keys: k });
      return "ok";
    }
    case "search": await shell.openExternal("https://www.google.com/search?q=" + encodeURIComponent(arg)); return "ok";
    case "maps": await shell.openExternal("https://www.google.com/maps/search/" + encodeURIComponent(arg)); return "ok";
    case "music":
      // focus / lofi music starts playing right away (the lofi girl live stream); anything else: its search
      if (/lo-?fi|focus|study|chill|work|relax/i.test(arg)) await shell.openExternal("https://www.youtube.com/watch?v=jfKfPfyJRdk");
      else await shell.openExternal("https://www.youtube.com/results?search_query=" + encodeURIComponent(arg));
      return "ok";
  }
  if (name === "switch_to") {
    if (gaming) return "game";
    const r = await ask("activate", { name: arg });
    if (r && r.ok) { target = null; await pollForeground(); return "ok:" + r.app; }
    return "not_found";
  }
  if (!target) await pollForeground();
  if (gaming) return "game";   // never anything inside a game
  if (!target) return "not_found";
  if (target.private) return "private";
  const hwnd = target.hwnd;
  switch (name) {
    case "scroll": { const r = await ask("wheel", { hwnd, dir: /up/i.test(arg) ? "up" : "down", notches: 5 }); return r && r.ok ? "ok" : "failed"; }
    case "autoscroll": {
      if (/stop|off/i.test(arg)) { stopAutoScroll(); return "ok"; }
      let every = scroll ? scroll.every : 3000;
      if (/slow/i.test(arg)) every = Math.min(9000, every * 1.5);
      else if (/fast/i.test(arg)) every = Math.max(1000, every / 1.5);
      if (scroll) clearInterval(scroll.timer);
      scroll = { every, hwnd, timer: setInterval(() => { if (!gaming) ask("wheel", { hwnd, dir: "down", notches: 2 }); }, every) };
      return "ok";
    }
    case "key": { const r = await ask("keys", { hwnd, keys: arg.toLowerCase().replace(/\s+/g, "") }); return r && r.ok ? "ok" : "failed"; }
    case "type_here": { const r = await ask("typehere", { hwnd, text: arg }); return r && r.ok ? "ok" : "failed"; }
    case "window": { const r = await ask("window", { hwnd, how: /min/i.test(arg) ? "min" : /max/i.test(arg) ? "max" : "restore" }); return r && r.ok ? "ok" : "failed"; }
    case "back": { const r = await ask("keys", { hwnd, keys: "alt+left" }); return r && r.ok ? "ok" : "failed"; }
    case "home": { const r = await ask("keys", { hwnd: 0, keys: "win+d" }); return r && r.ok ? "ok" : "failed"; }
    case "notifications": { const r = await ask("keys", { hwnd: 0, keys: "win+n" }); return r && r.ok ? "ok" : "failed"; }
    case "tap": {
      if (GAMES.test(target.app || "")) return "game";
      const f = await ask("find", { hwnd, name: arg, field: false });
      if (!f || !f.found) return "not_found";
      if (f.password) return "private";
      const c = await ask("click", { hwnd, name: arg });   // they asked her: she just does it
      return c && c.ok ? "ok:" + f.label : "failed";
    }
    case "type": {
      const bar = arg.indexOf("|");
      const where = bar < 0 ? "" : arg.slice(0, bar).trim(), text = (bar < 0 ? arg : arg.slice(bar + 1)).trim();
      if (!text) return "failed";
      const f = await ask("find", { hwnd, name: where, field: true });
      if (!f || !f.found) return "not_found";
      if (f.password) return "private";
      const r = await ask("type", { hwnd, name: where, text });
      return r && r.ok ? "ok" : "failed";
    }
    default: return "unknown";
  }
}
function autoScrolling() { return !!scroll; }
function isGaming() { return gaming; }
function stopAutoScroll() {
  if (!scroll) return;
  clearInterval(scroll.timer); scroll = null;
  if (opts.onAutoScrollStop) opts.onAutoScrollStop();
}

module.exports = { init, watch, start, stop, act, screenNow, autoScrolling, stopAutoScroll, isGaming, NEEDS_CONTROL, _stub: stub };
