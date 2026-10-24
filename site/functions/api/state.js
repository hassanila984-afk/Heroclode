import { configured, sessionFrom, sameOrigin, json } from "../../lib/auth.js";

// One Firefly for all their devices: what Luma remembers, their fireflies, their nights. Signed-in devices
// read it (GET) and save it (PUT {state, savedAt}); the newest save wins, and an older one gets the
// newer copy back (409) so that device catches up instead of overwriting it.
const KEY = "state:v1";
const MAX = 600_000;

export async function onRequestGet({ request, env }) {
  if (!configured(env) || !env.FIREFLY_KV) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!(await sessionFrom(request, env))) return json({ error: "signed_out" }, 401);
  const saved = await env.FIREFLY_KV.get(KEY, "json");
  return json(saved || { state: null, savedAt: 0 });
}

export async function onRequestPut({ request, env }) {
  if (!configured(env) || !env.FIREFLY_KV) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!(await sessionFrom(request, env))) return json({ error: "signed_out" }, 401);
  if (Number(request.headers.get("content-length") || 0) > MAX) return json({ error: "too_large" }, 413);
  const text = await request.text();
  if (text.length > MAX) return json({ error: "too_large" }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: "bad_request" }, 400); }
  const savedAt = Number(body && body.savedAt);
  if (!body || typeof body.state !== "object" || !body.state || !Number.isFinite(savedAt)) return json({ error: "bad_request" }, 400);
  const current = await env.FIREFLY_KV.get(KEY, "json");
  if (current && current.savedAt > savedAt) return json(current, 409);
  await env.FIREFLY_KV.put(KEY, JSON.stringify({ state: body.state, savedAt }));
  return json({ ok: true, savedAt });
}
