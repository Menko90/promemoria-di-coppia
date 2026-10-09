// Notifiche push sul telefono.
import { api } from "./api";
import { VAPID_PUBLIC_KEY } from "./config";

export type PushState = "unsupported" | "needs-install" | "default" | "denied" | "granted";

function keyBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function pushState(): PushState {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  return Notification.permission as PushState;
}

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // senza service worker l'app funziona lo stesso, ma senza notifiche
  }
}

async function currentSubscription(subscribeIfMissing: boolean): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  const key = keyBytes(VAPID_PUBLIC_KEY);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => undefined);
    sub = null;
  }
  if (!sub && subscribeIfMissing) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  return sub;
}

async function save(sub: PushSubscription): Promise<void> {
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error("Iscrizione alle notifiche incompleta");
  await api.savePush(j.endpoint, j.keys.p256dh, j.keys.auth);
}

/** Chiede il permesso e registra questo telefono. */
export async function enablePush(): Promise<PushState> {
  const state = pushState();
  if (state === "unsupported" || state === "needs-install") return state;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm as PushState;
  const sub = await currentSubscription(true);
  if (sub) await save(sub);
  return "granted";
}

/** All'apertura dell'app: se il permesso c'è, si assicura che il telefono sia registrato. */
export async function syncPush(): Promise<boolean> {
  try {
    if (pushState() !== "granted") return false;
    const sub = await currentSubscription(true);
    if (!sub) return false;
    await save(sub);
    return true;
  } catch {
    return false;
  }
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription(false);
  if (!sub) return;
  await api.removePush(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}
