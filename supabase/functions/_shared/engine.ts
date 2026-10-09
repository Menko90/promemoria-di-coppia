// Motore delle notifiche: prende dal database cosa va inviato e lo spedisce
// a tutti i telefoni registrati della persona giusta.

import { sendWebPush, signAction, verifyAction, type VapidKeys } from "./webpush.ts";

export interface Env {
  supabaseUrl: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
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
}

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
        ok: false, status: null, error: "nessun telefono con le notifiche attive",
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
      actions: Boolean(action),
      action,
    };

    for (const sub of mine) {
      const res = await sendWebPush(sub, message, vapid, subject, {
        ttl: isReminder ? 1800 : 86400,
        urgency: isReminder ? "high" : "normal",
        topic: isReminder && item.reminder_id ? item.reminder_id.replace(/-/g, "") : undefined,
        fetchImpl: env.fetchImpl,
      });
      logs.push({
        user_id: item.user_id, reminder_id: item.reminder_id, kind: item.kind,
        ok: res.ok, status: res.status, error: res.error ?? null,
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
