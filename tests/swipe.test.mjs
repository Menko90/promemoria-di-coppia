// Prova dello swipe a carrello con tocchi simulati in un browser vero (Chromium), con un finto Supabase.
// Uso: node tests/swipe.test.mjs [cartella-screenshot]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const req = createRequire(join(["/opt/node-tools/node_modules", "/opt/npm-tools/node_modules"].find(existsSync), "x.js"));
const { chromium } = req("playwright");
const shots = process.argv[2] ?? join(root, "tests/shots");
mkdirSync(shots, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".webmanifest": "application/manifest+json" };
const server = createServer((rq, rs) => {
  let p = decodeURIComponent(new URL(rq.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const f = join(root, "public", p);
  if (!f.startsWith(join(root, "public")) || !existsSync(f)) {
    rs.writeHead(200, { "Content-Type": "text/html" });
    return rs.end(readFileSync(join(root, "public/index.html")));
  }
  rs.writeHead(200, { "Content-Type": TYPES[extname(f)] ?? "application/octet-stream" });
  rs.end(readFileSync(f));
});
await new Promise((r) => server.listen(4174, r));
const FAKE = readFileSync(join(root, "tests/fake-supabase.js"), "utf8");

const MIN = 60_000, DAY = 24 * 60 * MIN;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const ahead = (ms) => new Date(Date.now() + ms).toISOString();
const rem = (o) => ({ couple_id: "c", priority: "normale", end_at: null, repeat_minutes: 0, recurrence: "none", recurrence_days: null,
  status: "pending", read_at: null, done_at: null, postponed_at: null, postpone_note: null, postpone_count: 0,
  last_notified_at: null, notify_count: 0, reward: null, series_id: null, created_at: ago(DAY), updated_at: ago(MIN),
  ...o, plan_start_at: o.start_at, plan_end_at: o.end_at ?? null });
const many = Array.from({ length: 8 }, (_, i) => rem({ id: `m${i}`, created_by: "p", assigned_to: "me", title: `Promemoria numero ${i + 1}`, start_at: ahead((i + 2) * 60 * MIN) }));
const seed = {
  session: { user: { id: "me" } }, me: { id: "me", display_name: "Domenico", avatar_url: null },
  partner: { id: "p", display_name: "Giulia", avatar_url: null },
  couple: { id: "c", invite_code: "K7Q2MX", timezone: "Europe/Rome" }, devices: { me: 1, partner: 1 },
  reminders: [
    rem({ id: "r1", created_by: "p", assigned_to: "me", title: "Chiama la pediatra", priority: "urgente",
      start_at: ago(12 * MIN), end_at: ahead(228 * MIN), repeat_minutes: 30, last_notified_at: ago(12 * MIN), notify_count: 1 }),
    ...many,
    rem({ id: "r4", created_by: "me", assigned_to: "p", title: "Ritira il pacco", start_at: ahead(DAY), end_at: ahead(DAY + 4 * 60 * MIN),
      repeat_minutes: 30, read_at: ago(40 * MIN), postponed_at: ago(30 * MIN), postpone_note: "Lo ritiro domani", postpone_count: 1 }),
    rem({ id: "r5", created_by: "me", assigned_to: "p", title: "Prenota la visita dal dentista", start_at: ahead(60 * MIN), repeat_minutes: 60, reward: "cena" }),
  ],
  rewards: { r5: "Sushi da asporto" },
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "it-IT", timezoneId: "Europe/Rome",
  hasTouch: true, isMobile: true, serviceWorkers: "block",
});
await ctx.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: FAKE }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
await ctx.addInitScript((s) => { window.__FAKE_SEED = s; }, seed);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:4174/");
await page.getByRole("heading", { name: "Chiama la pediatra" }).waitFor();

// tocchi simulati: sequenza di punti, con un ritardo tra un movimento e l'altro
await page.evaluate(() => {
  window.__touch = async (points, { delay = 16, fingers = 1, cancel = false, peek, hold = false } = {}) => {
    const [x0, y0] = points[0];
    const target = document.elementFromPoint(x0, y0);
    const mk = (x, y) => Array.from({ length: fingers }, (_, i) =>
      new Touch({ identifier: i + 1, target, clientX: x + i * 30, clientY: y, pageX: x + i * 30, pageY: y + scrollY }));
    const fire = (type, touches, changed) => target.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, composed: true, touches, targetTouches: touches, changedTouches: changed,
    }));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const track = document.querySelector(".track");
    fire("touchstart", mk(x0, y0), mk(x0, y0));
    let during = null;
    for (const [x, y] of points.slice(1)) {
      await sleep(delay);
      fire("touchmove", mk(x, y), mk(x, y));
    }
    during = { x: Math.round(new DOMMatrix(getComputedStyle(track).transform).m41), moving: track.classList.contains("moving") };
    if (peek) during.peek = peek();
    const [xe, ye] = points[points.length - 1];
    const end = () => fire(cancel ? "touchcancel" : "touchend", [], mk(xe, ye));
    if (hold) { window.__release = end; return during; } // il dito resta giù (per lo screenshot)
    end();
    return during;
  };
  window.__page = () => document.querySelector(".page.active")?.getAttribute("aria-label");
});

const settle = () => page.waitForTimeout(650);
const active = () => page.evaluate(() => window.__page());
const drag = (from, to, opts = {}) => {
  const steps = opts.steps ?? 10;
  const pts = Array.from({ length: steps + 1 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]);
  return page.evaluate(([p, o]) => window.__touch(p, o), [pts, opts]);
};
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); console.log("ok -", name); };

await check("si parte da «Per me»", async () => assert.equal(await active(), "Per me"));

await check("trascinamento a metà: passa a «Ho assegnato»", async () => {
  const during = await drag([300, 420], [100, 425], { delay: 30 });
  assert.equal(during.moving, true, "durante il trascinamento le pagine vicine sono visibili");
  assert.equal(during.x, -200, "la pista segue il dito");
  await settle();
  assert.equal(await active(), "Ho assegnato");
  assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Ho assegnato");
});
await page.screenshot({ path: join(shots, "s01-ho-assegnato.png") });

await check("rilascio corto e lento: torna indietro", async () => {
  await drag([150, 420], [210, 420], { delay: 60 });
  await settle();
  assert.equal(await active(), "Ho assegnato");
  assert.equal(await page.evaluate(() => document.querySelector(".track").classList.contains("moving")), false);
});

await check("colpetto veloce (50px in poco tempo): cambia pagina", async () => {
  await drag([150, 420], [200, 420], { delay: 10, steps: 5 });
  await settle();
  assert.equal(await active(), "Per me");
});
await page.screenshot({ path: join(shots, "s02-per-me.png") });

await check("resistenza all'estremo sinistro (×0.3) e ritorno", async () => {
  const during = await drag([100, 420], [300, 420], { delay: 30 });
  assert.equal(during.x, 60, "spostamento ridotto a 60px invece di 200px");
  await settle();
  assert.equal(await active(), "Per me");
});

await check("resistenza all'estremo destro", async () => {
  await page.getByRole("button", { name: /Ho assegnato ·/ }).click();
  await settle();
  const during = await drag([300, 420], [100, 420], { delay: 30 });
  assert.equal(during.x, -(390 + 32) - 60, "spostamento ridotto a 60px");
  await settle();
  assert.equal(await active(), "Ho assegnato");
  await page.getByRole("button", { name: /Per me ·/ }).click();
  await settle();
});

await check("gesto verticale: è uno scroll, niente swipe", async () => {
  const during = await drag([200, 500], [215, 380], { delay: 20 });
  assert.equal(during.moving, false);
  assert.equal(during.x, 0, "la pista non si è mossa");
  await settle();
  assert.equal(await active(), "Per me");
});

await check("partenza dal bordo dello schermo (gesto «indietro» del telefono): ignorata", async () => {
  const during = await drag([10, 420], [250, 420], { delay: 20 });
  assert.equal(during.moving, false);
  const during2 = await drag([382, 420], [150, 420], { delay: 20 });
  assert.equal(during2.moving, false);
  await settle();
  assert.equal(await active(), "Per me");
});

await check("due dita: ignorato", async () => {
  const during = await drag([250, 420], [60, 420], { delay: 20, fingers: 2 });
  assert.equal(during.moving, false);
  await settle();
  assert.equal(await active(), "Per me");
});

await check("dito interrotto dal sistema (touchcancel): torna indietro", async () => {
  await drag([300, 420], [80, 420], { delay: 20, cancel: true });
  await settle();
  assert.equal(await active(), "Per me");
  assert.equal(await page.evaluate(() => document.querySelector(".track").classList.contains("moving")), false);
});

await check("modulo aperto: niente swipe", async () => {
  await page.getByRole("button", { name: "Notifiche e account" }).click();
  await page.getByRole("dialog", { name: "Notifiche e account" }).waitFor();
  const moved = await page.evaluate(async () => {
    const wrap = document.querySelector(".carousel");
    const r = wrap.getBoundingClientRect();
    const y = r.top + 40;
    const mk = (x) => [new Touch({ identifier: 1, target: wrap, clientX: x, clientY: y })];
    const fire = (t, touches, ch) => wrap.dispatchEvent(new TouchEvent(t, { bubbles: true, cancelable: true, touches, changedTouches: ch }));
    fire("touchstart", mk(300), mk(300));
    for (const x of [280, 240, 180, 120, 80]) fire("touchmove", mk(x), mk(x));
    const moving = document.querySelector(".track").classList.contains("moving");
    fire("touchend", [], mk(80));
    return moving;
  });
  assert.equal(moved, false);
  await page.getByRole("button", { name: "Chiudi" }).click();
  await settle();
  assert.equal(await active(), "Per me");
});

await check("tocco sulle schede: stessa animazione", async () => {
  await page.getByRole("button", { name: /Ho assegnato ·/ }).click();
  await page.waitForTimeout(120);
  const mid = await page.evaluate(() => {
    const t = document.querySelector(".track");
    return { moving: t.classList.contains("moving"), x: new DOMMatrix(getComputedStyle(t).transform).m41 };
  });
  assert.equal(mid.moving, true, "le pagine sono visibili durante l'animazione");
  assert.ok(mid.x < 0 && mid.x > -400, `a metà strada: ${mid.x}`);
  await settle();
  assert.equal(await active(), "Ho assegnato");
  const end = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".track")).transform).m41);
  assert.equal(Math.round(end), -(390 + 32));
  await page.getByRole("button", { name: "Per me", exact: true }).click(); // barra in basso
  await settle();
  assert.equal(await active(), "Per me");
});

await check("la barra in basso resta ferma in fondo (anche dopo scroll e swipe)", async () => {
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(100);
  const during = await drag([300, 600], [120, 600], { delay: 30, peek: undefined });
  assert.equal(during.moving, true);
  const box = await page.locator(".bottom-nav").boundingBox();
  assert.equal(Math.round(box.y + box.height), 844, "attaccata al fondo");
  await settle();
  assert.equal(await active(), "Ho assegnato");
  assert.equal(await page.evaluate(() => window.scrollY), 0, "la nuova pagina si vede dall'inizio");
  const box2 = await page.locator(".bottom-nav").boundingBox();
  assert.equal(Math.round(box2.y + box2.height), 844);
});

await check("le pagine nascoste non si vedono e non si leggono", async () => {
  const hidden = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".page")].find((x) => !x.classList.contains("active"));
    const cs = getComputedStyle(p);
    return { h: p.getBoundingClientRect().height, vis: cs.visibility, aria: p.getAttribute("aria-hidden") };
  });
  assert.deepEqual(hidden, { h: 0, vis: "hidden", aria: "true" });
});

// meno movimento: niente animazione, la pagina cambia subito
await check("rispetta «riduci animazioni»", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: /Per me ·/ }).click();
  await page.waitForTimeout(50);
  const st = await page.evaluate(() => ({ moving: document.querySelector(".track").classList.contains("moving"),
    x: new DOMMatrix(getComputedStyle(document.querySelector(".track")).transform).m41 }));
  assert.equal(st.moving, false);
  assert.equal(Math.round(st.x), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
});

// meno trasparenze: sfondi pieni
await check("rispetta «riduci trasparenza»", async () => {
  const bg = () => page.evaluate(() => getComputedStyle(document.querySelector(".page.active .card, .page.active .row")).backgroundImage);
  assert.ok((await bg()).includes("gradient"), "normalmente è vetro");
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  assert.equal(await bg(), "none", "sfondo pieno");
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });
});

// screenshot a metà del trascinamento, per vedere il carrello
await page.getByRole("button", { name: /Per me ·/ }).click();
await settle();
await drag([320, 420], [130, 420], { delay: 20, hold: true });
await page.screenshot({ path: join(shots, "s03-durante-lo-swipe.png") });
await page.evaluate(() => window.__release());
await settle();

await browser.close();
server.close();
assert.deepEqual(errors, [], "nessun errore nel browser");
console.log(`\nTUTTE LE ${results.length} PROVE DELLO SWIPE SUPERATE`);
