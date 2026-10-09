// Genera le chiavi segrete del motore delle notifiche e stampa l'SQL da eseguire su Supabase.
// Uso: node scripts/genera-segreti.mjs https://<progetto>.supabase.co https://<sito>.vercel.app
// L'output contiene segreti: non salvarlo nel repository.
import { generateKeyPairSync, randomBytes } from "node:crypto";

const [supabaseUrl, siteUrl] = process.argv.slice(2);
if (!supabaseUrl || !siteUrl) {
  console.error("Uso: node scripts/genera-segreti.mjs <url-supabase> <url-sito>");
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const b64 = (b) => Buffer.from(b).toString("base64url");
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
const rows = {
  vapid_public: b64(raw),
  vapid_private: priv.d,
  vapid_subject: siteUrl.replace(/\/$/, ""),
  action_secret: b64(randomBytes(32)),
  motore_key: b64(randomBytes(32)),
  motore_url: `${supabaseUrl.replace(/\/$/, "")}/functions/v1/motore`,
};
const esc = (s) => s.replace(/'/g, "''");
console.log("insert into public.app_secrets (key, value) values");
console.log(Object.entries(rows).map(([k, v]) => `  ('${k}', '${esc(v)}')`).join(",\n"));
console.log("on conflict (key) do update set value = excluded.value;");
console.log(`\n-- chiave pubblica da mettere in src/config.ts (VAPID_PUBLIC_KEY): ${rows.vapid_public}`);
