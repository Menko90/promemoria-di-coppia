// Funzione "azione": il pulsante "Fatto" premuto direttamente nella notifica
// e la ricevuta che il telefono manda quando una notifica arriva.
import { envFromDeno, json, loadSecrets, runAction, runReceipt } from "../_shared/engine.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "metodo non permesso" }, 405);
  const env = envFromDeno((k) => Deno.env.get(k));
  try {
    const input = await req.json().catch(() => ({}));
    const secrets = await loadSecrets(env);
    const result = input && typeof input === "object" && "ricevuta" in input
      ? await runReceipt(env, secrets, input)
      : await runAction(env, secrets, input);
    return json(result.body, result.status);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
