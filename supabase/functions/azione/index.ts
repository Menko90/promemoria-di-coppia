// Funzione "azione": il pulsante "Fatto" premuto direttamente nella notifica.
import { envFromDeno, json, loadSecrets, runAction } from "../_shared/engine.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "metodo non permesso" }, 405);
  const env = envFromDeno((k) => Deno.env.get(k));
  try {
    const secrets = await loadSecrets(env);
    const input = await req.json().catch(() => ({}));
    const result = await runAction(env, secrets, input);
    return json(result.body, result.status);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
