/* Service worker di Promemoria di Coppia: notifiche e funzionamento offline. */
const VERSION = "jsappQA3LUJ4Dcss";
const CACHE = "promemoria-" + VERSION;
const EXT_CACHE = "promemoria-ext";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/badge-96.png", "/assets/app.WKDNAGHY.js", "/assets/app.QA3LUJ4D.css"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("promemoria-") && k !== CACHE && k !== EXT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") {
      event.respondWith(fetch(req).catch(() => caches.match("/")));
      return;
    }
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok && url.pathname.startsWith("/assets/")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })),
    );
    return;
  }
  // librerie e caratteri: dalla rete, con copia di riserva per quando si è offline
  if (url.hostname === "cdn.jsdelivr.net" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(EXT_CACHE).then(async (c) => {
        try {
          const res = await fetch(req);
          if (res.ok) c.put(req, res.clone());
          return res;
        } catch (err) {
          const hit = await c.match(req);
          if (hit) return hit;
          throw err;
        }
      }),
    );
  }
});

self.addEventListener("push", (event) => {
  let m = {};
  try {
    m = event.data ? event.data.json() : {};
  } catch (_) {
    m = { title: "Promemoria di Coppia", body: event.data ? event.data.text() : "" };
  }
  const options = {
    body: m.body || "",
    tag: m.tag || undefined,
    renotify: Boolean(m.tag),
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    data: m,
    requireInteraction: Boolean(m.urgent),
    vibrate: m.urgent ? [200, 100, 200, 100, 300] : [120, 60, 120],
    timestamp: Date.now(),
    actions: m.actions
      ? [{ action: "fatto", title: "Fatto" }, { action: "rimanda", title: "Non posso ora" }]
      : [],
  };
  event.waitUntil(self.registration.showNotification(m.title || "Promemoria di Coppia", options));
});

async function openApp(url) {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of list) {
    if (new URL(c.url).origin === self.location.origin) {
      await c.focus();
      c.postMessage({ type: "navigate", url });
      return;
    }
  }
  await self.clients.openWindow(url);
}

async function doneInBackground(m) {
  const res = await fetch(m.action.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: m.action.id, u: m.action.u, exp: m.action.exp, sig: m.action.sig }),
  });
  if (!res.ok) throw new Error("errore " + res.status);
  await self.registration.showNotification("Fatto ✓", {
    body: m.title || "",
    tag: "fatto-" + m.reminderId,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    silent: true,
  });
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  list.forEach((c) => c.postMessage({ type: "refresh" }));
}

self.addEventListener("notificationclick", (event) => {
  const m = event.notification.data || {};
  event.notification.close();
  if (event.action === "fatto" && m.reminderId) {
    // con un premio apro l'app, così si vede il premio sbloccato
    if (m.reward || !m.action) {
      event.waitUntil(openApp("/?fatto=" + m.reminderId));
      return;
    }
    event.waitUntil(doneInBackground(m).catch(() => openApp("/?fatto=" + m.reminderId)));
    return;
  }
  if (event.action === "rimanda" && m.reminderId) {
    event.waitUntil(openApp("/?rimanda=" + m.reminderId));
    return;
  }
  event.waitUntil(openApp(m.url || "/"));
});
