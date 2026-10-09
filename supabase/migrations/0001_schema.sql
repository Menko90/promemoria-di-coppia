-- Promemoria di Coppia — schema del database
-- Tutte le scritture passano da funzioni (RPC) con controlli espliciti;
-- le letture sono protette da regole RLS.

-- ---------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------

create table public.couples (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  timezone text not null default 'Europe/Rome',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  couple_id uuid references public.couples(id) on delete set null,
  created_at timestamptz not null default now()
);
create index profiles_couple_idx on public.profiles(couple_id);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  assigned_to uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  priority text not null default 'normale'
    check (priority in ('urgente', 'normale', 'quando_puoi')),
  start_at timestamptz not null,
  end_at timestamptz,
  repeat_minutes int not null default 0 check (repeat_minutes in (0, 15, 30, 60)),
  recurrence text not null default 'none'
    check (recurrence in ('none', 'daily', 'weekly', 'custom')),
  recurrence_days int[],               -- giorni ISO: 1 = lunedì … 7 = domenica
  plan_start_at timestamptz not null,  -- orario previsto prima dei rinvii (serve per le ricorrenze)
  plan_end_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'missed')),
  read_at timestamptz,
  done_at timestamptz,
  postponed_at timestamptz,
  postpone_note text check (char_length(postpone_note) <= 280),
  postpone_count int not null default 0,
  last_notified_at timestamptz,
  notify_count int not null default 0,
  reward text check (reward in ('massaggio', 'film', 'cena', 'regalo', 'speciale')),
  series_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at is null or end_at > start_at)
);
create index reminders_couple_idx on public.reminders(couple_id);
create index reminders_assigned_idx on public.reminders(assigned_to, status);
create index reminders_due_idx on public.reminders(status, start_at) where status = 'pending';

-- il dettaglio del premio sta a parte: quello "speciale" resta nascosto
-- a chi deve fare il compito finché non è fatto
create table public.reward_details (
  reminder_id uuid primary key references public.reminders(id) on delete cascade,
  detail text not null check (char_length(detail) between 1 and 500)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  fail_count int not null default 0
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);

-- notifiche "di servizio" per il partner (rimandato, fatto, scaduto, prova)
create table public.push_outbox (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reminder_id uuid references public.reminders(id) on delete set null,
  kind text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index push_outbox_pending_idx on public.push_outbox(id) where sent_at is null;

-- registro degli invii, per capire cosa succede se una notifica non arriva
create table public.push_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  reminder_id uuid,
  kind text,
  ok boolean not null,
  status int,
  error text
);

-- chiavi segrete lette solo dal motore delle notifiche
create table public.app_secrets (
  key text primary key,
  value text not null
);

-- ---------------------------------------------------------------
-- Permessi di base e RLS
-- ---------------------------------------------------------------

alter table public.couples enable row level security;
alter table public.profiles enable row level security;
alter table public.reminders enable row level security;
alter table public.reward_details enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_outbox enable row level security;
alter table public.push_log enable row level security;
alter table public.app_secrets enable row level security;

-- dal browser si legge e basta: tutte le modifiche passano dalle funzioni
revoke insert, update, delete, truncate on
  public.couples, public.profiles, public.reminders, public.reward_details,
  public.push_subscriptions
  from anon, authenticated;
revoke all on public.push_outbox, public.push_log, public.app_secrets from anon, authenticated;
revoke all on public.couples, public.profiles, public.reminders, public.reward_details,
  public.push_subscriptions from anon;
grant select on public.couples, public.profiles, public.reminders, public.reward_details,
  public.push_subscriptions to authenticated;
grant all on public.couples, public.profiles, public.reminders, public.reward_details,
  public.push_subscriptions, public.push_outbox, public.push_log, public.app_secrets
  to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------
-- Funzioni di servizio
-- ---------------------------------------------------------------

create or replace function public.my_couple_id()
returns uuid language sql stable security definer set search_path = public as $$
  select couple_id from public.profiles where id = auth.uid()
$$;

create or replace function public.gen_invite_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
begin
  for i in 1..6 loop
    v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
  end loop;
  return v_code;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger reminders_touch before update on public.reminders
  for each row execute function public.touch_updated_at();

-- profilo creato in automatico al primo accesso
create or replace function public.name_from_user(p_meta jsonb, p_email text)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    nullif(split_part(trim(coalesce(p_meta->>'full_name', p_meta->>'name', '')), ' ', 1), ''),
    nullif(split_part(coalesce(p_email, ''), '@', 1), ''),
    'Tu'
  )
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, public.name_from_user(new.raw_user_meta_data, new.email),
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.ensure_profile()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Devi accedere per continuare';
  end if;
  insert into public.profiles (id, display_name, avatar_url)
  select u.id, public.name_from_user(u.raw_user_meta_data, u.email), u.raw_user_meta_data->>'avatar_url'
  from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Profilo non trovato';
  end if;
end $$;

-- "oggi alle 15:00", "domani alle 15:00", "sab 10/10 alle 15:00"
create or replace function public.quando(p_ts timestamptz, p_tz text)
returns text language sql stable set search_path = public as $$
  select case
      when (p_ts at time zone p_tz)::date = (now() at time zone p_tz)::date then 'oggi'
      when (p_ts at time zone p_tz)::date = (now() at time zone p_tz)::date + 1 then 'domani'
      else (array['dom','lun','mar','mer','gio','ven','sab'])[extract(dow from p_ts at time zone p_tz)::int + 1]
           || ' ' || to_char(p_ts at time zone p_tz, 'DD/MM')
    end || ' alle ' || to_char(p_ts at time zone p_tz, 'HH24:MI')
$$;

-- "entro le 19:00" (stesso giorno di p_ref) oppure "entro domani alle 09:00"
create or replace function public.entro(p_end timestamptz, p_ref timestamptz, p_tz text)
returns text language sql stable set search_path = public as $$
  select 'entro ' || case
      when (p_end at time zone p_tz)::date = (p_ref at time zone p_tz)::date
        then 'le ' || to_char(p_end at time zone p_tz, 'HH24:MI')
      else public.quando(p_end, p_tz)
    end
$$;

create or replace function public.reward_label(p_reward text)
returns text language sql immutable set search_path = public as $$
  select case p_reward
    when 'massaggio' then 'massaggio'
    when 'film' then 'serata film'
    when 'cena' then 'cena'
    when 'regalo' then 'regalo'
    when 'speciale' then 'premio speciale'
  end
$$;

-- ---------------------------------------------------------------
-- Regole di lettura (RLS)
-- ---------------------------------------------------------------

create policy "vedo la mia coppia" on public.couples
  for select to authenticated using (id = public.my_couple_id());

create policy "vedo me e il partner" on public.profiles
  for select to authenticated
  using (id = auth.uid() or (couple_id is not null and couple_id = public.my_couple_id()));

create policy "vedo i promemoria che ho creato o che devo fare" on public.reminders
  for select to authenticated
  using (couple_id = public.my_couple_id()
         and (created_by = auth.uid() or assigned_to = auth.uid()));

create policy "vedo il premio quando posso" on public.reward_details
  for select to authenticated
  using (exists (
    select 1 from public.reminders r
    where r.id = reward_details.reminder_id
      and (r.created_by = auth.uid()
           or (r.assigned_to = auth.uid()
               and (r.reward is distinct from 'speciale' or r.status = 'done')))
  ));

create policy "vedo i miei dispositivi" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------
-- Coppia
-- ---------------------------------------------------------------

create or replace function public.create_couple()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_existing uuid;
  v_code text;
  v_id uuid;
begin
  perform public.ensure_profile();
  select couple_id into v_existing from public.profiles where id = auth.uid() for update;
  if v_existing is not null then
    select invite_code into v_code from public.couples where id = v_existing;
    return v_code;
  end if;
  loop
    v_code := public.gen_invite_code();
    begin
      insert into public.couples (invite_code) values (v_code) returning id into v_id;
      exit;
    exception when unique_violation then
      -- codice già usato: ne genero un altro
    end;
  end loop;
  update public.profiles set couple_id = v_id where id = auth.uid();
  return v_code;
end $$;

create or replace function public.join_couple(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_target uuid;
  v_existing uuid;
  v_members int;
  v_existing_members int;
begin
  perform public.ensure_profile();
  select id into v_target from public.couples
    where invite_code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'))
    for update;
  if v_target is null then
    raise exception 'Codice non valido';
  end if;
  select couple_id into v_existing from public.profiles where id = auth.uid() for update;
  if v_existing = v_target then
    return v_target;
  end if;
  select count(*) into v_members from public.profiles where couple_id = v_target;
  if v_members >= 2 then
    raise exception 'Questa coppia è già completa';
  end if;
  if v_existing is not null then
    select count(*) into v_existing_members from public.profiles where couple_id = v_existing;
    if v_existing_members > 1 then
      raise exception 'Sei già collegato a un partner';
    end if;
    -- ero da solo: porto con me i miei promemoria e chiudo la vecchia coppia
    update public.profiles set couple_id = v_target where id = auth.uid();
    update public.reminders set couple_id = v_target where couple_id = v_existing;
    delete from public.couples where id = v_existing;
  else
    update public.profiles set couple_id = v_target where id = auth.uid();
  end if;
  return v_target;
end $$;

create or replace function public.couple_info()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles;
  v_couple public.couples;
  v_partner public.profiles;
begin
  perform public.ensure_profile();
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.couple_id is not null then
    select * into v_couple from public.couples where id = v_me.couple_id;
    select * into v_partner from public.profiles
      where couple_id = v_me.couple_id and id <> v_me.id limit 1;
  end if;
  return jsonb_build_object(
    'me', jsonb_build_object(
      'id', v_me.id, 'display_name', v_me.display_name, 'avatar_url', v_me.avatar_url,
      'push_devices', (select count(*) from public.push_subscriptions where user_id = v_me.id)),
    'couple', case when v_couple.id is null then null else jsonb_build_object(
      'id', v_couple.id, 'invite_code', v_couple.invite_code, 'timezone', v_couple.timezone) end,
    'partner', case when v_partner.id is null then null else jsonb_build_object(
      'id', v_partner.id, 'display_name', v_partner.display_name, 'avatar_url', v_partner.avatar_url,
      'push_devices', (select count(*) from public.push_subscriptions where user_id = v_partner.id)) end
  );
end $$;

create or replace function public.set_display_name(p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_profile();
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then
    raise exception 'Il nome deve avere tra 1 e 40 caratteri';
  end if;
  update public.profiles set display_name = trim(p_name) where id = auth.uid();
end $$;

-- ---------------------------------------------------------------
-- Promemoria
-- ---------------------------------------------------------------

create or replace function public.create_reminder(
  p_title text,
  p_assigned_to uuid,
  p_start timestamptz,
  p_end timestamptz default null,
  p_repeat int default 0,
  p_priority text default 'normale',
  p_recurrence text default 'none',
  p_recurrence_days int[] default null,
  p_reward text default null,
  p_reward_detail text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_couple uuid;
  v_id uuid;
  v_title text := trim(coalesce(p_title, ''));
  v_detail text := nullif(trim(coalesce(p_reward_detail, '')), '');
begin
  perform public.ensure_profile();
  select couple_id into v_couple from public.profiles where id = auth.uid();
  if v_couple is null then
    perform public.create_couple();
    select couple_id into v_couple from public.profiles where id = auth.uid();
  end if;
  if char_length(v_title) not between 1 and 140 then
    raise exception 'Scrivi cosa c''è da fare (massimo 140 caratteri)';
  end if;
  if p_assigned_to is null or not exists (
    select 1 from public.profiles where id = p_assigned_to and couple_id = v_couple) then
    raise exception 'Puoi assegnare promemoria solo a te o al tuo partner';
  end if;
  if p_start is null then
    raise exception 'Scegli quando deve arrivare la prima notifica';
  end if;
  if p_end is not null and p_end <= p_start then
    raise exception 'L''orario limite deve venire dopo l''inizio';
  end if;
  if p_end is not null and p_end <= now() then
    raise exception 'L''orario limite è già passato';
  end if;
  if coalesce(p_repeat, 0) not in (0, 15, 30, 60) then
    raise exception 'Ripetizione non valida';
  end if;
  if coalesce(p_priority, 'normale') not in ('urgente', 'normale', 'quando_puoi') then
    raise exception 'Priorità non valida';
  end if;
  if coalesce(p_recurrence, 'none') not in ('none', 'daily', 'weekly', 'custom') then
    raise exception 'Ricorrenza non valida';
  end if;
  if p_recurrence = 'custom' and (p_recurrence_days is null or cardinality(p_recurrence_days) = 0
      or not (p_recurrence_days <@ array[1,2,3,4,5,6,7])) then
    raise exception 'Scegli almeno un giorno della settimana';
  end if;
  if p_reward is not null and p_reward not in ('massaggio', 'film', 'cena', 'regalo', 'speciale') then
    raise exception 'Premio non valido';
  end if;
  if v_detail is not null and char_length(v_detail) > 500 then
    raise exception 'Il dettaglio del premio è troppo lungo';
  end if;

  insert into public.reminders (
    couple_id, created_by, assigned_to, title, priority, start_at, end_at,
    repeat_minutes, recurrence, recurrence_days, plan_start_at, plan_end_at, reward)
  values (
    v_couple, auth.uid(), p_assigned_to, v_title, coalesce(p_priority, 'normale'), p_start, p_end,
    coalesce(p_repeat, 0), coalesce(p_recurrence, 'none'),
    case when p_recurrence = 'custom' then (select array_agg(distinct d order by d) from unnest(p_recurrence_days) d) end,
    p_start, p_end, p_reward)
  returning id into v_id;

  update public.reminders set series_id = v_id where id = v_id;

  if p_reward is not null and v_detail is not null then
    insert into public.reward_details (reminder_id, detail) values (v_id, v_detail);
  end if;
  return v_id;
end $$;

-- prossima occorrenza di un promemoria ricorrente
create or replace function public.spawn_next(r public.reminders)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_local timestamp;
  v_start timestamptz;
  v_end timestamptz;
  v_new uuid;
  i int := 0;
begin
  if r.recurrence = 'none' then
    return null;
  end if;
  select timezone into v_tz from public.couples where id = r.couple_id;
  v_local := r.plan_start_at at time zone v_tz;
  loop
    i := i + 1;
    if i > 800 then
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
    exit when v_start > now();
  end loop;
  if r.plan_end_at is not null then
    v_end := ((v_local + ((r.plan_end_at at time zone v_tz) - (r.plan_start_at at time zone v_tz))) at time zone v_tz);
  end if;

  insert into public.reminders (
    couple_id, created_by, assigned_to, title, priority, start_at, end_at,
    repeat_minutes, recurrence, recurrence_days, plan_start_at, plan_end_at, reward, series_id)
  values (
    r.couple_id, r.created_by, r.assigned_to, r.title, r.priority, v_start, v_end,
    r.repeat_minutes, r.recurrence, r.recurrence_days, v_start, v_end, r.reward,
    coalesce(r.series_id, r.id))
  returning id into v_new;

  insert into public.reward_details (reminder_id, detail)
    select v_new, detail from public.reward_details where reminder_id = r.id;
  return v_new;
end $$;

-- completamento (usato sia dall'app sia dal pulsante "Fatto" nella notifica)
create or replace function public.complete_internal(p_id uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.reminders;
  v_name text;
  v_detail text;
begin
  select * into r from public.reminders where id = p_id for update;
  if not found or r.assigned_to <> p_user then
    raise exception 'Promemoria non trovato';
  end if;
  if r.status = 'pending' then
    update public.reminders set status = 'done', done_at = now() where id = p_id;
    if r.created_by <> r.assigned_to then
      select display_name into v_name from public.profiles where id = r.assigned_to;
      insert into public.push_outbox (user_id, reminder_id, kind, title, body)
      values (r.created_by, r.id, 'fatto',
              v_name || ' ha fatto: ' || r.title,
              case when r.reward is not null
                   then 'Ora tocca a te: ' || public.reward_label(r.reward) || ' promesso!'
                   else 'Promemoria completato' end);
    end if;
    perform public.spawn_next(r);
  end if;
  select detail into v_detail from public.reward_details where reminder_id = p_id;
  return jsonb_build_object(
    'id', r.id, 'title', r.title, 'reward', r.reward, 'reward_detail', v_detail,
    'already_done', r.status <> 'pending');
end $$;

create or replace function public.complete_reminder(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_profile();
  return public.complete_internal(p_id, auth.uid());
end $$;

create or replace function public.postpone_reminder(
  p_id uuid, p_start timestamptz, p_end timestamptz default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.reminders;
  v_name text;
  v_tz text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  perform public.ensure_profile();
  select * into r from public.reminders where id = p_id for update;
  if not found or r.assigned_to <> auth.uid() then
    raise exception 'Promemoria non trovato';
  end if;
  if r.status <> 'pending' then
    raise exception 'Questo promemoria non è più da fare';
  end if;
  if p_start is null or p_start < now() - interval '2 minutes' then
    raise exception 'Scegli un orario nel futuro';
  end if;
  if p_end is not null and p_end <= p_start then
    raise exception 'La nuova fine deve venire dopo il nuovo inizio';
  end if;
  if v_note is not null and char_length(v_note) > 280 then
    raise exception 'La nota è troppo lunga';
  end if;

  update public.reminders set
    start_at = p_start,
    end_at = p_end,
    last_notified_at = null,
    notify_count = 0,
    postponed_at = now(),
    postpone_note = v_note,
    postpone_count = postpone_count + 1
  where id = p_id;

  if r.created_by <> r.assigned_to then
    select display_name into v_name from public.profiles where id = r.assigned_to;
    select timezone into v_tz from public.couples where id = r.couple_id;
    insert into public.push_outbox (user_id, reminder_id, kind, title, body)
    values (r.created_by, r.id, 'rinvio',
            v_name || ' ha rimandato: ' || r.title,
            'Nuovo orario: ' || public.quando(p_start, v_tz)
              || case when p_end is not null then ', ' || public.entro(p_end, p_start, v_tz) else '' end
              || case when v_note is not null then ' · «' || v_note || '»' else '' end);
  end if;
end $$;

create or replace function public.mark_read(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  update public.reminders set read_at = now()
    where id = any (p_ids) and assigned_to = auth.uid() and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.delete_reminder(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.reminders where id = p_id and created_by = auth.uid();
  if not found then
    raise exception 'Puoi eliminare solo i promemoria che hai creato tu';
  end if;
end $$;

-- ---------------------------------------------------------------
-- Notifiche: dispositivi
-- ---------------------------------------------------------------

create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_profile();
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Iscrizione alle notifiche non valida';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set
    user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, fail_count = 0;
end $$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

create or replace function public.request_test_push()
returns int language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_profile();
  insert into public.push_outbox (user_id, kind, title, body)
  values (auth.uid(), 'prova', 'Prova notifica', 'Se leggi questo messaggio, le notifiche funzionano.');
  return (select count(*) from public.push_subscriptions where user_id = auth.uid());
end $$;

-- ultimi invii verso di me (per la schermata "Notifiche")
create or replace function public.my_push_log()
returns table (created_at timestamptz, kind text, ok boolean, status int, error text)
language sql stable security definer set search_path = public as $$
  select l.created_at, l.kind, l.ok, l.status, l.error
  from public.push_log l where l.user_id = auth.uid()
  order by l.created_at desc limit 20
$$;

-- ---------------------------------------------------------------
-- Motore: chiamato ogni minuto (e a richiesta) dalla funzione "motore"
-- ---------------------------------------------------------------

create or replace function public.reminder_body(r public.reminders, p_creator text, p_tz text)
returns text language sql stable set search_path = public as $$
  select concat_ws(' · ',
    case when r.priority = 'urgente' then 'Urgente' end,
    case when r.created_by <> r.assigned_to then 'da ' || p_creator else 'promemoria per te' end,
    case when r.end_at is not null then public.entro(r.end_at, now(), p_tz) end,
    case when r.reward = 'speciale' then 'premio speciale in palio'
         when r.reward is not null then 'premio: ' || public.reward_label(r.reward) end)
$$;

create or replace function public.claim_work()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_out jsonb := '[]'::jsonb;
  r public.reminders;
  v_creator text;
  v_tz text;
  o public.push_outbox;
begin
  -- 1. promemoria con orario limite passato senza "Fatto"
  for r in
    select * from public.reminders
    where status = 'pending' and end_at is not null and end_at < now()
    for update skip locked
  loop
    update public.reminders set status = 'missed' where id = r.id;
    if r.created_by <> r.assigned_to then
      select display_name into v_creator from public.profiles where id = r.assigned_to;
      insert into public.push_outbox (user_id, reminder_id, kind, title, body)
      values (r.created_by, r.id, 'scaduto', 'Tempo scaduto: ' || r.title,
              v_creator || ' non l''ha segnato come fatto in tempo');
    end if;
    perform public.spawn_next(r);
  end loop;

  -- 2. promemoria da notificare adesso
  for r in
    select * from public.reminders
    where status = 'pending'
      and start_at <= now()
      and (end_at is null or end_at >= now())
      and (last_notified_at is null
           or (repeat_minutes > 0
               and last_notified_at <= now() - make_interval(mins => repeat_minutes) + interval '30 seconds'))
    order by start_at
    for update skip locked
  loop
    update public.reminders
      set last_notified_at = now(), notify_count = notify_count + 1
      where id = r.id;
    select p.display_name, c.timezone into v_creator, v_tz
      from public.profiles p join public.couples c on c.id = r.couple_id
      where p.id = r.created_by;
    v_out := v_out || jsonb_build_object(
      'user_id', r.assigned_to,
      'reminder_id', r.id,
      'kind', 'promemoria',
      'title', r.title,
      'body', public.reminder_body(r, v_creator, v_tz),
      'urgent', r.priority = 'urgente',
      'actions', true,
      'reward', r.reward,
      'count', r.notify_count + 1);
  end loop;

  -- 3. notifiche di servizio
  for o in
    select * from public.push_outbox where sent_at is null order by id limit 200
    for update skip locked
  loop
    update public.push_outbox set sent_at = now() where id = o.id;
    v_out := v_out || jsonb_build_object(
      'user_id', o.user_id,
      'reminder_id', o.reminder_id,
      'kind', o.kind,
      'title', o.title,
      'body', o.body,
      'urgent', false,
      'actions', false);
  end loop;

  -- 4. pulizia
  delete from public.push_log where created_at < now() - interval '14 days';
  delete from public.push_outbox where sent_at < now() - interval '14 days';

  return v_out;
end $$;

create or replace function public.complete_from_notification(p_id uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public.complete_internal(p_id, p_user);
end $$;

-- ---------------------------------------------------------------
-- Chi può chiamare cosa
-- ---------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.my_couple_id(),
  public.create_couple(),
  public.join_couple(text),
  public.couple_info(),
  public.set_display_name(text),
  public.create_reminder(text, uuid, timestamptz, timestamptz, int, text, text, int[], text, text),
  public.complete_reminder(uuid),
  public.postpone_reminder(uuid, timestamptz, timestamptz, text),
  public.mark_read(uuid[]),
  public.delete_reminder(uuid),
  public.save_push_subscription(text, text, text, text),
  public.remove_push_subscription(text),
  public.request_test_push(),
  public.my_push_log()
to authenticated;

grant execute on function
  public.claim_work(),
  public.complete_from_notification(uuid, uuid)
to service_role;

-- aggiornamenti in tempo reale sull'app
alter publication supabase_realtime add table public.reminders;
