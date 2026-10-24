import Anthropic from "@anthropic-ai/sdk";
import { configured, sessionFrom, sameOrigin, json, apiKey } from "../../lib/auth.js";

// Luma's brain on Firefly's own site. Only signed-in devices may call it, the model is fixed on the
// server, and every request is size-capped, so a stolen page or cookie can't run up a big bill.
const MAX_BODY = 3_500_000, MAX_TURNS = 40, MAX_TEXT = 60_000, MAX_IMAGES = 2, MAX_IMAGE_B64 = 1_500_000;

export async function onRequestPost({ request, env, waitUntil }) {
  if (!configured(env)) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const who = await sessionFrom(request, env);
  if (!who) return json({ error: "signed_out" }, 401);
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return json({ error: "too_large" }, 413);
  const key = await apiKey(env);
  if (!key) return json({ error: "not_configured" }, 503);
  if (!(await underDailyLimit(env, who.id, waitUntil))) return json({ error: "daily_limit" }, 429);

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

  // Sonnet, so she follows the conversation and doesn't go round in circles. Chat: no thinking first (it
  // only delays her first word). A real task (a puzzle, math, code, homework…; the page marks it): she
  // thinks it through first.
  const hard = body.hard === true;
  const model = "claude-sonnet-5-5";
  const client = new Anthropic({ apiKey: key, defaultHeaders: { "x-api-key": key } });
  // the long, steady start of the conversation (her personality) is cached so it isn't re-read every turn
  const params = hard
    ? { model, max_tokens: 16000, output_config: { effort: "medium" }, thinking: { type: "adaptive" }, cache_control: { type: "ephemeral" }, messages }
    : { model, max_tokens: 2000, output_config: { effort: "low" }, thinking: model === "claude-sonnet-5-5" ? { type: "between_tools" } : { type: "disabled" }, cache_control: { type: "ephemeral" }, messages };
  // she may look things up on the web for a chat reply (not while glancing at the screen)
  if (!images.length) params.tools = [model === "claude-haiku-5-5" ? { type: "web_search_20250305", name: "web_search", max_uses: 3 } : { type: "web_search_20250305", name: "web_search", max_uses: 3 }];
  // Opus and Sonnet can hand a refused reply to another model instead of failing
  const open = (p) => p.model === "claude-haiku-5-5"
    ? client.messages.stream(p)
    : client.beta.messages.stream(Object.assign({}, p, { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }));
  // if the thinking model can't answer at all, the usual one does (she never just goes quiet)
  const quick = { model: "claude-haiku-5-5", max_tokens: 1500, output_config: { effort: "low" }, thinking: { type: "disabled" }, cache_control: { type: "ephemeral" }, messages,
    tools: images.length ? undefined : [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] };
  if (!quick.tools) delete quick.tools;

  // stream the text back as server-sent events: {t} pieces, then {done} or {error}
  const out = new TransformStream(), w = out.writable.getWriter(), te = new TextEncoder();
  const send = (o) => w.write(te.encode(`data: ${JSON.stringify(o)}\n\n`));
  (async () => {
    let sent = false;
    const run = async (p) => {
      const stream = open(p);
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { sent = true; await send({ t: ev.delta.text }); }
      }
      return stream.finalMessage();
    };
    try {
      let msg;
      try { msg = await run(params); }
      catch (e) { if (sent || params.model === "claude-haiku-5-5") throw e; msg = await run(quick); }
      await send(msg.stop_reason === "refusal" ? { error: "refused" } : { done: true, by: msg.model });
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
async function underDailyLimit(env, id, waitUntil) {
  if (!env.FIREFLY_KV) return true;
  const limit = Number(env.DAILY_LIMIT || 1500);
  const key = `n:${new Date().toISOString().slice(0, 10)}:${id}`;
  const n = Number(await env.FIREFLY_KV.get(key)) || 0;
  if (n >= limit) return false;
  const put = env.FIREFLY_KV.put(key, String(n + 1), { expirationTtl: 2 * 86400 });
  if (waitUntil) waitUntil(put); else await put;   // counting doesn't hold up her reply
  return true;
}
