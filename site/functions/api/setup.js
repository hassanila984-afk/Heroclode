import Anthropic from "@anthropic-ai/sdk";
import { configured, sameSecret, sameOrigin, json, saveApiKey, apiKey, saveSecret, voiceKey } from "../../lib/auth.js";

// One-time setup from /setup.html: with the access code, save the Anthropic API key and/or the DeepInfra
// key for Luma's voice (each checked first).
export async function onRequestGet({ env }) {
  if (!configured(env)) return json({ ready: false, error: "not_configured" }, 503);
  const k = await apiKey(env);
  // the same short hint the Anthropic console shows, to tell which key is saved
  return json({ ready: !!k, key: k ? k.slice(0, 14) + "..." + k.slice(-4) : null, voice: !!(await voiceKey(env)) });
}

export async function onRequestPost({ request, env }) {
  if (!configured(env) || !env.FIREFLY_KV) return json({ ok: false, error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  if (!(await sameSecret(String(body.code || "").slice(0, 200), env.ACCESS_CODE))) {
    await new Promise((r) => setTimeout(r, 1200));
    return json({ ok: false, error: "wrong_code" }, 401);
  }
  const key = String(body.key || "").trim(), vkey = String(body.voiceKey || "").trim();
  if (!key && !vkey) return json({ ok: false, error: "not_an_api_key" }, 400);
  if (vkey) {
    if (!/^[\w-]{16,200}$/.test(vkey)) return json({ ok: false, error: "voice_key_rejected" }, 400);
    // a tiny real line, so a key that can't make her voice is never saved
    const r = await fetch("https://api.deepinfra.com/v1/openai/audio/speech", {
      method: "POST", headers: { authorization: "Bearer " + vkey, "content-type": "application/json" },
      body: JSON.stringify({ model: "canopylabs/orpheus-3b-0.1-ft", input: "Hi!", voice: "tara", response_format: "mp3" }),
    }).catch(() => null);
    if (!r || !r.ok) return json({ ok: false, error: "voice_key_rejected", status: r ? r.status : 0 }, 400);
    await saveSecret(env, "deepinfra", vkey);
    if (!key) return json({ ok: true });
  }
  if (!/^sk-ant-(api\d\d|usr)-[\w-]{20,400}$/.test(key)) return json({ ok: false, error: "not_an_api_key" }, 400);
  // make sure the key really works before saving it
  try { await new Anthropic({ apiKey: key, defaultHeaders: { "x-api-key": key } }).models.list({ limit: 1 }); }
  catch (e) { return json({ ok: false, error: e instanceof Anthropic.AuthenticationError ? "key_rejected" : "check_failed" }, 400); }
  await saveApiKey(env, key);
  return json({ ok: true });
}
