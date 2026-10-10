# Promemoria di Coppia

App per telefono (installabile dalla home) con cui due persone si scambiano promemoria:
si sceglie quando arriva la prima notifica, un eventuale orario limite e ogni quanto ripeterla.
Chi lo riceve può toccare **Fatto** (le notifiche si fermano) oppure **Non posso ora** e scegliere
quando farlo; l'altro vede tutto in tempo reale. Premi facoltativi, con un premio speciale che resta
segreto fino a compito fatto.

## Come è fatta

| Parte | Dove gira | Cartella |
|---|---|---|
| Schermate (React) | Vercel, come file statici già pronti | `src/` → `public/` |
| Database, accesso con Google, regole di sicurezza | Supabase | `supabase/migrations/` |
| Motore delle notifiche (ogni minuto) | Supabase Edge Functions + timer del database | `supabase/functions/` |

Le notifiche usano il sistema standard dei browser (Web Push con chiavi VAPID): nessun servizio esterno a pagamento.

### Regole delle notifiche
- La prima arriva all'orario di inizio, poi una ogni 15/30/60 minuti se scelto.
- Si fermano quando il compito è **fatto** o quando passa l'**orario limite** (in quel caso chi l'ha assegnato viene avvisato).
- **Non posso ora**: nuovo inizio, nuova fine e una nota; le notifiche ripartono dal nuovo orario e l'altro viene avvisato.
- I ricorrenti generano da soli la volta successiva.

## Aggiornare l'app

```bash
node scripts/build.mjs      # ricostruisce public/
git commit -am "..." && git push   # Vercel pubblica da solo
```

## Prove

```bash
bash tests/run_db_tests.sh                     # database (serve un Postgres locale)
node --experimental-strip-types --test tests/webpush.test.ts tests/engine.test.ts
tsx --test tests/logic.test.ts
node --test tests/sw.test.mjs                  # notifiche sul telefono (service worker)
node tests/ui.test.mjs                         # interfaccia in un browser vero, con dati finti
```

## Prima installazione (già fatta una volta, qui per riferimento)

1. Supabase: eseguire `supabase/migrations/0001_schema.sql`.
2. Generare i segreti con `node scripts/genera-segreti.mjs <url-supabase> <url-sito>` ed eseguire l'SQL stampato
   (non salvarlo nel repository); copiare la chiave pubblica in `src/config.ts` insieme a URL e chiave pubblica di Supabase.
3. Pubblicare le funzioni `motore` e `azione` senza verifica JWT (controllano da sole chi le chiama).
4. Eseguire `supabase/migrations/0002_cron.sql` (timer ogni minuto).
5. Supabase → Authentication: attivare Google (ID e segreto del client OAuth) e mettere l'indirizzo del sito
   tra i redirect consentiti.
