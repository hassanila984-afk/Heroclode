import { configured, checkCode, newSession, sessionFrom, cookie, sameOrigin, json, SESSION_DAYS } from "../../lib/auth.js";

// GET: is this device signed in?  POST {code}: sign in.  DELETE: sign out.
export async function onRequestGet({ request, env }) {
  if (!configured(env)) return json({ ok: false, error: "not_configured" }, 503);
  return json({ ok: !!(await sessionFrom(request, env)) });
}

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return json({ ok: false, error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
  let code = "";
  try { code = String((await request.json()).code || "").slice(0, 200); } catch (e) {}
  if (!(await checkCode(env, code))) {
    await new Promise((r) => setTimeout(r, 1200));   // slow down guessing
    return json({ ok: false, error: "wrong_code" }, 401);
  }
  return json({ ok: true }, 200, { "set-cookie": cookie(await newSession(env), SESSION_DAYS * 86400) });
}

export async function onRequestDelete() {
  return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
}
