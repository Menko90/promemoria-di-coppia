// Finto supabase-js per provare l'interfaccia senza internet.
// Lo stato iniziale arriva da window.__FAKE_SEED; le chiamate finiscono in window.__FAKE.calls.

const seed = window.__FAKE_SEED || {};
const S = (window.__FAKE = window.__FAKE || {
  session: seed.session ?? null,
  me: seed.me,
  partner: seed.partner ?? null,
  couple: seed.couple ?? null,
  reminders: seed.reminders ?? [],
  rewards: seed.rewards ?? {},
  devices: seed.devices ?? { me: 0, partner: 0 },
  calls: [],
});

const listeners = new Set();
const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const ok = (data) => Promise.resolve({ data, error: null });
const err = (message) => Promise.resolve({ data: null, error: { message } });

function info() {
  return {
    me: { ...S.me, push_devices: S.devices.me },
    couple: S.couple,
    partner: S.partner ? { ...S.partner, push_devices: S.devices.partner } : null,
  };
}

function visibleReminders() {
  return S.reminders.filter((r) => r.created_by === S.me.id || r.assigned_to === S.me.id);
}

function visibleRewards() {
  const out = [];
  for (const r of visibleReminders()) {
    const d = S.rewards[r.id];
    if (!d) continue;
    if (r.created_by === S.me.id || r.reward !== "speciale" || r.status === "done") out.push({ reminder_id: r.id, detail: d });
  }
  return out;
}

const rpcs = {
  couple_info: () => ok(info()),
  create_couple: () => {
    if (!S.couple) S.couple = { id: uuid(), invite_code: "K7Q2MX", timezone: "Europe/Rome" };
    return ok(S.couple.invite_code);
  },
  join_couple: ({ p_code }) => (p_code === "ABC234" ? ((S.couple = { id: uuid(), invite_code: "ABC234", timezone: "Europe/Rome" }),
    (S.partner = { id: "p-new", display_name: "Giulia", avatar_url: null }), ok(S.couple.id)) : err("Codice non valido")),
  set_display_name: ({ p_name }) => ((S.me.display_name = p_name), ok(null)),
  create_reminder: (a) => {
    const id = uuid();
    S.reminders.push({
      id, couple_id: S.couple?.id ?? "c", created_by: S.me.id, assigned_to: a.p_assigned_to, title: a.p_title,
      priority: a.p_priority, start_at: a.p_start, end_at: a.p_end, repeat_minutes: a.p_repeat,
      recurrence: a.p_recurrence, recurrence_days: a.p_recurrence_days, plan_start_at: a.p_start, plan_end_at: a.p_end,
      status: "pending", read_at: null, done_at: null, postponed_at: null, postpone_note: null, postpone_count: 0,
      last_notified_at: null, notify_count: 0, reward: a.p_reward, series_id: id, created_at: nowIso(), updated_at: nowIso(),
    });
    if (a.p_reward && a.p_reward_detail) S.rewards[id] = a.p_reward_detail;
    return ok(id);
  },
  complete_reminder: ({ p_id }) => {
    const r = S.reminders.find((x) => x.id === p_id);
    if (!r || r.assigned_to !== S.me.id) return err("Promemoria non trovato");
    const already = r.status !== "pending";
    if (!already) Object.assign(r, { status: "done", done_at: nowIso(), updated_at: nowIso() });
    return ok({ id: r.id, title: r.title, reward: r.reward, reward_detail: S.rewards[r.id] ?? null, already_done: already });
  },
  postpone_reminder: ({ p_id, p_start, p_end, p_note }) => {
    const r = S.reminders.find((x) => x.id === p_id);
    if (!r) return err("Promemoria non trovato");
    Object.assign(r, { start_at: p_start, end_at: p_end, postponed_at: nowIso(), postpone_note: p_note || null,
      postpone_count: r.postpone_count + 1, last_notified_at: null, updated_at: nowIso() });
    return ok(null);
  },
  mark_read: ({ p_ids }) => {
    let n = 0;
    for (const r of S.reminders) if (p_ids.includes(r.id) && r.assigned_to === S.me.id && !r.read_at) { r.read_at = nowIso(); n++; }
    return ok(n);
  },
  delete_reminder: ({ p_id }) => {
    S.reminders = S.reminders.filter((r) => !(r.id === p_id && r.created_by === S.me.id));
    return ok(null);
  },
  save_push_subscription: () => ((S.devices.me = 1), ok(null)),
  remove_push_subscription: () => ok(null),
  request_test_push: () => ok(S.devices.me),
  my_push_log: () => ok([{ created_at: nowIso(), kind: "promemoria", ok: true, status: 201, error: null }]),
};

class Query {
  constructor(table) { this.table = table; }
  select() { return this; }
  or() { return this; }
  order() { return this; }
  limit() { return this; }
  then(res, rej) {
    const data = this.table === "reminders" ? visibleReminders() : this.table === "reward_details" ? visibleRewards() : [];
    return Promise.resolve({ data: JSON.parse(JSON.stringify(data)), error: null }).then(res, rej);
  }
}

export function createClient() {
  return {
    auth: {
      getSession: () => ok({ session: S.session }),
      onAuthStateChange: (cb) => {
        listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      signInWithOAuth: (o) => {
        S.calls.push({ fn: "signInWithOAuth", args: o });
        S.session = { user: { id: S.me.id } };
        listeners.forEach((cb) => cb("SIGNED_IN", S.session));
        return ok({});
      },
      signOut: () => {
        S.session = null;
        listeners.forEach((cb) => cb("SIGNED_OUT", null));
        return ok(null);
      },
    },
    rpc: (fn, args) => {
      S.calls.push({ fn, args });
      return rpcs[fn] ? rpcs[fn](args ?? {}) : err(`rpc sconosciuta: ${fn}`);
    },
    from: (t) => new Query(t),
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel: () => undefined,
    functions: { invoke: (name) => (S.calls.push({ fn: `invoke:${name}` }), ok({})) },
  };
}
