// Invio di notifiche Web Push standard (RFC 8291 + RFC 8188 + VAPID RFC 8292)
// usando solo WebCrypto: funziona in Deno (Supabase) e in Node.

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** Cifra il contenuto per un abbonamento push (content-encoding aes128gcm). */
export async function encryptPayload(
  payload: Uint8Array,
  uaPublicB64: string,
  authSecretB64: string,
  opts: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(uaPublicB64);
  const authSecret = b64urlDecode(authSecretB64);
  if (uaPublic.length !== 65 || authSecret.length !== 16) {
    throw new Error("Chiavi dell'abbonamento non valide");
  }
  const serverKeys = opts.serverKeys ??
    (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, serverKeys.privateKey, 256),
  );
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plaintext = concat(payload, new Uint8Array([2])); // 0x02 = ultimo record
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

export interface VapidKeys {
  publicKey: string; // 65 byte non compressi, base64url
  privateKey: string; // 32 byte (d), base64url
}

/** Crea l'intestazione Authorization VAPID per l'endpoint indicato. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const pub = b64urlDecode(keys.publicKey);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: keys.privateKey,
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    ext: true,
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const unsigned = `${header}.${claims}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendResult {
  ok: boolean;
  status: number;
  gone: boolean; // abbonamento non più valido: va cancellato
  error?: string;
}

export async function sendWebPush(
  sub: PushSubscriptionRow,
  message: unknown,
  keys: VapidKeys,
  subject: string,
  opts: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string; fetchImpl?: typeof fetch } = {},
): Promise<SendResult> {
  try {
    const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: String(opts.ttl ?? 1800),
      Urgency: opts.urgency ?? "high",
      Authorization: await vapidAuthorization(sub.endpoint, keys, subject),
    };
    if (opts.topic) headers.Topic = opts.topic;
    const res = await (opts.fetchImpl ?? fetch)(sub.endpoint, { method: "POST", headers, body });
    if (res.ok) return { ok: true, status: res.status, gone: false };
    const text = (await res.text().catch(() => "")).slice(0, 300);
    return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410, error: text };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}

/** Firma HMAC per il pulsante "Fatto" dentro la notifica. */
export async function signAction(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64urlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

export async function verifyAction(secret: string, data: string, sig: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("HMAC", key, b64urlDecode(sig), enc.encode(data));
  } catch {
    return false;
  }
}
