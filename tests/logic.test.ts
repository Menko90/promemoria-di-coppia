import { test } from "node:test";
import assert from "node:assert/strict";
import type { Reminder } from "../src/api";
import { assignedStatus, nextNotification, pickFocus, postponePresets, shiftedEnd } from "../src/logic";

const MIN = 60_000;
const now = new Date("2026-10-09T13:00:00Z").getTime();
const iso = (ms: number) => new Date(ms).toISOString();

function r(o: Partial<Reminder>): Reminder {
  return {
    id: "x", couple_id: "c", created_by: "p", assigned_to: "me", title: "t", priority: "normale",
    start_at: iso(now), end_at: null, repeat_minutes: 0, recurrence: "none", recurrence_days: null,
    plan_start_at: iso(now), plan_end_at: null, status: "pending", read_at: null, done_at: null,
    postponed_at: null, postpone_note: null, postpone_count: 0, last_notified_at: null, notify_count: 0,
    reward: null, series_id: null, created_at: iso(now), updated_at: iso(now), ...o,
  } as Reminder;
}

test("in primo piano: prima gli urgenti già iniziati, poi chi scade prima", () => {
  const a = r({ id: "a", start_at: iso(now - 10 * MIN) });
  const b = r({ id: "b", start_at: iso(now - 5 * MIN), priority: "urgente" });
  const c = r({ id: "c", start_at: iso(now + 60 * MIN), priority: "urgente" });
  assert.equal(pickFocus([a, b, c], now)?.id, "b");
  const d = r({ id: "d", start_at: iso(now - 10 * MIN), end_at: iso(now + 20 * MIN) });
  const e = r({ id: "e", start_at: iso(now - 10 * MIN), end_at: iso(now + 90 * MIN) });
  assert.equal(pickFocus([e, d], now)?.id, "d");
  assert.equal(pickFocus([c], now)?.id, "c", "se nulla è iniziato, il prossimo");
  assert.equal(pickFocus([r({ status: "done" })], now), null);
});

test("prossima notifica", () => {
  assert.equal(nextNotification(r({ start_at: iso(now + 30 * MIN) }), now), now + 30 * MIN);
  const rep = r({ start_at: iso(now - 40 * MIN), repeat_minutes: 30, last_notified_at: iso(now - 10 * MIN) });
  assert.equal(nextNotification(rep, now), now + 20 * MIN);
  const once = r({ start_at: iso(now - 40 * MIN), last_notified_at: iso(now - 40 * MIN) });
  assert.equal(nextNotification(once, now), null);
  const capped = r({ start_at: iso(now - 40 * MIN), end_at: iso(now + 5 * MIN), repeat_minutes: 30, last_notified_at: iso(now - 10 * MIN) });
  assert.equal(nextNotification(capped, now), null, "oltre l'orario limite non ne arrivano altre");
});

test("rinvio: proposte e stessa durata", () => {
  const x = r({ start_at: "2026-10-09T13:00:00Z", end_at: "2026-10-09T17:00:00Z" });
  const presets = postponePresets(x, new Date(now));
  const domani = presets.find((p) => p.id === "domani")!;
  assert.equal(domani.start.getTime() - new Date(x.start_at).getTime(), 24 * 60 * MIN);
  assert.equal(shiftedEnd(x, domani.start)!.getTime() - domani.start.getTime(), 4 * 60 * MIN);
  assert.equal(shiftedEnd(r({}), new Date()), null);
});

test("stato visto da chi ha assegnato", () => {
  assert.equal(assignedStatus(r({ status: "done" }), now), "fatto");
  assert.equal(assignedStatus(r({ status: "missed" }), now), "scaduto");
  assert.equal(assignedStatus(r({ postponed_at: iso(now) }), now), "rimandato");
  assert.equal(assignedStatus(r({ read_at: iso(now) }), now), "letto");
  assert.equal(assignedStatus(r({ start_at: iso(now + MIN) }), now), "programmato");
  assert.equal(assignedStatus(r({}), now), "non_letto");
});
