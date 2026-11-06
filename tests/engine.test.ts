import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthorized, runAction, runEngine, runReceipt, ttlFor } from "../supabase/functions/_shared/engine.ts";
import { b64urlEncode, verifyAction } from "../supabase/functions/_shared/webpush.ts";
import { decrypt } from "./webpush.test.ts";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const R = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

async function vapid() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { vapid_public: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))), vapid_private: jwk.d! };
}

async function subscriber() {
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    keys, auth,
    p256dh: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey))),
    authB64: b64urlEncode(auth),
  };
}

test("il motore invia, firma il pulsante Fatto, pulisce i telefoni non più validi e registra tutto", async () => {
  const secrets = { ...(await vapid()), action_secret: "segreto-azioni", motore_key: "k" };
  const s1 = await subscriber();
  const s2 = await subscriber();
  const calls: { url: string; method: string; body?: unknown; headers: Record<string, string> }[] = [];
  const pushes: { url: string; body: Uint8Array; headers: Record<string, string> }[] = [];

  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const method = init.method ?? "GET";
    if (url.startsWith("https://push.example/")) {
      pushes.push({ url, body: init.body as Uint8Array, headers });
      return new Response(null, { status: url.endsWith("/ok") ? 201 : 410 });
    }
    calls.push({ url, method, headers, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/rpc/claim_work")) {
      return Response.json([
        { user_id: A, reminder_id: R, kind: "promemoria", title: "Chiama la pediatra", body: "Urgente · da Giulia", urgent: true, actions: true, count: 1 },
        { user_id: B, reminder_id: R, kind: "fatto", title: "Domenico ha fatto: X", body: "ok", urgent: false, actions: false },
      ]);
    }
    if (url.includes("/reminders?select=id,repeat_minutes,end_at")) {
      return Response.json([{ id: R, repeat_minutes: 60, end_at: null }]);
    }
    if (url.includes("/push_subscriptions?select=")) {
      return Response.json([
        { id: "s-ok", user_id: A, endpoint: "https://push.example/ok", p256dh: s1.p256dh, auth: s1.authB64 },
        { id: "s-gone", user_id: A, endpoint: "https://push.example/gone", p256dh: s2.p256dh, auth: s2.authB64 },
      ]);
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const env = { supabaseUrl: "https://prog.supabase.co", serviceKey: "sb_secret_abc", fetchImpl };
  const summary = await runEngine(env, secrets);
  assert.deepEqual(summary, { items: 2, sent: 1, failed: 1, noDevice: 1 });

  // le chiavi nuove "sb_secret" non devono finire nell'intestazione Authorization
  assert.ok(calls.every((c) => c.headers.apikey === "sb_secret_abc" && !c.headers.Authorization));

  assert.equal(pushes.length, 2);
  const p = pushes.find((x) => x.url.endsWith("/ok"))!;
  assert.equal(p.headers["Content-Encoding"], "aes128gcm");
  assert.equal(p.headers.Urgency, "high");
  assert.equal(p.headers.Topic, R.replace(/-/g, ""));
  assert.equal(p.headers.TTL, "3600", "con la ripetizione ogni ora si riprova per un'ora");
  assert.match(p.headers.Authorization, /^vapid t=.+, k=/);
  const msg = JSON.parse(await decrypt(new Uint8Array(p.body), s1.keys, s1.auth));
  assert.equal(msg.title, "Chiama la pediatra");
  assert.equal(msg.tag, `promemoria-${R}`);
  assert.equal(msg.count, 1, "numero dell'avviso passato al telefono");
  assert.equal(msg.url, `/?apri=${R}`);
  assert.equal(msg.actions, true);
  assert.equal(msg.action.url, "https://prog.supabase.co/functions/v1/azione");
  assert.ok(await verifyAction("segreto-azioni", `${R}.${A}.${msg.action.exp}`, msg.action.sig));
  // ricevuta firmata, diversa per ogni telefono
  assert.match(msg.receipt.id, /^[0-9a-f-]{36}$/);
  assert.equal(msg.receipt.url, "https://prog.supabase.co/functions/v1/azione");
  assert.ok(await verifyAction("segreto-azioni", `ricevuta.${msg.receipt.id}`, msg.receipt.sig));
  assert.ok(calls.some((c) => c.url.endsWith("/rpc/roll_recurring")), "i ricorrenti vengono rinnovati prima");
  assert.ok(calls.findIndex((c) => c.url.endsWith("/rpc/roll_recurring")) < calls.findIndex((c) => c.url.endsWith("/rpc/claim_work")));

  const del = calls.find((c) => c.method === "DELETE");
  assert.ok(del && del.url.includes("id=in.(s-gone)"), "telefono non valido cancellato");
  const patch = calls.find((c) => c.method === "PATCH");
  assert.ok(patch && patch.url.includes("id=in.(s-ok)"));
  const log = calls.find((c) => c.url.endsWith("/rest/v1/push_log"));
  assert.equal((log!.body as unknown[]).length, 3);
  const rows = log!.body as { ok: boolean; delivery_id: string | null }[];
  assert.equal(rows.find((l) => l.ok)!.delivery_id, msg.receipt.id, "il registro conserva il numero della ricevuta");
  assert.ok((log!.body as { error: string | null }[]).some((l) => l.error === "nessun telefono con le notifiche attive"));
});

test("nessun lavoro: nessuna lettura dei telefoni", async () => {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    urls.push(String(input));
    return String(input).endsWith("/rpc/roll_recurring") ? Response.json(0) : Response.json([]);
  }) as typeof fetch;
  const summary = await runEngine({ supabaseUrl: "https://p", serviceKey: "k", fetchImpl }, await vapid());
  assert.equal(summary.items, 0);
  assert.deepEqual(urls, ["https://p/rest/v1/rpc/roll_recurring", "https://p/rest/v1/rpc/claim_work"]);
});

test("se il rinnovo dei ricorrenti fallisce, le notifiche partono lo stesso", async () => {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    urls.push(String(input));
    if (String(input).endsWith("/rpc/roll_recurring")) return new Response("boom", { status: 500 });
    return Response.json([]);
  }) as typeof fetch;
  const summary = await runEngine({ supabaseUrl: "https://p", serviceKey: "k", fetchImpl }, await vapid());
  assert.equal(summary.items, 0);
  assert.ok(urls.some((u) => u.endsWith("/rpc/claim_work")));
});

test("errore temporaneo del servizio di notifiche: secondo tentativo", async () => {
  const secrets = { ...(await vapid()), action_secret: "s" };
  const sub = await subscriber();
  let attempts = 0;
  let logRows: { ok: boolean; status: number }[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith("https://push.example/")) {
      attempts++;
      return new Response(null, { status: attempts === 1 ? 503 : 201 });
    }
    if (url.endsWith("/rpc/claim_work")) {
      return Response.json([{ user_id: A, reminder_id: R, kind: "promemoria", title: "Pane", body: "x", urgent: false, actions: true, count: 1 }]);
    }
    if (url.includes("/reminders?select=")) return Response.json([{ id: R, repeat_minutes: 0, end_at: null }]);
    if (url.includes("/push_subscriptions?select=")) {
      return Response.json([{ id: "s1", user_id: A, endpoint: "https://push.example/a", p256dh: sub.p256dh, auth: sub.authB64 }]);
    }
    if (url.endsWith("/rest/v1/push_log")) logRows = JSON.parse(String(init.body));
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const summary = await runEngine({ supabaseUrl: "https://p", serviceKey: "k", fetchImpl, retryDelayMs: 0 }, secrets);
  assert.equal(attempts, 2);
  assert.deepEqual(summary, { items: 1, sent: 1, failed: 0, noDevice: 0 });
  assert.equal(logRows[0].ok, true);
});

test("per quanto riprovare la consegna", () => {
  const now = Date.parse("2026-11-06T10:00:00Z");
  assert.equal(ttlFor("fatto"), 86400);
  assert.equal(ttlFor("promemoria"), 1800, "senza dati: mezz'ora");
  assert.equal(ttlFor("promemoria", { repeat_minutes: 15, end_at: null }), 1800);
  assert.equal(ttlFor("promemoria", { repeat_minutes: 60, end_at: null }), 3600);
  assert.equal(ttlFor("promemoria", { repeat_minutes: 0, end_at: null }), 6 * 3600, "avviso unico: meglio in ritardo che mai");
  assert.equal(ttlFor("promemoria", { repeat_minutes: 0, end_at: "2026-11-06T14:00:00Z" }, now), 4 * 3600, "fino all'orario limite");
  assert.equal(ttlFor("promemoria", { repeat_minutes: 0, end_at: "2026-11-06T10:05:00Z" }, now), 1800, "almeno mezz'ora");
});

test("ricevuta dal telefono", async () => {
  const { signAction } = await import("../supabase/functions/_shared/webpush.ts");
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  const env = { supabaseUrl: "https://p", serviceKey: "k", fetchImpl };
  const secrets = { action_secret: "s" };
  const id = crypto.randomUUID();
  const ok = await runReceipt(env, secrets, { ricevuta: id, firma: await signAction("s", `ricevuta.${id}`) });
  assert.equal(ok.status, 200);
  assert.equal(calls[0].url, "https://p/rest/v1/push_receipts?on_conflict=delivery_id");
  assert.deepEqual(calls[0].body, { delivery_id: id });
  assert.match(calls[0].headers.Prefer, /ignore-duplicates/);
  assert.equal((await runReceipt(env, secrets, { ricevuta: id, firma: "falsa" })).status, 401);
  assert.equal((await runReceipt(env, secrets, { ricevuta: "non-un-numero", firma: "x" })).status, 400);
  // la firma di un pulsante Fatto non vale come ricevuta
  const exp = Math.floor(Date.now() / 1000) + 60;
  assert.equal((await runReceipt(env, secrets, { ricevuta: id, firma: await signAction("s", `${id}.${A}.${exp}`) })).status, 401);
  assert.equal(calls.length, 1);
});

test("autorizzazione del motore", async () => {
  const fetchImpl = (async (_: string | URL, init: RequestInit = {}) => {
    const auth = (init.headers as Record<string, string>).Authorization;
    return auth === "Bearer a.b.c" ? Response.json({ id: A }) : new Response("{}", { status: 401 });
  }) as typeof fetch;
  const env = { supabaseUrl: "https://p", serviceKey: "k", fetchImpl };
  const secrets = { motore_key: "chiave" };
  assert.ok(await isAuthorized(env, new Request("https://f", { headers: { "x-motore-key": "chiave" } }), secrets));
  assert.equal(await isAuthorized(env, new Request("https://f", { headers: { "x-motore-key": "no" } }), secrets), false);
  assert.ok(await isAuthorized(env, new Request("https://f", { headers: { authorization: "Bearer a.b.c" } }), secrets));
  assert.equal(await isAuthorized(env, new Request("https://f", { headers: { authorization: "Bearer x.y.z" } }), secrets), false);
  assert.equal(await isAuthorized(env, new Request("https://f"), secrets), false);
});

test("pulsante Fatto dalla notifica", async () => {
  const { signAction } = await import("../supabase/functions/_shared/webpush.ts");
  let called: unknown = null;
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    called = { url: String(input), body: JSON.parse(String(init.body)) };
    return Response.json({ id: R, title: "Compra il pane" });
  }) as typeof fetch;
  const env = { supabaseUrl: "https://p", serviceKey: "k", fetchImpl };
  const secrets = { action_secret: "s" };
  const exp = Math.floor(Date.now() / 1000) + 60;
  const sig = await signAction("s", `${R}.${A}.${exp}`);
  const ok = await runAction(env, secrets, { id: R, u: A, exp, sig });
  assert.equal(ok.status, 200);
  assert.deepEqual(called, { url: "https://p/rest/v1/rpc/complete_from_notification", body: { p_id: R, p_user: A } });
  assert.equal((await runAction(env, secrets, { id: R, u: B, exp, sig })).status, 401);
  const old = Math.floor(Date.now() / 1000) - 1;
  assert.equal((await runAction(env, secrets, { id: R, u: A, exp: old, sig: await signAction("s", `${R}.${A}.${old}`) })).status, 401);
  assert.equal((await runAction(env, secrets, {})).status, 400);
});
