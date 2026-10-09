// Accesso ai dati: tutte le modifiche passano dalle funzioni del database.
// @ts-ignore: modulo caricato dal CDN al momento dell'apertura dell'app
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export type Priority = "urgente" | "normale" | "quando_puoi";
export type Recurrence = "none" | "daily" | "weekly" | "custom";
export type Reward = "massaggio" | "film" | "cena" | "regalo" | "speciale";
export type Status = "pending" | "done" | "missed";

export interface Person {
  id: string;
  display_name: string;
  avatar_url: string | null;
  push_devices: number;
}

export interface CoupleInfo {
  me: Person;
  couple: { id: string; invite_code: string; timezone: string } | null;
  partner: Person | null;
}

export interface Reminder {
  id: string;
  couple_id: string;
  created_by: string;
  assigned_to: string;
  title: string;
  priority: Priority;
  start_at: string;
  end_at: string | null;
  repeat_minutes: number;
  recurrence: Recurrence;
  recurrence_days: number[] | null;
  plan_start_at: string;
  plan_end_at: string | null;
  status: Status;
  read_at: string | null;
  done_at: string | null;
  postponed_at: string | null;
  postpone_note: string | null;
  postpone_count: number;
  last_notified_at: string | null;
  notify_count: number;
  reward: Reward | null;
  series_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewReminder {
  title: string;
  assignedTo: string;
  start: Date;
  end: Date | null;
  repeat: number;
  priority: Priority;
  recurrence: Recurrence;
  recurrenceDays: number[] | null;
  reward: Reward | null;
  rewardDetail: string;
}

export interface CompleteResult {
  id: string;
  title: string;
  reward: Reward | null;
  reward_detail: string | null;
  already_done: boolean;
}

function fail(error: { message?: string } | null): never {
  const msg = error?.message ?? "Qualcosa è andato storto";
  throw new Error(
    /fetch|network|Failed to fetch/i.test(msg) ? "Connessione assente: riprova tra poco" : msg,
  );
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error);
  return data as T;
}

export const api = {
  coupleInfo: () => call<CoupleInfo>("couple_info"),
  createCouple: () => call<string>("create_couple"),
  joinCouple: (code: string) => call<string>("join_couple", { p_code: code }),
  setName: (name: string) => call<void>("set_display_name", { p_name: name }),

  async reminders(): Promise<Reminder[]> {
    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from("reminders")
      .select("*")
      .or(`status.eq.pending,updated_at.gte.${since}`)
      .order("start_at", { ascending: true })
      .limit(300);
    if (error) fail(error);
    return (data ?? []) as Reminder[];
  },

  async rewardDetails(): Promise<Record<string, string>> {
    const { data, error } = await supabase.from("reward_details").select("reminder_id, detail").limit(500);
    if (error) fail(error);
    return Object.fromEntries(((data ?? []) as { reminder_id: string; detail: string }[]).map((r) => [r.reminder_id, r.detail]));
  },

  create: (r: NewReminder) =>
    call<string>("create_reminder", {
      p_title: r.title,
      p_assigned_to: r.assignedTo,
      p_start: r.start.toISOString(),
      p_end: r.end ? r.end.toISOString() : null,
      p_repeat: r.repeat,
      p_priority: r.priority,
      p_recurrence: r.recurrence,
      p_recurrence_days: r.recurrence === "custom" ? r.recurrenceDays : null,
      p_reward: r.reward,
      p_reward_detail: r.reward ? r.rewardDetail : null,
    }),

  complete: (id: string) => call<CompleteResult>("complete_reminder", { p_id: id }),

  postpone: (id: string, start: Date, end: Date | null, note: string) =>
    call<void>("postpone_reminder", {
      p_id: id,
      p_start: start.toISOString(),
      p_end: end ? end.toISOString() : null,
      p_note: note,
    }),

  markRead: (ids: string[]) => call<number>("mark_read", { p_ids: ids }),
  remove: (id: string) => call<void>("delete_reminder", { p_id: id }),

  savePush: (endpoint: string, p256dh: string, auth: string) =>
    call<void>("save_push_subscription", {
      p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_user_agent: navigator.userAgent,
    }),
  removePush: (endpoint: string) => call<void>("remove_push_subscription", { p_endpoint: endpoint }),
  testPush: () => call<number>("request_test_push"),
  pushLog: () => call<{ created_at: string; kind: string; ok: boolean; status: number | null; error: string | null }[]>("my_push_log"),

  /** Fa partire subito il motore delle notifiche (senza aspettare il minuto). */
  async kick(): Promise<void> {
    try {
      await supabase.functions.invoke("motore", { body: {} });
    } catch {
      // non è grave: ci pensa comunque il timer ogni minuto
    }
  },
};
