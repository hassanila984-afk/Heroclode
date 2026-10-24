import { configured, sessionFrom, sameOrigin, json, voiceKey } from "../../lib/auth.js";

// Speech to text: what they say to her on a voice call (?lang=en: Qwen3-ASR through DeepInfra, under a
// second, with Cloudflare's Whisper as the fallback), and the call's sound (friends on Discord and the like). The page sends only short stretches where
// someone is talking; nothing is kept.
const MAX_AUDIO = 700_000;   // ~20 s of 16 kHz mono WAV

export async function onRequestPost({ request, env }) {
  const lang = new URL(request.url).searchParams.get("lang");
  if (!configured(env) || (!env.AI && lang !== "en")) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!(await sessionFrom(request, env))) return json({ error: "signed_out" }, 401);
  const audio = new Uint8Array(await request.arrayBuffer());
  if (audio.length < 2000 || audio.length > MAX_AUDIO) return json({ error: "bad_request" }, 400);
  if (lang === "en") {
    const key = await voiceKey(env);
    if (key) {
      try {
        const form = new FormData();
        form.append("file", new Blob([audio], { type: "audio/wav" }), "clip.wav");
        form.append("model", "Qwen/Qwen3-ASR-1.7B");
        form.append("language", "en");
        form.append("prompt", "Talking with Luma.");
        const r = await fetch("https://api.deepinfra.com/v1/openai/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + key }, body: form });
        if (r.ok) { const d = await r.json(); return json({ text: String(d.text || "").trim().slice(0, 500) }); }
      } catch (e) { }
    }
    if (!env.AI) return json({ error: "upstream" }, 502);
  }
  let b64 = "";
  for (let i = 0; i < audio.length; i += 0x8000) b64 += String.fromCharCode(...audio.subarray(i, i + 0x8000));
  try {
    // talking to her: English, her name spelled right, silence skipped (so noise isn't turned into words)
    const opts = lang === "en" ? { language: "en", vad_filter: true, initial_prompt: "Talking with Luma." } : {};
    const out = await env.AI.run("@cf/openai/whisper-large-v3-turbo", Object.assign({ audio: btoa(b64) }, opts));
    return json({ text: String((out && out.text) || "").trim().slice(0, 500) });
  } catch (e) {
    return json({ error: "upstream" }, 502);
  }
}
