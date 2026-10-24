import { configured, sessionFrom, sameOrigin, json, voiceKey } from "../../lib/auth.js";

// Speech to text: what they say to her on a voice call (?lang=en: Qwen3-ASR through DeepInfra, under a
// second, with Cloudflare's Whisper as the fallback), and the call's sound (friends on Discord and the like). The page sends only short stretches where
// someone is talking; nothing is kept.
const MAX_AUDIO = 1_000_000;   // ~30 s of 16 kHz mono WAV (a clip, plus their voice sample when it's checking who's talking)

export async function onRequestPost({ request, env }) {
  const lang = new URL(request.url).searchParams.get("lang");
  if (!configured(env) || (!env.AI && lang !== "en")) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!(await sessionFrom(request, env))) return json({ error: "signed_out" }, 401);
  const audio = new Uint8Array(await request.arrayBuffer());
  if (audio.length < 2000 || audio.length > MAX_AUDIO) return json({ error: "bad_request" }, 400);
  // ?ref=<seconds>: the clip starts with a sample of their own voice (that long, then a second of quiet).
  // The words are read from the clip only; a speaker check over the whole thing says whether it's them.
  const ref = Number(new URL(request.url).searchParams.get("ref")) || 0;
  if (lang === "en") {
    const key = await voiceKey(env);
    if (key) {
      try {
        const clip = ref > 0 ? wavFrom(audio, ref + 1) : audio;
        const who = ref > 0 ? isThem(audio, ref, key) : Promise.resolve(null);
        const form = new FormData();
        form.append("file", new Blob([clip], { type: "audio/wav" }), "clip.wav");
        form.append("model", "Qwen/Qwen3-ASR-1.7B");
        form.append("language", "en");
        form.append("prompt", "Talking with Luma.");
        const r = await fetch("https://api.deepinfra.com/v1/openai/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + key }, body: form });
        if (r.ok) {
          let text = String((await r.json()).text || "").trim();
          // fast or muffled speech sometimes comes back in another language (Portuguese, Chinese…): Whisper,
          // held to English, hears that clip again
          if (text && !english(text)) text = (await whisperEn(clip, key)) || text;
          return json({ text: text.slice(0, 500), me: await who });
        }
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

// the WAV from `sec` seconds on (16 kHz mono 16-bit, as the page sends it)
function wavFrom(wav, sec) {
  const start = Math.min(wav.length, 44 + Math.floor(sec * 16000) * 2), n = wav.length - start;
  const out = new Uint8Array(44 + n), v = new DataView(out.buffer);
  out.set(wav.subarray(0, 44)); out.set(wav.subarray(start), 44);
  v.setUint32(4, 36 + n, true); v.setUint32(40, n, true);
  return out;
}
// Is the person talking after their voice sample the same one as in it? (speaker diarization: the
// model labels who speaks when). true / false, or null when it can't tell (too short, an error).
async function isThem(wav, ref, key) {
  try {
    const form = new FormData();
    form.append("audio", new Blob([wav], { type: "audio/wav" }), "who.wav");
    const r = await fetch("https://api.deepinfra.com/v1/inference/nvidia/Nemotron-3-Diarization", { method: "POST", headers: { authorization: "Bearer " + key }, body: form });
    if (!r.ok) return null;
    const segs = (await r.json()).speaker_segments || [];
    const time = (from, to) => {
      const t = {};
      for (const g of segs) { const d = Math.min(g.end, to) - Math.max(g.start, from); if (d > 0) t[g.speaker] = (t[g.speaker] || 0) + d; }
      return t;
    };
    const top = (t) => Object.entries(t).sort((a, b) => b[1] - a[1])[0] || null;
    const mine = top(time(0, ref)), now = top(time(ref + 0.5, 1e9));
    if (!mine || !now || now[1] < 0.6) return null;
    return now[0] === mine[0];
  } catch (e) { return null; }
}

function english(t) {
  const letters = t.match(/\p{L}/gu) || [];
  return !letters.length || letters.filter((c) => c.charCodeAt(0) < 128).length / letters.length > 0.97;
}
async function whisperEn(wav, key) {
  try {
    const form = new FormData();
    form.append("file", new Blob([wav], { type: "audio/wav" }), "clip.wav");
    form.append("model", "openai/whisper-large-v3");
    form.append("language", "en");
    const r = await fetch("https://api.deepinfra.com/v1/openai/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + key }, body: form });
    return r.ok ? String((await r.json()).text || "").trim() : "";
  } catch (e) { return ""; }
}
