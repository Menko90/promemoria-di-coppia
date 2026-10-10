// Prova del service worker (notifiche) in un ambiente finto.
// Uso: node --test tests/sw.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url).pathname;

function loadSW() {
  const listeners = {};
  const shown = [];
  const registration = {
    async getNotifications() {
      return shown.filter((n) => !n.closed);
    },
    async showNotification(title, options) {
      shown.push({ title, ...options, closed: false, close() { this.closed = true; } });
    },
  };
  const self = {
    registration,
    location: { origin: "https://x.test" },
    clients: { matchAll: async () => [], openWindow: async () => {}, claim: async () => {} },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
  };
  const src = readFileSync(`${root}public/sw.js`, "utf8");
  vm.runInNewContext(src, { self, caches: {}, fetch: async () => ({}), URL, console });
  async function push(message) {
    let done;
    listeners.push({ data: { json: () => message, text: () => "" }, waitUntil: (p) => { done = p; } });
    await done;
  }
  return { push, shown };
}

const R = "11111111-2222-3333-4444-555555555555";
const base = { kind: "promemoria", reminderId: R, tag: `promemoria-${R}`, title: "Chiama la pediatra", body: "da Giulia", actions: true };

test("ogni ripetizione è una notifica nuova e la vecchia si chiude", async () => {
  const { push, shown } = loadSW();
  await push({ ...base, count: 1 });
  await push({ ...base, count: 2 });
  await push({ ...base, count: 3 });
  assert.deepEqual(shown.map((n) => n.tag), [`promemoria-${R}-1`, `promemoria-${R}-2`, `promemoria-${R}-3`]);
  assert.deepEqual(shown.map((n) => n.closed), [true, true, false], "resta solo l'ultima");
  assert.equal(shown[0].body, "da Giulia");
  assert.equal(shown[2].body, "3° avviso · da Giulia");
  assert.ok(shown.every((n) => n.renotify), "suona e vibra ogni volta");
  assert.equal(shown[2].actions.length, 2);
});

test("le notifiche di servizio non chiudono il promemoria", async () => {
  const { push, shown } = loadSW();
  await push({ ...base, count: 1 });
  await push({ kind: "rinvio", reminderId: R, tag: `rinvio-${R}`, title: "Giulia ha rimandato", body: "Nuovo orario" });
  assert.equal(shown[0].closed, false);
  assert.equal(shown[1].tag, `rinvio-${R}`);
  assert.equal(shown[1].body, "Nuovo orario");
});

test("messaggi vecchi senza numero dell'avviso funzionano lo stesso", async () => {
  const { push, shown } = loadSW();
  await push({ ...base });
  assert.match(shown[0].tag, new RegExp(`^promemoria-${R}-\\d+$`));
  assert.equal(shown[0].body, "da Giulia");
});
