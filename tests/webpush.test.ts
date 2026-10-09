import { test } from "node:test";
import assert from "node:assert/strict";
import {
  b64urlDecode, b64urlEncode, concat, encryptPayload, signAction, vapidAuthorization, verifyAction,
} from "../supabase/functions/_shared/webpush.ts";

const enc = new TextEncoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

// decifratura lato telefono (come farebbe il browser), per verificare il cifrato
async function decrypt(body: Uint8Array, uaKeys: CryptoKeyPair, authSecret: Uint8Array) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", uaKeys.publicKey));
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  assert.equal(plain[end], 2, "delimitatore di fine record");
  return new TextDecoder().decode(plain.slice(0, end));
}

async function importPair(pubB64: string, privB64: string, usage: KeyUsage[]): Promise<CryptoKeyPair> {
  const pub = b64urlDecode(pubB64);
  const jwk = { kty: "EC", crv: "P-256", d: privB64, x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33)), ext: true };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, usage);
  const publicKey = await crypto.subtle.importKey("raw", pub, { name: "ECDH", namedCurve: "P-256" }, true, []);
  return { privateKey, publicKey };
}

test("vettore di prova ufficiale RFC 8291", async () => {
  const asKeys = await importPair(
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    ["deriveBits"],
  );
  const out = await encryptPayload(
    b64urlDecode("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    "BTBZMqHH6r4Tts7J_aSIgg",
    { salt: b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw"), serverKeys: asKeys },
  );
  assert.equal(
    b64urlEncode(out),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});

test("cifratura e decifratura di un messaggio con accenti", async () => {
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const uaPublic = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey)));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const msg = JSON.stringify({ title: "Chiama la pediatra", body: "Urgente · entro le 19:00 · «più tardi»" });
  const body = await encryptPayload(enc.encode(msg), uaPublic, b64urlEncode(auth));
  assert.equal(await decrypt(body, ua, auth), msg);
});

test("firma VAPID valida e destinatario corretto", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const keys = { publicKey: b64urlEncode(pub), privateKey: jwk.d! };
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/xyz", keys, "https://esempio.app");
  const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m);
  assert.equal(m![2], keys.publicKey);
  const [h, c, s] = m![1].split(".");
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "https://esempio.app");
  assert.ok(claims.exp > Date.now() / 1000);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, b64urlDecode(s), enc.encode(`${h}.${c}`));
  assert.ok(ok, "firma ES256 verificata");
});

test("firma del pulsante Fatto", async () => {
  const sig = await signAction("segreto", "id.utente.123");
  assert.ok(await verifyAction("segreto", "id.utente.123", sig));
  assert.equal(await verifyAction("segreto", "id.altro.123", sig), false);
  assert.equal(await verifyAction("altro", "id.utente.123", sig), false);
  assert.equal(await verifyAction("segreto", "id.utente.123", "spazzatura"), false);
});

export { decrypt };
