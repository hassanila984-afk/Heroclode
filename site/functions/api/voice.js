import { configured, sessionFrom, sameOrigin, json, voiceKey } from "../../lib/auth.js";

// Luma's voice. Signed-in devices only, short lines only. Returns MP3.
// Inworld TTS (through DeepInfra, with the saved DeepInfra key) streams the audio back as it's made, so a
// plain <audio src="/api/voice?t=…&m=happy"> starts playing within half a second. English uses Realtime
// TTS 2, told how to sound from her mood (warm, caring, teasing…), so she never sounds flat. English only:
// on calls she always answers in English. Without the key, or if Inworld fails, Cloudflare's Aura voice is used.
const MODEL = "inworld-ai/realtime-tts-2";
const VOICES = ["Luna", "Ashley", "Sarah", "Kayla", "Lauren", "Olivia"];   // natural young women's voices (Luna is hers); picked on the You page
// more voices for the other characters in her Reels (Rita, her goth friend); not offered on the You page
const CAST = ["Deborah", "Elizabeth", "Veronica", "Victoria", "Serena", "Celeste", "Claire", "Julia", "Miranda", "Hana", "Evelyn", "Tessa", "Chloe", "Wendy"];
const ALL_VOICES = VOICES.concat(CAST);
// how she sounds, by the feeling she's showing as she says it: always a real person, never acted or cartoonish
const NATURAL = "natural, like a real person chatting with a friend";
const TONE = {
  happy: `warm and happy, lightly smiling, ${NATURAL}`,
  excited: `genuinely happy and a little excited, not over the top, ${NATURAL}`,
  shy: `a little shy and sweet, ${NATURAL}`,
  pout: `playfully annoyed and teasing, ${NATURAL}`,
  ignore: `playfully annoyed and teasing, ${NATURAL}`,
  sad: "gentle and caring, soft-spoken, a real person",
  sleepy: `a bit sleepy and relaxed, ${NATURAL}`,
  thinking: `relaxed and curious, warm, ${NATURAL}`,
  listening: `relaxed and warm, lightly smiling, ${NATURAL}`,
  // Rita: calm and sure of herself, low and soft, a little cool on top but kind underneath
  cool: "calm, confident and unhurried, low soft voice, a little cool and dry, kind underneath, a real person talking to one friend",
};
// when she sings (s=1): a little song, voice only
const SINGING = "singing softly, a sweet lullaby melody, held notes";
const MAX_TEXT = 900;

// GET /api/voice?t=<text>&v=<voice>: streamed, for <audio src>. POST {text, voice}: the same, for fetch().
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  if (u.searchParams.get("diag") === "1") return diag(request, env);
  return speak(request, env, u.searchParams.get("t"), u.searchParams.get("v"), u.searchParams.get("s") === "1" ? "sing" : u.searchParams.get("m"));
}
export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch (e) {}
  return speak(request, env, body.text, body.voice, body.mood);
}

// GET /api/voice?diag=1: is her real (Inworld) voice working? {ok, status, detail}, so the app can say why not
async function diag(request, env) {
  if (!configured(env) || !sameOrigin(request) || !(await sessionFrom(request, env))) return json({ error: "forbidden" }, 403);
  const key = await voiceKey(env);
  if (!key) return json({ ok: false, status: 0, detail: "no DeepInfra key saved" });
  try {
    const r = await fetch("https://api.deepinfra.com/v1/inference/" + MODEL, {
      method: "POST",
      headers: { authorization: "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({ text: "hi", voice: VOICES[0], output_format: "mp3" }),
    });
    if (r.ok) return json({ ok: true, status: r.status });
    return json({ ok: false, status: r.status, detail: (await r.text()).slice(0, 200) });
  } catch (e) {
    return json({ ok: false, status: -1, detail: String(e).slice(0, 200) });
  }
}

async function speak(request, env, rawText, voice, mood) {
  if (!configured(env)) return json({ error: "not_configured" }, 503);
  const site = request.headers.get("sec-fetch-site");
  if (!sameOrigin(request) || (site && site !== "same-origin")) return json({ error: "forbidden" }, 403);
  if (!(await sessionFrom(request, env))) return json({ error: "signed_out" }, 401);
  if (/[\u0600-\u06FF]/.test(String(rawText || ""))) return json({ error: "english_only" }, 400);
  const text = sayEnglish(String(rawText || "").slice(0, MAX_TEXT));
  if (!text.replace(/\[[a-z_]+\]/g, "").trim()) return json({ error: "bad_request" }, 400);

  const key = await voiceKey(env);
  for (let i = 0; key && i < 2; i++) {
    try {
      const r = await fetch("https://api.deepinfra.com/v1/inference/" + MODEL, {
        method: "POST",
        headers: { authorization: "Bearer " + key, "content-type": "application/json" },
        body: JSON.stringify({ text: `[${mood === "sing" ? SINGING : TONE[mood] || TONE.listening}] ` + text, voice: ALL_VOICES.includes(voice) ? voice : VOICES[0], output_format: "mp3", stream: true }),
      });
      if (r.ok && r.body) return new Response(r.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
      if (r.status < 500) break;   // key or balance problem: retrying won't help
    } catch (e) { }
  }
  // fallback: Aura
  if (!env.AI) return json({ error: "upstream" }, 502);
  try {
    const plain = text.replace(/\[[a-z_]+\]/g, " ").replace(/\s+/g, " ").trim();
    const out = await env.AI.run("@cf/deepgram/aura-2-en", { text: plain, speaker: "luna", encoding: "mp3" }, { returnRawResponse: true });
    const audio = out instanceof Response ? await out.arrayBuffer() : out;
    return new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (e) {
    return json({ error: "upstream" }, 502);
  }
}

// Chat text -> words that sound right out loud. Her messages are written like texts ("ngl", "lmaooo",
// "WAIT", "sooo~", emojis); read literally those come out as spelled letters and noise.
const SLANG = {
  ngl: "not gonna lie", idk: "I don't know", idc: "I don't care", tbh: "to be honest", fr: "for real", frfr: "for real for real",
  rn: "right now", omg: "oh my god", omfg: "oh my god", pls: "please", plz: "please", ty: "thank you", thx: "thanks", tho: "though",
  u: "you", ur: "your", r: "are", ya: "ya", bc: "because", cuz: "cause", btw: "by the way", imo: "in my opinion", jk: "just kidding",
  nvm: "never mind", ofc: "of course", smh: "", wdym: "what do you mean", ikr: "I know right", lowkey: "lowkey", highkey: "highkey",
  gn: "good night", gm: "good morning", ily: "I love you", bestie: "bestie", w: "", l: "",
};
export function sayEnglish(s) {
  return s
    .replace(/https?:\/\/\S+/g, " a link ")
    .replace(/\*\s*(giggles?|giggling|chuckles?|laughs?|laughing)\s*\*/gi, " [laugh] ")
    .replace(/\*\s*sighs?\s*\*/gi, " [sigh] ").replace(/\*\s*yawns?\s*\*/gi, " [yawn] ")
    .replace(/\*\s*(groans?|groaning|whines?|whining|grumbles?|tired(ly)? (moans?|groans?)|moans? tiredly)\s*\*/gi, " [groan] ")   // a tired groan
    .replace(/\*[^*\n]{1,40}\*/g, " ")                                                  // other *actions*
    .replace(/\b(l+m+f*a+o+|lo+l+|ha(ha)+h?|he(he)+h?|hi(hi)+|tee+hee+|kek)\b/gi, " [laugh] ")
    .replace(/\b[A-Za-z]+\b/g, (w) => {
      const k = w.toLowerCase();
      if (k in SLANG) return SLANG[k] === "" ? " " : (SLANG[k] === k ? w : SLANG[k]);
      return w;
    })
    .replace(/\b([A-Z]{2,})\b/g, (w) => (w === "OK" ? "okay" : w.toLowerCase()))   // "WAIT WHAT" is shouting, not letters
    .replace(/([a-z])\1{2,}/gi, "$1$1")                                               // "sooooo" -> "soo"
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/[~_#>|]/g, " ").replace(/\.{2,}|…/g, ", ")
    .replace(/(\[laugh\]\s*){2,}/g, "[laugh] ")
    .replace(/\s+([,.!?])/g, "$1").replace(/\s+/g, " ").trim()
    .replace(/\[groan\]/g, "[groan] Uuughhh... mmhh...");   // (after the clean-up, which would shorten it)
}
