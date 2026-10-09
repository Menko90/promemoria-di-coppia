\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set C '33333333-3333-3333-3333-333333333333'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'A', 'domenico@example.com', '{"full_name":"Domenico Rossi","avatar_url":"https://x/a.png"}'),
  (:'B', 'partner@example.com',  '{"name":"Giulia Bianchi"}'),
  (:'C', 'estraneo@example.com', '{}');

-- helper per le asserzioni con errore atteso
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not like p_like then
      raise exception 'errore inatteso per [%]: %', p_sql, sqlerrm;
    end if;
    return;
  end;
  raise exception 'mi aspettavo un errore per: %', p_sql;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated, anon, service_role;

\echo '1. profili creati in automatico'
do $$ begin
  assert (select display_name from profiles where id = '11111111-1111-1111-1111-111111111111') = 'Domenico';
  assert (select display_name from profiles where id = '22222222-2222-2222-2222-222222222222') = 'Giulia';
  assert (select display_name from profiles where id = '33333333-3333-3333-3333-333333333333') = 'estraneo';
end $$;

\echo '2. anonimo non può fare nulla'
set role anon;
select pg_temp.expect_error('select public.couple_info()', '%permission denied%');
select pg_temp.expect_error('select * from public.reminders', '%permission denied%');
reset role;

\echo '3. A crea la coppia, B entra, C viene respinto'
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
select public.create_couple() as code \gset
select :'code' ~ '^[A-Z2-9]{6}$' as ok_code \gset
\if :ok_code
\else
  \echo 'codice non valido' \q
\endif
select (public.couple_info()->>'partner') is null as no_partner \gset
\if :no_partner
\else
  \echo 'partner inatteso' \q
\endif
select set_config('request.jwt.claim.sub', :'B', false);
select public.join_couple(lower(:'code')) is not null;
select set_config('request.jwt.claim.sub', :'C', false);
select pg_temp.expect_error(format('select public.join_couple(%L)', :'code'), '%già completa%');
select pg_temp.expect_error('select public.join_couple(''ZZZZZZ'')', '%Codice non valido%');
reset role;

\echo '4. visibilità dei profili'
set role authenticated;
select set_config('request.jwt.claim.sub', :'B', false);
do $$ begin
  assert (select count(*) from profiles) = 2, 'B deve vedere sé e A';
  assert (public.couple_info()->'partner'->>'display_name') = 'Domenico';
end $$;
select set_config('request.jwt.claim.sub', :'C', false);
do $$ begin
  assert (select count(*) from profiles) = 1, 'C vede solo sé stesso';
end $$;
reset role;

\echo '5. B crea un promemoria per A con premio speciale'
set role authenticated;
select set_config('request.jwt.claim.sub', :'B', false);
select public.create_reminder('Chiama la pediatra', :'A', now() - interval '1 minute',
  now() + interval '3 hours', 30, 'urgente', 'none', null, 'speciale', 'Cena romantica') as r1 \gset
select pg_temp.expect_error(format('select public.create_reminder(''x'', %L, now(), now() - interval ''1 hour'')', :'A'), '%dopo l''inizio%');
select pg_temp.expect_error(format('select public.create_reminder(''x'', %L, now())', :'C'), '%solo a te o al tuo partner%');
select pg_temp.expect_error(format('select public.create_reminder(''x'', %L, now(), null, 45)', :'A'), '%Ripetizione non valida%');
select pg_temp.expect_error(format('select public.create_reminder(''x'', %L, now(), null, 0, ''normale'', ''custom'', ''{}'')', :'A'), '%almeno un giorno%');
do $$ begin
  assert (select count(*) from reward_details) = 1, 'B vede il dettaglio che ha scritto';
end $$;
reset role;

\echo '6. A vede il promemoria ma non il premio speciale; C non vede nulla'
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
do $$ begin
  assert (select count(*) from reminders) = 1;
  assert (select count(*) from reward_details) = 0, 'premio speciale nascosto ad A';
end $$;
select pg_temp.expect_error(format('update public.reminders set status = ''done'' where id = %L', :'r1'), '%permission denied%');
select pg_temp.expect_error(format('select public.delete_reminder(%L)', :'r1'), '%solo i promemoria che hai creato%');
select set_config('request.jwt.claim.sub', :'C', false);
do $$ begin
  assert (select count(*) from reminders) = 0;
end $$;
reset role;

\echo '7. motore: prima notifica, niente doppioni, ripetizione ogni 30 min'
set role service_role;
select public.claim_work() as w1 \gset
reset role;
do $$
declare w jsonb := current_setting('test.w1', true)::jsonb;
begin null; end $$;
select jsonb_array_length(:'w1'::jsonb) = 1 as one \gset
\if :one
\else
  \echo 'claim 1 errato:' :'w1' \q
\endif
select (:'w1'::jsonb)->0->>'body';
do $$ begin
  assert (select notify_count from reminders limit 1) = 1;
end $$;
set role service_role;
select jsonb_array_length(public.claim_work()) = 0 as none \gset
reset role;
\if :none
\else
  \echo 'doppione inviato' \q
\endif
update reminders set last_notified_at = now() - interval '28 minutes' where id = :'r1';
set role service_role;
select jsonb_array_length(public.claim_work()) = 0 as early \gset
reset role;
\if :early
\else
  \echo 'ripetizione troppo presto' \q
\endif
update reminders set last_notified_at = now() - interval '29 minutes 40 seconds' where id = :'r1';
set role service_role;
select jsonb_array_length(public.claim_work()) = 1 as again \gset
reset role;
\if :again
\else
  \echo 'ripetizione mancata' \q
\endif

\echo '8. A rimanda: notifiche ripartono dal nuovo orario, B viene avvisata'
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
select public.postpone_reminder(:'r1', now() + interval '1 day', now() + interval '1 day 4 hours', 'Sono al lavoro');
select pg_temp.expect_error(format('select public.postpone_reminder(%L, now() - interval ''1 hour'')', :'r1'), '%nel futuro%');
reset role;
do $$ begin
  assert (select last_notified_at is null and postpone_count = 1 and postpone_note = 'Sono al lavoro' from reminders limit 1);
end $$;
set role service_role;
select public.claim_work() as w2 \gset
reset role;
select jsonb_array_length(:'w2'::jsonb) = 1 and (:'w2'::jsonb)->0->>'kind' = 'rinvio'
  and (:'w2'::jsonb)->0->>'user_id' = :'B' as rinvio_ok \gset
\if :rinvio_ok
\else
  \echo 'rinvio errato:' :'w2' \q
\endif
select (:'w2'::jsonb)->0->>'title', (:'w2'::jsonb)->0->>'body';

\echo '9. A segna Fatto: scopre il premio, B viene avvisata'
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
select public.complete_reminder(:'r1') as done1 \gset
do $$ begin
  assert (select count(*) from reward_details) = 1, 'ora A vede il premio';
end $$;
select (:'done1'::jsonb)->>'reward_detail' = 'Cena romantica' as reveal \gset
\if :reveal
\else
  \echo 'premio non svelato' \q
\endif
select ((public.complete_reminder(:'r1'))->>'already_done')::boolean as idem \gset
\if :idem
\else
  \echo 'secondo Fatto non idempotente' \q
\endif
reset role;
set role service_role;
select public.claim_work() as w3 \gset
reset role;
select (:'w3'::jsonb)->0->>'kind' = 'fatto' and jsonb_array_length(:'w3'::jsonb) = 1 as fatto_ok \gset
\if :fatto_ok
\else
  \echo 'avviso fatto errato:' :'w3' \q
\endif
select (:'w3'::jsonb)->0->>'title', (:'w3'::jsonb)->0->>'body';

\echo '10. ricorrenze: ogni giorno, giorni scelti, durata conservata'
set role authenticated;
select set_config('request.jwt.claim.sub', :'B', false);
select public.create_reminder('Butta la spazzatura', :'A', now() - interval '30 minutes',
  now() + interval '30 minutes', 0, 'normale', 'daily', null, 'film', 'Scegli tu il film') as r2 \gset
select public.create_reminder('Palestra', :'A', now() - interval '10 minutes', null, 0, 'normale',
  'custom', '{1,3}') as r3 \gset
select set_config('request.jwt.claim.sub', :'A', false);
select public.complete_reminder(:'r2') is not null;
select public.complete_reminder(:'r3') is not null;
reset role;
do $$
declare
  n public.reminders;
  o public.reminders;
begin
  select * into o from reminders where title = 'Butta la spazzatura' and status = 'done';
  select * into n from reminders where title = 'Butta la spazzatura' and status = 'pending';
  assert n.id is not null, 'nuova occorrenza giornaliera mancante';
  assert n.start_at > now(), 'la nuova occorrenza deve essere nel futuro';
  assert (n.start_at at time zone 'Europe/Rome')::time = (o.plan_start_at at time zone 'Europe/Rome')::time, 'stessa ora';
  assert n.end_at - n.start_at = interval '1 hour', 'durata conservata';
  assert n.series_id = o.id;
  assert (select detail from reward_details where reminder_id = n.id) = 'Scegli tu il film', 'premio copiato';
  select * into n from reminders where title = 'Palestra' and status = 'pending';
  assert extract(isodow from n.start_at at time zone 'Europe/Rome') in (1, 3), 'solo lunedì o mercoledì';
  assert n.recurrence_days = '{1,3}';
end $$;

\echo '11. scadenza: tempo finito senza Fatto'
set role authenticated;
select set_config('request.jwt.claim.sub', :'B', false);
select public.create_reminder('Ritira il pacco', :'A', now() - interval '2 hours', now() + interval '1 minute') as r4 \gset
reset role;
update reminders set end_at = now() - interval '1 minute' where id = :'r4';
set role service_role;
select public.claim_work() as w4 \gset
reset role;
do $$ begin
  assert (select status from reminders where title = 'Ritira il pacco') = 'missed';
end $$;
select jsonb_path_exists(:'w4'::jsonb, '$[*] ? (@.kind == "scaduto")') as scaduto_ok \gset
\if :scaduto_ok
\else
  \echo 'avviso scaduto mancante:' :'w4' \q
\endif

\echo '12. letto, dispositivi, prova notifica'
set role authenticated;
select set_config('request.jwt.claim.sub', :'B', false);
select public.create_reminder('Compra il pane', :'A', now() + interval '3 hours') as r5 \gset
select public.mark_read(array[:'r5'::uuid]) = 0 as not_mine \gset
select set_config('request.jwt.claim.sub', :'A', false);
select public.mark_read(array[:'r5'::uuid]) = 1 as mine \gset
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abc', 'pk', 'au', 'Chrome Android');
select pg_temp.expect_error('select public.save_push_subscription(''http://x'', ''a'', ''b'')', '%non valida%');
select public.request_test_push() = 1 as test_push \gset
select set_config('request.jwt.claim.sub', :'B', false);
select (public.couple_info()->'partner'->>'push_devices')::int = 1 as partner_push \gset
do $$ begin
  assert (select count(*) from push_subscriptions) = 0, 'B non vede i dispositivi di A';
end $$;
reset role;
\if :not_mine
\else
  \echo 'B ha segnato letto un promemoria non suo' \q
\endif
\if :partner_push
\else
  \echo 'conteggio dispositivi partner errato' \q
\endif

\echo '13. chi era da solo può unirsi portando i suoi promemoria'
insert into auth.users (id, email, raw_user_meta_data) values
  ('44444444-4444-4444-4444-444444444444', 'd@example.com', '{}'),
  ('55555555-5555-5555-5555-555555555555', 'e@example.com', '{}');
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select public.create_couple() as code2 \gset
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select public.create_reminder('Mio promemoria', '55555555-5555-5555-5555-555555555555', now() + interval '1 hour') is not null;
select public.join_couple(:'code2') is not null;
do $$ begin
  assert (select count(*) from reminders where title = 'Mio promemoria') = 1, 'promemoria portato nella nuova coppia';
  assert (public.couple_info()->'partner'->>'id') = '44444444-4444-4444-4444-444444444444';
end $$;
reset role;
do $$ begin
  assert (select count(*) from couples) = 2, 'coppia vuota eliminata';
end $$;

\echo '14. Fatto dalla notifica (solo motore)'
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
select pg_temp.expect_error(format('select public.complete_from_notification(%L, %L)', :'r5', :'A'), '%permission denied%');
reset role;
set role service_role;
select (public.complete_from_notification(:'r5', :'A')->>'title') = 'Compra il pane' as notif_done \gset
select pg_temp.expect_error(format('select public.complete_from_notification(%L, %L)', :'r5', :'B'), '%non trovato%');
reset role;
\if :notif_done
\else
  \echo 'Fatto da notifica non riuscito' \q
\endif

\echo 'TUTTI I TEST DEL DATABASE SUPERATI'
