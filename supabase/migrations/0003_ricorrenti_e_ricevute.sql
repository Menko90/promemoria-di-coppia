-- 0003 · Promemoria ricorrenti senza orario limite e ricevute di consegna delle notifiche

-- 1. La volta successiva di un promemoria ricorrente dopo un certo momento.
--    Stessa regola di spawn_next: si parte dall'orario pianificato e si aggiunge un giorno,
--    una settimana o il prossimo giorno scelto, nell'ora locale della coppia (ora legale compresa).
create or replace function public.next_occurrence(r public.reminders, p_after timestamptz)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  v_tz text;
  v_local timestamp;
  v_start timestamptz;
  i int := 0;
begin
  if r.recurrence = 'none' then
    return null;
  end if;
  select timezone into v_tz from public.couples where id = r.couple_id;
  v_local := r.plan_start_at at time zone v_tz;
  loop
    i := i + 1;
    if i > 2000 then
      return null;
    end if;
    if r.recurrence = 'daily' then
      v_local := v_local + interval '1 day';
    elsif r.recurrence = 'weekly' then
      v_local := v_local + interval '7 days';
    else
      v_local := v_local + interval '1 day';
      continue when not (extract(isodow from v_local)::int = any (r.recurrence_days));
    end if;
    v_start := v_local at time zone v_tz;
    if v_start > p_after then
      return v_start;
    end if;
  end loop;
end $$;

-- 2. Un ricorrente SENZA orario limite vale fino alla volta successiva. Se nessuno l'ha
--    segnato fatto, quando arriva la volta successiva diventa "scaduto" e nasce la nuova volta,
--    che il motore notifica subito. Prima restava fermo per sempre e non mandava più notifiche.
--    Il motore la chiama ogni minuto, prima di claim_work.
create or replace function public.roll_recurring()
returns int language plpgsql security definer set search_path = public as $$
declare
  r public.reminders;
  v_cur timestamptz;
  v_after timestamptz;
  v_name text;
  v_new uuid;
  v_horizon timestamptz := now() + interval '1 minute'; -- un minuto prima, così la nuova volta parte puntuale
  k int;
  n int := 0;
begin
  for r in
    select * from public.reminders
    where status = 'pending' and recurrence <> 'none' and end_at is null
    for update skip locked
  loop
    -- la volta dopo questa (se è stata rimandata, si conta dal nuovo orario)
    v_cur := public.next_occurrence(r, greatest(r.plan_start_at, r.start_at));
    continue when v_cur is null or v_cur > v_horizon;
    -- se ne sono passate più d'una, si riparte dalla più recente
    k := 0;
    loop
      k := k + 1;
      v_after := public.next_occurrence(r, v_cur);
      exit when v_after is null or v_after > v_horizon or k > 2000;
      v_cur := v_after;
    end loop;

    update public.reminders set status = 'missed' where id = r.id;
    if r.created_by <> r.assigned_to then
      select display_name into v_name from public.profiles where id = r.assigned_to;
      insert into public.push_outbox (user_id, reminder_id, kind, title, body)
      values (r.created_by, r.id, 'scaduto', 'Tempo scaduto: ' || r.title,
              v_name || ' non l''ha segnato come fatto in tempo');
    end if;

    insert into public.reminders (
      couple_id, created_by, assigned_to, title, priority, start_at, end_at,
      repeat_minutes, recurrence, recurrence_days, plan_start_at, plan_end_at, reward, series_id)
    values (
      r.couple_id, r.created_by, r.assigned_to, r.title, r.priority, v_cur, null,
      r.repeat_minutes, r.recurrence, r.recurrence_days, v_cur, null, r.reward,
      coalesce(r.series_id, r.id))
    returning id into v_new;
    insert into public.reward_details (reminder_id, detail)
      select v_new, detail from public.reward_details where reminder_id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- 3. Ricevute: quando la notifica arriva sul telefono, il telefono lo comunica al server.
--    Così si distingue "non partita", "partita ma mai arrivata" e "arrivata".
--    Tabella a parte perché la ricevuta può arrivare prima che il motore scriva il registro.
alter table public.push_log add column if not exists delivery_id uuid;
create index if not exists push_log_delivery_idx on public.push_log (delivery_id) where delivery_id is not null;

create table if not exists public.push_receipts (
  delivery_id uuid primary key,
  received_at timestamptz not null default now()
);
alter table public.push_receipts enable row level security;
revoke all on public.push_receipts from anon, authenticated;
grant all on public.push_receipts to service_role;

-- permessi: solo il motore
revoke execute on function public.next_occurrence(public.reminders, timestamptz), public.roll_recurring()
  from public, anon, authenticated;
grant execute on function public.next_occurrence(public.reminders, timestamptz), public.roll_recurring()
  to service_role;
