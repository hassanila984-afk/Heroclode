import { configured, sessionFrom, sameOrigin, json, voiceKey } from "../../lib/auth.js";

// Luma's voice. Signed-in devices only, short lines only. Returns audio.
// Orpheus voices (human, with <giggle> <sigh> <laugh>...) when a DeepInfra key is saved (setup page or DEEPINFRA_KEY);
// otherwise Cloudflare Workers AI (Deepgram Aura 2), with the sound tags taken out.
const ORPHEUS = ["tara", "leah", "jess", "mia", "zoe"];
const VOICES = ["luna", "aurora", "iris", "thalia", "callista", "pandora", "selene", "andromeda", "amalthea", "asteria", "athena", "cora", "delia", "harmonia", "helena", "hera", "juno", "ophelia", "phoebe", "theia", "vesta"];

export async function onRequestPost({ request, env }) {
  if (!configured(env) || !env.AI) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!(await sessionFrom(request, env))) return json({ error: "signed_out" }, 401);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const text = String(body.text || "").trim().slice(0, 600);
  if (!text) return json({ error: "bad_request" }, 400);
  const vkey = ORPHEUS.includes(body.voice) ? await voiceKey(env) : null;
  if (vkey) {
    try {
      const r = await fetch("https://api.deepinfra.com/v1/openai/audio/speech", {
        method: "POST",
        headers: { authorization: "Bearer " + vkey, "content-type": "application/json" },
        body: JSON.stringify({ model: "canopylabs/orpheus-3b-0.1-ft", input: text, voice: body.voice, response_format: "mp3" }),
      });
      if (r.ok) return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "audio/mpeg", "cache-control": "no-store" } });
    } catch (e) { }
    // falls through to Aura below
  }
  const plain = text.replace(/<[a-z]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return json({ error: "bad_request" }, 400);
  const speaker = VOICES.includes(body.voice) ? body.voice : (VOICES.includes(env.VOICE) ? env.VOICE : "luna");
  try {
    const out = await env.AI.run("@cf/deepgram/aura-2-en", { text: plain, speaker, encoding: "mp3" }, { returnRawResponse: true });
    const audio = out instanceof Response ? await out.arrayBuffer() : out;
    return new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (e) {
    return json({ error: "upstream", detail: String(e && e.message || e).slice(0, 200) }, 502);
  }
}
