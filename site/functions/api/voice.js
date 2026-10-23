import { configured, sessionFrom, sameOrigin, json } from "../../lib/auth.js";

// Luma's voice: text to speech with Cloudflare Workers AI (Deepgram Aura 2). Signed-in devices only,
// short lines only. Returns audio/mpeg.
const VOICES = ["luna", "aurora", "iris", "thalia", "callista", "pandora", "selene", "andromeda", "amalthea", "asteria", "athena", "cora", "delia", "harmonia", "helena", "hera", "juno", "ophelia", "phoebe", "theia", "vesta"];

export async function onRequestPost({ request, env }) {
  if (!configured(env) || !env.AI) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!(await sessionFrom(request, env))) return json({ error: "signed_out" }, 401);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const text = String(body.text || "").trim().slice(0, 600);
  if (!text) return json({ error: "bad_request" }, 400);
  const speaker = VOICES.includes(body.voice) ? body.voice : (VOICES.includes(env.VOICE) ? env.VOICE : "luna");
  try {
    const out = await env.AI.run("@cf/deepgram/aura-2-en", { text, speaker, encoding: "mp3" }, { returnRawResponse: true });
    const audio = out instanceof Response ? await out.arrayBuffer() : out;
    return new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (e) {
    return json({ error: "upstream", detail: String(e && e.message || e).slice(0, 200) }, 502);
  }
}
