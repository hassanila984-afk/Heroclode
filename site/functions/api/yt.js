import { configured, sessionFrom, sameOrigin, json } from "../../lib/auth.js";

// Watching YouTube together: find a video for what he asked (?q=…) or look one up (?v=<id>), so Luma
// knows what they're watching. Signed-in devices only; only the video's id, title and channel come back.
export async function onRequestGet({ request, env }) {
  if (!configured(env)) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!(await sessionFrom(request, env))) return json({ error: "signed_out" }, 401);
  const u = new URL(request.url), q = (u.searchParams.get("q") || "").slice(0, 200).trim();
  let id = (u.searchParams.get("v") || "").trim();
  try {
    if (!id && q) {
      const r = await fetch("https://www.youtube.com/results?hl=en&search_query=" + encodeURIComponent(q), { headers: { "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" } });
      const html = await r.text();
      const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"/) || html.match(/"videoId":"([\w-]{11})"/);
      if (m) id = m[1];
    }
    if (!/^[\w-]{11}$/.test(id)) return json({ error: "not_found" }, 404);
    const o = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id));
    const d = o.ok ? await o.json() : {};
    return json({ id, title: String(d.title || "").slice(0, 200), channel: String(d.author_name || "").slice(0, 100) });
  } catch (e) {
    return json({ error: "upstream" }, 502);
  }
}
