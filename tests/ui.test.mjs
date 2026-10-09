// Prova dell'interfaccia in un browser vero (Chromium), con un finto Supabase.
// Uso: node tests/ui.test.mjs [cartella-screenshot]
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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
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
await new Promise((r) => server.listen(4173, r));
const BASE = "http://localhost:4173";
const FAKE = readFileSync(join(root, "tests/fake-supabase.js"), "utf8");

const MIN = 60_000;
const at = (h, m, dayOffset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const ahead = (ms) => new Date(Date.now() + ms).toISOString();

function rem(o) {
  return {
    couple_id: "c", priority: "normale", end_at: null, repeat_minutes: 0, recurrence: "none", recurrence_days: null,
    status: "pending", read_at: null, done_at: null, postponed_at: null, postpone_note: null, postpone_count: 0,
    last_notified_at: null, notify_count: 0, reward: null, series_id: null, created_at: ago(DAY), updated_at: ago(MIN),
    ...o, plan_start_at: o.start_at, plan_end_at: o.end_at ?? null,
  };
}
const DAY = 24 * 60 * MIN;
const ME = { id: "me", display_name: "Domenico", avatar_url: null };
const P = { id: "p", display_name: "Giulia", avatar_url: null };

function seed(extra = {}) {
  return {
    session: { user: { id: "me" } },
    me: { ...ME },
    partner: { ...P },
    couple: { id: "c", invite_code: "K7Q2MX", timezone: "Europe/Rome" },
    devices: { me: 0, partner: 1 },
    reminders: [
      rem({ id: "r1", created_by: "p", assigned_to: "me", title: "Chiama la pediatra", priority: "urgente",
        start_at: ago(12 * MIN), end_at: ahead(228 * MIN), repeat_minutes: 30, last_notified_at: ago(12 * MIN), notify_count: 1 }),
      rem({ id: "r2", created_by: "p", assigned_to: "me", title: "Compra il pane", start_at: ahead(150 * MIN) }),
      rem({ id: "r3", created_by: "p", assigned_to: "me", title: "Prenota il ristorante per sabato",
        start_at: at(10, 0, 1), end_at: at(12, 0, 1), repeat_minutes: 60, reward: "speciale" }),
      rem({ id: "r4", created_by: "me", assigned_to: "p", title: "Ritira il pacco", start_at: at(15, 0, 1), end_at: at(19, 0, 1),
        repeat_minutes: 30, priority: "urgente", read_at: ago(40 * MIN), postponed_at: ago(30 * MIN),
        postpone_note: "Sono al lavoro, lo ritiro domani appena esco", postpone_count: 1 }),
      rem({ id: "r5", created_by: "me", assigned_to: "p", title: "Prenota la visita dal dentista", start_at: ahead(60 * MIN),
        repeat_minutes: 60, reward: "cena", read_at: ago(5 * MIN) }),
      rem({ id: "r6", created_by: "me", assigned_to: "p", title: "Porta fuori la spazzatura", start_at: ago(DAY),
        status: "done", done_at: ago(DAY - 2 * MIN), reward: "film", read_at: ago(DAY), updated_at: ago(DAY - 2 * MIN) }),
    ],
    rewards: { r3: "Cena a lume di candela, scegli tu dove", r5: "Sushi da asporto", r6: "Scegli tu il film" },
    ...extra,
  };
}

const browser = await chromium.launch();
const errors = [];

async function open(seedData, path = "/") {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "it-IT", timezoneId: "Europe/Rome",
    serviceWorkers: "block",
  });
  await ctx.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: FAKE }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
  await ctx.addInitScript((s) => { window.__FAKE_SEED = s; }, seedData);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  await page.goto(BASE + path);
  return { ctx, page };
}

const calls = (page) => page.evaluate(() => window.__FAKE.calls);
const shot = (page, name, full = false) => page.screenshot({ path: join(shots, `${name}.png`), fullPage: full });

// 1. accesso
{
  const { ctx, page } = await open(seed({ session: null }));
  await page.getByRole("button", { name: "Accedi con Google" }).waitFor();
  await shot(page, "01-accesso");
  await ctx.close();
}

// 2. Per me, rinvio, premio
{
  const { ctx, page } = await open(seed());
  await page.getByRole("heading", { name: "Chiama la pediatra" }).waitFor();
  await page.waitForTimeout(300);
  await shot(page, "02-per-me");
  await shot(page, "02b-per-me-intera", true);
  const c = await calls(page);
  assert.ok(c.some((x) => x.fn === "mark_read" && x.args.p_ids.includes("r1")), "segna letti i miei promemoria");

  await page.getByRole("button", { name: "Non posso ora" }).first().click();
  await page.getByRole("dialog", { name: "Quando potrai farlo?" }).waitFor();
  await page.getByLabel("Nota per il partner").fill("Sono al lavoro, la chiamo domani appena esco");
  await page.waitForTimeout(400);
  await shot(page, "03-rinvio");
  await page.getByRole("button", { name: "Rimanda" }).click();
  await page.getByRole("status").filter({ hasText: "Rimandato a" }).waitFor();
  const post = (await calls(page)).find((x) => x.fn === "postpone_reminder");
  assert.equal(post.args.p_id, "r1");
  assert.equal(post.args.p_note, "Sono al lavoro, la chiamo domani appena esco");
  const s = new Date(post.args.p_start), e = new Date(post.args.p_end);
  assert.equal(Math.round((e - s) / MIN), Math.round((new Date(ahead(228 * MIN)) - new Date(ago(12 * MIN))) / MIN), "stessa durata");
  assert.ok((await calls(page)).some((x) => x.fn === "invoke:motore"), "motore avviato subito");

  // apro il ristorante dalla lista e lo segno fatto: premio speciale svelato
  await page.getByRole("button", { name: /Prenota il ristorante/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Fatto" }).click();
  await page.getByRole("dialog", { name: "Te lo sei meritato" }).waitFor();
  await page.waitForTimeout(700);
  await shot(page, "04-premio-speciale");
  assert.ok(await page.getByText("Cena a lume di candela, scegli tu dove").isVisible());
  await page.getByRole("button", { name: "Che bello!" }).click();
  await ctx.close();
}

// 3. Ho assegnato
{
  const { ctx, page } = await open(seed());
  await page.getByRole("button", { name: /Ho assegnato/ }).first().click();
  await page.getByText("Ritira il pacco").waitFor();
  await shot(page, "05-ho-assegnato");
  await shot(page, "05b-ho-assegnato-intera", true);
  await ctx.close();
}

// 4. Nuovo promemoria
{
  const { ctx, page } = await open(seed());
  await page.getByRole("button", { name: "Nuovo promemoria" }).click();
  await page.getByLabel("Cosa c'è da fare?").fill("Chiama la pediatra");
  await page.getByRole("switch", { name: "Orario limite" }).click();
  await page.getByRole("radio", { name: "30 min" }).click();
  await page.getByRole("radio", { name: "Urgente" }).click();
  await page.getByRole("button", { name: /PREMIO SPECIALE/ }).click();
  await page.getByLabel(/Dettaglio del premio/).fill("Massaggio di un'ora");
  await shot(page, "06-nuovo", true);
  await page.getByRole("button", { name: "Invia promemoria" }).click();
  await page.getByRole("status").filter({ hasText: "Inviato a Giulia" }).waitFor();
  const cr = (await calls(page)).find((x) => x.fn === "create_reminder");
  assert.equal(cr.args.p_assigned_to, "p");
  assert.equal(cr.args.p_repeat, 30);
  assert.equal(cr.args.p_priority, "urgente");
  assert.equal(cr.args.p_reward, "speciale");
  assert.equal(cr.args.p_reward_detail, "Massaggio di un'ora");
  assert.ok(cr.args.p_end && new Date(cr.args.p_end) > new Date(cr.args.p_start));
  await page.getByText("Chiama la pediatra").first().waitFor();
  await shot(page, "07-dopo-invio");

  // errore: titolo vuoto
  await page.getByRole("button", { name: "Nuovo promemoria" }).click();
  await page.getByRole("button", { name: "Invia promemoria" }).click();
  await page.getByRole("alert").filter({ hasText: "Scrivi cosa c'è da fare" }).waitFor();
  await ctx.close();
}

// 5. Impostazioni e invito
{
  const { ctx, page } = await open(seed());
  await page.getByRole("button", { name: "Notifiche e account" }).click();
  await page.getByRole("dialog", { name: "Notifiche e account" }).waitFor();
  await page.waitForTimeout(400);
  await shot(page, "08-impostazioni");
  await ctx.close();
}

// 6. primo accesso senza coppia
{
  const { ctx, page } = await open(seed({ couple: null, partner: null, reminders: [] }));
  await page.getByRole("button", { name: "Invita il partner" }).click();
  await page.getByText("K7Q2MX").waitFor();
  await shot(page, "09-invito");
  await ctx.close();
}

// 7. invito ricevuto dal link
{
  const { ctx, page } = await open(seed({ couple: null, partner: null, reminders: [] }), "/?invito=ABC234");
  await page.getByText("Collegato al partner!").waitFor();
  assert.ok((await calls(page)).some((x) => x.fn === "join_couple" && x.args.p_code === "ABC234"));
  await ctx.close();
}

// 8. nessun promemoria
{
  const { ctx, page } = await open(seed({ reminders: [] }));
  await page.getByText("Tutto fatto!").waitFor();
  await shot(page, "10-vuoto");
  await ctx.close();
}

await browser.close();
server.close();
const real = errors.filter((e) => !/favicon|manifest/i.test(e));
assert.deepEqual(real, [], "nessun errore nel browser");
console.log("TUTTE LE PROVE DELL'INTERFACCIA SUPERATE — screenshot in", shots);
