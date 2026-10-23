// Sessions for Firefly's own site. The Anthropic key never leaves the server: a person proves they
// may use it once with the access code, and gets back a signed, HttpOnly session cookie that page
// scripts cannot read. Changing ACCESS_CODE or SESSION_SECRET signs every device out.
const enc = new TextEncoder();
const DAY = 86400;
export const SESSION_DAYS = 30;

async function hmac(env, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET + "\u0000" + env.ACCESS_CODE),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// compare without leaking how many leading characters matched
export async function sameSecret(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(String(s)))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

export function configured(env) {
  return !!(env.ANTHROPIC_API_KEY && env.ACCESS_CODE && env.SESSION_SECRET && env.ACCESS_CODE.length >= 16 && env.SESSION_SECRET.length >= 32);
}

export async function newSession(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * DAY;
  const id = crypto.randomUUID();
  const value = `${id}.${exp}`;
  return `${value}.${await hmac(env, value)}`;
}

export async function sessionFrom(request, env) {
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)ff_s=([^;]+)/);
  if (!m) return null;
  const [id, exp, sig] = m[1].split(".");
  if (!id || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  return (await sameSecret(sig, await hmac(env, `${id}.${exp}`))) ? { id, exp: Number(exp) } : null;
}

export const cookie = (value, maxAge) => `ff_s=${value}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// only our own pages may call the API from a browser
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: Object.assign({ "content-type": "application/json", "cache-control": "no-store" }, headers) });
