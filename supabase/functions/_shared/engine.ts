// Motore delle notifiche: prende dal database cosa va inviato e lo spedisce
// a tutti i telefoni registrati della persona giusta.

import { sendWebPush, signAction, verifyAction, type VapidKeys } from "./webpush.ts";

export interface Env {
  supabaseUrl: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
}

export interface WorkItem {
  user_id: string;
  reminder_id: string | null;
  kind: string;
  title: string;
  body: string;
  urgent: boolean;
  actions: boolean;
  reward?: string | null;
  count?: number;
}

interface SubRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface LogRow {
  user_id: string;
  reminder_id: string | null;
  kind: string;
  ok: boolean;
  status: number | null;
  error: string | null;
  delivery_id: string | null;
}

interface Timing {
  repeat_minutes: number;
  end_at: string | null;
}

/**
 * Per quanto tempo il servizio di notifiche continua a provare a consegnare
 * se il telefono non è raggiungibile (spento, senza rete, in risparmio energetico).
 */
export function ttlFor(kind: string, timing?: Timing, now = Date.now()): number {
  if (kind !== "promemoria") return 86400;
  if (!timing) return 1800;
  // con la ripetizione ne arriva comunque un'altra: basta coprire l'intervallo
  if (timing.repeat_minutes > 0) return Math.max(1800, timing.repeat_minutes * 60);
  // avviso unico: fino all'orario limite, oppure 6 ore (meglio in ritardo che mai)
  if (timing.end_at) return Math.min(86400, Math.max(1800, Math.round((Date.parse(timing.end_at) - now) / 1000)));
  return 6 * 3600;
}

/** Errori temporanei del servizio di notifiche: vale la pena riprovare subito. */
const isTransient = (status: number) => status === 0 || status === 429 || status >= 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-motore-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function headers(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { apikey: env.serviceKey, "Content-Type": "application/json", ...extra };
  // le nuove chiavi "sb_secret_..." non sono JWT: vanno solo in apikey
  if (!env.serviceKey.startsWith("sb_")) h.Authorization = `Bearer ${env.serviceKey}`;
  return h;
}

async function rest<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const f = env.fetchImpl ?? fetch;
  const res = await f(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: headers(env, (init.headers as Record<string, string>) ?? {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Database ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export function rpc<T>(env: Env, fn: string, args: Record<string, unknown>): Promise<T> {
  return rest<T>(env, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
}

export async function loadSecrets(env: Env): Promise<Record<string, string>> {
  const rows = await rest<{ key: string; value: string }[]>(env, "app_secrets?select=key,value");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Il motore può essere avviato dal timer del database (chiave segreta) o dall'app (utente collegato). */
export async function isAuthorized(env: Env, req: Request, secrets: Record<string, string>): Promise<boolean> {
  const key = req.headers.get("x-motore-key");
  if (key && secrets.motore_key && key === secrets.motore_key) return true;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token.startsWith("sb_") || token.split(".").length !== 3) return false;
  const f = env.fetchImpl ?? fetch;
  const res = await f(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: req.headers.get("apikey") ?? env.serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  const user = await res.json().catch(() => null);
  return Boolean(user && user.id);
}

export async function runEngine(env: Env, secrets: Record<string, string>) {
  // i ricorrenti senza orario limite non fatti passano alla volta successiva (prima restavano fermi)
  try {
    await rpc(env, "roll_recurring", {});
  } catch (e) {
    console.error("roll_recurring", e);
  }
  const items = await rpc<WorkItem[]>(env, "claim_work", {});
  const summary = { items: items.length, sent: 0, failed: 0, noDevice: 0 };
  if (!items.length) return summary;

  const vapid: VapidKeys = { publicKey: secrets.vapid_public, privateKey: secrets.vapid_private };
  const subject = secrets.vapid_subject || "https://promemoria-di-coppia.vercel.app";
  const actionUrl = `${env.supabaseUrl}/functions/v1/azione`;

  const userIds = [...new Set(items.map((i) => i.user_id))];
  const subs = await rest<SubRow[]>(
    env,
    `push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.(${userIds.join(",")})`,
  );

  // ripetizione e orario limite dei promemoria, per decidere quanto a lungo riprovare la consegna
  const timing = new Map<string, Timing>();
  const reminderIds = [...new Set(items.filter((i) => i.kind === "promemoria" && i.reminder_id).map((i) => i.reminder_id!))];
  if (reminderIds.length) {
    try {
      const rows = await rest<(Timing & { id: string })[]>(
        env,
        `reminders?select=id,repeat_minutes,end_at&id=in.(${reminderIds.join(",")})`,
      );
      for (const r of rows) timing.set(r.id, r);
    } catch (e) {
      console.error("tempi dei promemoria", e);
    }
  }

  const logs: LogRow[] = [];
  const gone: string[] = [];
  const okIds: string[] = [];
  const failedIds: string[] = [];

  for (const item of items) {
    const mine = subs.filter((s) => s.user_id === item.user_id);
    if (!mine.length) {
      summary.noDevice++;
      logs.push({
        user_id: item.user_id, reminder_id: item.reminder_id, kind: item.kind,
        ok: false, status: null, error: "nessun telefono con le notifiche attive", delivery_id: null,
      });
      continue;
    }

    let action: Record<string, unknown> | undefined;
    if (item.actions && item.reminder_id && secrets.action_secret) {
      const exp = Math.floor(Date.now() / 1000) + 3 * 24 * 3600;
      const sig = await signAction(secrets.action_secret, `${item.reminder_id}.${item.user_id}.${exp}`);
      action = { url: actionUrl, id: item.reminder_id, u: item.user_id, exp, sig };
    }
    const isReminder = item.kind === "promemoria";
    const message = {
      title: item.title,
      body: item.body,
      kind: item.kind,
      reminderId: item.reminder_id,
      tag: isReminder && item.reminder_id ? `promemoria-${item.reminder_id}` : `${item.kind}-${item.reminder_id ?? Date.now()}`,
      url: item.reminder_id ? `/?apri=${item.reminder_id}` : "/",
      urgent: item.urgent,
      reward: item.reward ?? null,
      count: item.count ?? null,
      actions: Boolean(action),
      action,
    };

    const opts = {
      ttl: ttlFor(item.kind, item.reminder_id ? timing.get(item.reminder_id) : undefined),
      urgency: (isReminder ? "high" : "normal") as "high" | "normal",
      topic: isReminder && item.reminder_id ? item.reminder_id.replace(/-/g, "") : undefined,
      fetchImpl: env.fetchImpl,
    };

    for (const sub of mine) {
      // ricevuta: il telefono, quando la notifica arriva, rimanda al server questo numero firmato
      const deliveryId = crypto.randomUUID();
      const receipt = secrets.action_secret
        ? { url: actionUrl, id: deliveryId, sig: await signAction(secrets.action_secret, `ricevuta.${deliveryId}`) }
        : undefined;
      const payload = { ...message, receipt };
      let res = await sendWebPush(sub, payload, vapid, subject, opts);
      if (!res.ok && !res.gone && isTransient(res.status)) {
        await sleep(env.retryDelayMs ?? 1500); // secondo tentativo dopo un errore temporaneo
        res = await sendWebPush(sub, payload, vapid, subject, opts);
        if (!res.ok) res = { ...res, error: `2 tentativi: ${res.error ?? ""}`.trim() };
      }
      logs.push({
        user_id: item.user_id, reminder_id: item.reminder_id, kind: item.kind,
        ok: res.ok, status: res.status, error: res.error ?? null, delivery_id: deliveryId,
      });
      if (res.ok) {
        summary.sent++;
        okIds.push(sub.id);
      } else {
        summary.failed++;
        if (res.gone) gone.push(sub.id);
        else failedIds.push(sub.id);
      }
    }
  }

  // aggiornamenti di servizio: se uno fallisce non deve bloccare il resto
  const now = new Date().toISOString();
  const tasks: Promise<unknown>[] = [];
  if (gone.length) {
    tasks.push(rest(env, `push_subscriptions?id=in.(${[...new Set(gone)].join(",")})`, { method: "DELETE" }));
  }
  if (okIds.length) {
    tasks.push(rest(env, `push_subscriptions?id=in.(${[...new Set(okIds)].join(",")})`, {
      method: "PATCH", body: JSON.stringify({ last_success_at: now, fail_count: 0 }),
    }));
  }
  for (const id of new Set(failedIds)) {
    const n = failedIds.filter((x) => x === id).length;
    tasks.push(rpcFailBump(env, id, n));
  }
  if (logs.length) {
    tasks.push(rest(env, "push_log", { method: "POST", body: JSON.stringify(logs), headers: { Prefer: "return=minimal" } }));
  }
  await Promise.allSettled(tasks);
  return summary;
}

async function rpcFailBump(env: Env, id: string, n: number) {
  const rows = await rest<{ fail_count: number }[]>(env, `push_subscriptions?id=eq.${id}&select=fail_count`);
  const current = rows[0]?.fail_count ?? 0;
  if (current + n >= 20) {
    // un telefono che fallisce sempre viene tolto
    return rest(env, `push_subscriptions?id=eq.${id}`, { method: "DELETE" });
  }
  return rest(env, `push_subscriptions?id=eq.${id}`, {
    method: "PATCH", body: JSON.stringify({ fail_count: current + n }),
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ricevuta: il telefono conferma che la notifica è arrivata. */
export async function runReceipt(
  env: Env,
  secrets: Record<string, string>,
  input: { ricevuta?: unknown; firma?: unknown },
) {
  const { ricevuta: id, firma: sig } = input ?? {};
  if (typeof id !== "string" || !UUID.test(id) || typeof sig !== "string") {
    return { status: 400, body: { error: "ricevuta non valida" } };
  }
  if (!secrets.action_secret || !(await verifyAction(secrets.action_secret, `ricevuta.${id}`, sig))) {
    return { status: 401, body: { error: "firma non valida" } };
  }
  await rest(env, "push_receipts?on_conflict=delivery_id", {
    method: "POST",
    body: JSON.stringify({ delivery_id: id.toLowerCase() }),
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
  });
  return { status: 200, body: { ok: true } };
}

/** Pulsante "Fatto" premuto direttamente nella notifica. */
export async function runAction(
  env: Env,
  secrets: Record<string, string>,
  input: { id?: string; u?: string; exp?: number; sig?: string },
) {
  const { id, u, exp, sig } = input ?? {};
  if (!id || !u || !exp || !sig) return { status: 400, body: { error: "richiesta incompleta" } };
  if (exp < Math.floor(Date.now() / 1000)) return { status: 401, body: { error: "notifica scaduta" } };
  if (!secrets.action_secret || !(await verifyAction(secrets.action_secret, `${id}.${u}.${exp}`, sig))) {
    return { status: 401, body: { error: "firma non valida" } };
  }
  const result = await rpc<Record<string, unknown>>(env, "complete_from_notification", { p_id: id, p_user: u });
  return { status: 200, body: { ok: true, ...result } };
}

export function envFromDeno(get: (k: string) => string | undefined): Env {
  const url = get("SUPABASE_URL") ?? "";
  let key = get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!key) {
    const raw = get("SUPABASE_SECRET_KEYS");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        key = (Object.values(parsed)[0] as string) ?? "";
      } catch {
        key = "";
      }
    }
  }
  return { supabaseUrl: url.replace(/\/$/, ""), serviceKey: key };
}
