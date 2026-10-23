import { configured, sessionFrom, sameOrigin, json } from "../../lib/auth.js";

// Speech to text for the call's sound (friends on Discord and the like), with Cloudflare Workers AI
// (Whisper). The page sends only short stretches where someone is talking; nothing is kept.
const MAX_AUDIO = 700_000;   // ~20 s of 16 kHz mono WAV

export async function onRequestPost({ request, env }) {
  if (!configured(env) || !env.AI) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!(await sessionFrom(request, env))) return json({ error: "signed_out" }, 401);
  const audio = new Uint8Array(await request.arrayBuffer());
  if (audio.length < 2000 || audio.length > MAX_AUDIO) return json({ error: "bad_request" }, 400);
  let b64 = "";
  for (let i = 0; i < audio.length; i += 0x8000) b64 += String.fromCharCode(...audio.subarray(i, i + 0x8000));
  try {
    const out = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: btoa(b64) });
    return json({ text: String((out && out.text) || "").trim().slice(0, 500) });
  } catch (e) {
    return json({ error: "upstream" }, 502);
  }
}
