-- Timer: ogni minuto il database avvia la funzione "motore".
-- L'indirizzo della funzione e la chiave stanno in app_secrets (non nel codice):
--   motore_url  = https://<progetto>.supabase.co/functions/v1/motore
--   motore_key  = chiave casuale condivisa con la funzione
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- se esiste già un timer con lo stesso nome, cron.schedule lo sostituisce
select cron.schedule(
  'motore-promemoria',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select value from public.app_secrets where key = 'motore_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-motore-key', (select value from public.app_secrets where key = 'motore_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $job$
);
