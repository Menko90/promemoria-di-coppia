// Prova del service worker (notifiche) in un ambiente finto.
// Uso: node --test tests/sw.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url).pathname;

function loadSW({ offline = false } = {}) {
  const listeners = {};
  const shown = [];
  const posted = [];
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
  const fetch = async (url, init = {}) => {
    posted.push({ url, ...init, shownBefore: shown.length });
    if (offline) throw new TypeError("Failed to fetch");
    return { ok: true };
  };
  vm.runInNewContext(src, { self, caches: {}, fetch, URL, console });
  async function push(message) {
    let done;
    listeners.push({ data: { json: () => message, text: () => "" }, waitUntil: (p) => { done = p; } });
    await done;
  }
  return { push, shown, posted };
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

test("ricevuta: dopo aver mostrato la notifica il telefono avvisa il server", async () => {
  const { push, shown, posted } = loadSW();
  await push({ ...base, count: 1, receipt: { url: "https://p.supabase.co/functions/v1/azione", id: "abc-123", sig: "firma" } });
  assert.equal(shown.length, 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, "https://p.supabase.co/functions/v1/azione");
  assert.equal(posted[0].method, "POST");
  assert.equal(posted[0].headers["Content-Type"], "text/plain", "richiesta semplice, senza controllo preliminare");
  assert.deepEqual(JSON.parse(posted[0].body), { ricevuta: "abc-123", firma: "firma" });
  assert.equal(posted[0].shownBefore, 1, "prima la notifica, poi la ricevuta");
  assert.equal(shown[0].data.receipt.id, "abc-123");
});

test("senza ricevuta nel messaggio non parte nessuna richiesta", async () => {
  const { push, shown, posted } = loadSW();
  await push({ ...base, count: 1 });
  assert.equal(posted.length, 0);
  assert.equal(shown.length, 1);
});

test("se la rete manca la ricevuta si perde, ma la notifica resta", async () => {
  const { push, shown, posted } = loadSW({ offline: true });
  await push({ ...base, count: 1, receipt: { url: "https://p/functions/v1/azione", id: "x", sig: "y" } });
  assert.equal(posted.length, 1);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].closed, false);
});
