import Anthropic from "@anthropic-ai/sdk";
import { configured, sessionFrom, sameOrigin, json } from "../../lib/auth.js";

// Luma's brain on Firefly's own site. Only signed-in devices may call it, the model is fixed on the
// server, and every request is size-capped, so a stolen page or cookie can't run up a big bill.
const MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
const MAX_BODY = 3_500_000, MAX_TURNS = 40, MAX_TEXT = 60_000, MAX_IMAGES = 2, MAX_IMAGE_B64 = 1_500_000;

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const who = await sessionFrom(request, env);
  if (!who) return json({ error: "signed_out" }, 401);
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return json({ error: "too_large" }, 413);
  if (!(await underDailyLimit(env, who.id))) return json({ error: "daily_limit" }, 429);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "bad_request" }, 400); }
  const turns = Array.isArray(body.messages) ? body.messages.slice(-MAX_TURNS) : [];
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES);
  if (!turns.length || images.some((d) => typeof d !== "string" || d.length > MAX_IMAGE_B64)) return json({ error: "bad_request" }, 400);

  // plain alternating turns, text only from the page; pictures go on the last (user) turn
  const messages = [];
  let total = 0;
  for (const t of turns) {
    const role = t && t.role === "assistant" ? "assistant" : "user";
    const text = String((t && t.content) || "").trim() || "…";
    total += text.length;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content[0].text += "\n\n" + text;
    else messages.push({ role, content: [{ type: "text", text }] });
  }
  if (total > MAX_TEXT) return json({ error: "too_large" }, 413);
  if (messages[0].role !== "user") messages.unshift({ role: "user", content: [{ type: "text", text: "(we began talking)" }] });
  if (messages[messages.length - 1].role !== "user") return json({ error: "bad_request" }, 400);
  const lastTurn = messages[messages.length - 1].content;
  images.forEach((data) => lastTurn.unshift({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));

  const model = MODELS.includes(env.MODEL) ? env.MODEL : "claude-haiku-5-5";
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const params = { model, max_tokens: 1500, output_config: { effort: "low" }, messages };
  // Opus and Sonnet can hand a refused reply to another model instead of failing
  const stream = model === "claude-haiku-5-5"
    ? client.messages.stream(params)
    : client.beta.messages.stream(Object.assign(params, { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }));

  // stream the text back as server-sent events: {t} pieces, then {done} or {error}
  const out = new TransformStream(), w = out.writable.getWriter(), te = new TextEncoder();
  const send = (o) => w.write(te.encode(`data: ${JSON.stringify(o)}\n\n`));
  (async () => {
    try {
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") await send({ t: ev.delta.text });
      }
      const msg = await stream.finalMessage();
      await send(msg.stop_reason === "refusal" ? { error: "refused" } : { done: true });
    } catch (e) {
      const code = e instanceof Anthropic.RateLimitError ? "rate_limited"
        : e instanceof Anthropic.AuthenticationError ? "not_configured"
        : e instanceof Anthropic.BadRequestError ? "bad_request"
        : "upstream";
      await send({ error: code });
    } finally { await w.close(); }
  })();
  return new Response(out.readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}

// Optional daily cap per signed-in device (needs a KV namespace bound as FIREFLY_KV).
async function underDailyLimit(env, id) {
  if (!env.FIREFLY_KV) return true;
  const limit = Number(env.DAILY_LIMIT || 1500);
  const key = `n:${new Date().toISOString().slice(0, 10)}:${id}`;
  const n = Number(await env.FIREFLY_KV.get(key)) || 0;
  if (n >= limit) return false;
  await env.FIREFLY_KV.put(key, String(n + 1), { expirationTtl: 2 * 86400 });
  return true;
}
