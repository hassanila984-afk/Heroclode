import { configured, sessionFrom, sameOrigin, json } from "../../lib/auth.js";

// Luma Link: the person's own devices (phone, computer, tablet) see each other and pass jobs between them,
// so Luma is one companion across all three. Everything here is scoped to this one account (same session
// cookie), kept only in KV with a short time-to-live, and nothing device-unlocking ever passes through it.
//
//  POST ?do=ping   {id, name, caps}        -> registers this device as online (~45s), returns the other
//                                             online devices and any jobs waiting for this one (and clears them)
//  POST ?do=send   {from, to, action, arg} -> queues one job for another device (picked up on its next ping)
//  POST ?do=bye    {id}                     -> this device is going offline
const PRESENCE_TTL = 65;      // a device not seen for this long drops off the list (KV requires >= 60s)
const CMD_TTL = 90;           // a job waits at most this long for its device to pick it up
const MAX_PENDING = 20;

const devKey = (id) => "link:dev:" + id;
const cmdKey = (id) => "link:cmd:" + id;
const clean = (s, n) => String(s == null ? "" : s).slice(0, n);

export async function onRequestPost({ request, env }) {
  if (!configured(env) || !env.FIREFLY_KV) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!(await sessionFrom(request, env))) return json({ error: "signed_out" }, 401);

  const action = new URL(request.url).searchParams.get("do");
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const id = clean(action === "send" ? body.from : body.id, 40).replace(/[^\w-]/g, "");
  if (!id) return json({ error: "bad_request" }, 400);

  if (action === "bye") {
    await env.FIREFLY_KV.delete(devKey(id));
    return json({ ok: true });
  }

  if (action === "send") {
    const to = clean(body.to, 40).replace(/[^\w-]/g, "");
    if (!to || to === id) return json({ error: "bad_request" }, 400);
    const cmd = { from: id, action: clean(body.action, 40).replace(/[^\w]/g, ""), arg: clean(body.arg, 2000), at: Date.now() };
    if (!cmd.action) return json({ error: "bad_request" }, 400);
    const list = (await env.FIREFLY_KV.get(cmdKey(to), "json")) || [];
    list.push(cmd);
    while (list.length > MAX_PENDING) list.shift();
    await env.FIREFLY_KV.put(cmdKey(to), JSON.stringify(list), { expirationTtl: CMD_TTL });
    return json({ ok: true });
  }

  // ping (the default): refresh this device's presence, read who else is online and our pending jobs
  const now = Date.now();
  const idle = Math.max(0, Math.min(99999, Number(body.idle) || 0));   // seconds since he last touched this device
  const me = { id, name: clean(body.name, 40) || id, caps: Array.isArray(body.caps) ? body.caps.slice(0, 12).map((c) => clean(c, 24)) : [], at: now, idle };
  await env.FIREFLY_KV.put(devKey(id), JSON.stringify(me), { expirationTtl: PRESENCE_TTL });

  const others = [];
  let active = { id: me.id, name: me.name, idle: me.idle };   // who he's using right now (lowest idle, must be recent)
  let cursor;
  do {
    const page = await env.FIREFLY_KV.list({ prefix: "link:dev:", cursor });
    for (const k of page.keys) {
      const d = await env.FIREFLY_KV.get(k.name, "json");
      if (!d || now - d.at >= PRESENCE_TTL * 1000) continue;
      if (d.id !== id) others.push({ id: d.id, name: d.name, caps: d.caps || [] });
      if ((d.idle || 0) < active.idle) active = { id: d.id, name: d.name, idle: d.idle || 0 };
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const activeDev = active.idle < 150 ? { id: active.id, name: active.name } : null;   // nobody active lately: don't guess

  const pending = (await env.FIREFLY_KV.get(cmdKey(id), "json")) || [];
  if (pending.length) await env.FIREFLY_KV.delete(cmdKey(id));

  return json({ ok: true, devices: others, active: activeDev, jobs: pending });
}
