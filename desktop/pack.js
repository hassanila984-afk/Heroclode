// Builds Firefly for Windows from the official Electron release (no Windows needed):
//   out/Firefly/              the app folder (Firefly.exe + resources/app)
//   out/pcapp/part1.bin…      the zipped app in pieces small enough for Cloudflare Pages (25 MB a file)
//   out/pcapp/parts.json      the list of pieces, in order
//   out/pc                    the installer people run: irm https://firefly-3t9.pages.dev/pc | iex
// Usage: node pack.js [cache-dir]
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ELECTRON = require("./node_modules/electron/package.json").version;
const VERSION = require("./package.json").version;
const OUT = path.join(__dirname, "out");
const CACHE = process.argv[2] || path.join(OUT, "cache");
const PART = 20 * 1024 * 1024;
const APP_FILES = ["main.js", "preload.js", "bubble.html", "bubble-preload.js", "code.html", "code-preload.js", "hands.js", "helper.ps1", "assets"];

fs.mkdirSync(CACHE, { recursive: true });
const zip = path.join(CACHE, `electron-v${ELECTRON}-win32-x64.zip`);
if (!fs.existsSync(zip)) {
  console.log("downloading Electron", ELECTRON, "for Windows…");
  execFileSync("curl", ["-sSfL", "-o", zip, `https://github.com/electron/electron/releases/download/v${ELECTRON}/electron-v${ELECTRON}-win32-x64.zip`]);
}

const dir = path.join(OUT, "Firefly");
fs.rmSync(OUT + "/Firefly", { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
execFileSync("unzip", ["-q", zip, "-d", dir]);
fs.renameSync(path.join(dir, "electron.exe"), path.join(dir, "Firefly.exe"));
fs.rmSync(path.join(dir, "resources", "default_app.asar"), { force: true });

const app = path.join(dir, "resources", "app");
fs.mkdirSync(app, { recursive: true });
for (const f of APP_FILES) fs.cpSync(path.join(__dirname, f), path.join(app, f), { recursive: true });
fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "firefly", productName: "Firefly", version: VERSION, main: "main.js" }, null, 2));

// zip and split
const pc = path.join(OUT, "pcapp");
fs.rmSync(pc, { recursive: true, force: true });
fs.mkdirSync(pc, { recursive: true });
const whole = path.join(OUT, "firefly-windows.zip");
fs.rmSync(whole, { force: true });
execFileSync("zip", ["-q", "-r", "-9", whole, "."], { cwd: dir });
const data = fs.readFileSync(whole);
const parts = [];
for (let i = 0, n = 1; i < data.length; i += PART, n++) {
  const name = `part${n}.bin`;
  fs.writeFileSync(path.join(pc, name), data.subarray(i, i + PART));
  parts.push(name);
}
fs.writeFileSync(path.join(pc, "parts.json"), JSON.stringify({ version: VERSION, size: data.length, parts }));
fs.copyFileSync(path.join(__dirname, "install.ps1"), path.join(OUT, "pc"));
console.log(`Firefly ${VERSION} for Windows: ${(data.length / 1048576).toFixed(1)} MB in ${parts.length} parts`);
