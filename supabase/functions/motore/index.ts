// Funzione "motore": avviata ogni minuto dal database e, subito dopo ogni azione, dall'app.
import { envFromDeno, isAuthorized, json, loadSecrets, runEngine } from "../_shared/engine.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  const env = envFromDeno((k) => Deno.env.get(k));
  try {
    const secrets = await loadSecrets(env);
    if (!(await isAuthorized(env, req, secrets))) return json({ error: "non autorizzato" }, 401);
    const summary = await runEngine(env, secrets);
    return json({ ok: true, ...summary });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
