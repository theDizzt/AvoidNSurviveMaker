-- After crystal_stars. Personal backups are never evidence for a leaderboard.
begin;
alter table public.level_records alter column verified set default false;
update public.level_records set verified = false where verified;
comment on column public.level_records.verified is 'Legacy compatibility flag, always false. Rankings use verified_level_records.';

create table public.verified_level_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  level_key text not null check (level_key ~ '^[A-Za-z0-9_-]{1,60}/[A-Za-z0-9_-]{1,60}@[a-f0-9]{64}$'),
  best_ms integer not null check (best_ms > 0 and best_ms <= 120000),
  stars smallint not null check (stars between 0 and 3),
  crystal boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, level_key)
);
alter table public.verified_level_records enable row level security;
revoke all on public.verified_level_records from public, anon, authenticated;
create index verified_level_rank on public.verified_level_records(level_key, best_ms, updated_at);

create table public.replay_verification_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_attempt timestamptz not null
);
alter table public.replay_verification_limits enable row level security;
revoke all on public.replay_verification_limits from public, anon, authenticated;

create function public.claim_replay_verification(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare claimed uuid;
begin
  insert into public.replay_verification_limits as r(user_id, last_attempt)
  values (p_user, clock_timestamp())
  on conflict (user_id) do update set last_attempt = excluded.last_attempt
  where r.last_attempt < clock_timestamp() - interval '3 seconds'
  returning user_id into claimed;
  return claimed is not null;
end;
$$;
revoke all on function public.claim_replay_verification(uuid) from public, anon, authenticated;
grant execute on function public.claim_replay_verification(uuid) to service_role;

create function public.store_verified_record(p_user uuid, p_key text, p_ms integer, p_stars smallint, p_crystal boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Only the trusted verifier can call this; serialize quota checks per account.
  perform 1 from public.profiles where id = p_user for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if not exists(select 1 from public.verified_level_records where user_id = p_user and level_key = p_key)
     and (select count(*) from public.verified_level_records where user_id = p_user) >= 2000 then
    raise exception 'RECORD_QUOTA_EXCEEDED';
  end if;
  insert into public.verified_level_records as r(user_id, level_key, best_ms, stars, crystal)
  values(p_user, p_key, p_ms, p_stars, p_crystal)
  on conflict (user_id, level_key) do update set
    best_ms = least(r.best_ms, excluded.best_ms), stars = greatest(r.stars, excluded.stars),
    crystal = r.crystal or excluded.crystal,
    updated_at = case when excluded.best_ms < r.best_ms then now() else r.updated_at end;
end;
$$;
revoke all on function public.store_verified_record(uuid, text, integer, smallint, boolean) from public, anon, authenticated;
grant execute on function public.store_verified_record(uuid, text, integer, smallint, boolean) to service_role;

create or replace function public.level_leaderboard(p_key text, p_limit integer default 10)
returns table (place bigint, nickname text, discriminator smallint, best_ms integer, stars smallint, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with ranked as (
    select r.user_id, r.best_ms, r.stars, r.updated_at, rank() over(order by r.best_ms) as place
    from public.verified_level_records r where r.level_key = p_key
  )
  select x.place, p.nickname, p.discriminator, x.best_ms, x.stars,
    coalesce(x.user_id = auth.uid(), false)
  from ranked x join public.profiles p on p.id = x.user_id
  where x.place <= least(greatest(coalesce(p_limit, 10), 1), 50) or x.user_id = auth.uid()
  order by x.place, x.updated_at, x.user_id limit 51;
$$;
revoke all on function public.level_leaderboard(text, integer) from public;
grant execute on function public.level_leaderboard(text, integer) to anon, authenticated;

-- Old unversioned rows remain private historical data; never guess their content version.
alter table public.level_deaths drop constraint level_deaths_key_format;
alter table public.level_deaths add constraint level_deaths_key_format check (
  level_key ~ '^(custom:)?[A-Za-z0-9_-]{1,60}/((0|[1-9][0-9]{0,2})|[A-Za-z0-9_-]{1,60}@[a-f0-9]{64})$'
);


create or replace function public.submit_level_records(p_records jsonb)
returns table (level_key text, best_ms integer, stars smallint, crystal boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  entry jsonb;
  record_key text;
  ms numeric;
  star_count numeric;
  has_crystal boolean;
  row_count integer;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if p_records is not null and jsonb_typeof(p_records) <> 'array' then
    raise exception 'INVALID_RECORDS' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_records, '[]'::jsonb)::text) > 1048576
     or jsonb_array_length(coalesce(p_records, '[]'::jsonb)) > 2000 then
    raise exception 'TOO_MANY_RECORDS' using errcode = '22023';
  end if;
  -- The same per-account lock makes the quota safe against parallel batches.
  perform 1 from public.profiles p where p.id = uid for update;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode = '28000'; end if;
  select count(*) into row_count from public.level_records r where r.user_id = uid;
  for entry in select value from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) loop
    if jsonb_typeof(entry) <> 'object'
       or jsonb_typeof(entry->'key') is distinct from 'string'
       or jsonb_typeof(entry->'best_ms') is distinct from 'number'
       or jsonb_typeof(entry->'stars') is distinct from 'number' then continue; end if;
    -- Optional; anything but a JSON boolean true counts as no crystal
    has_crystal := jsonb_typeof(entry->'crystal') = 'boolean' and (entry->>'crystal')::boolean;
    record_key := entry->>'key';
    -- Theme IDs follow the content schema; custom packs contain at most 999 levels.
    if record_key !~ '^(custom:)?[A-Za-z0-9_-]{1,60}/((0|[1-9][0-9]{0,2})|[A-Za-z0-9_-]{1,60}@[a-f0-9]{64})$' then continue; end if;
    if position('@' in record_key) = 0 then
      if split_part(record_key, '/', 2)::integer > 998 then continue; end if;
    end if;
    ms := (entry->>'best_ms')::numeric;
    star_count := (entry->>'stars')::numeric;
    if ms < 1 or ms > 2147483647 or ms <> floor(ms)
       or star_count not in (0, 1, 2, 3) then continue; end if;
    if not exists (select 1 from public.level_records r where r.user_id = uid and r.level_key = record_key) then
      if row_count >= 2000 then raise exception 'RECORD_QUOTA_EXCEEDED' using errcode = '22023'; end if;
      row_count := row_count + 1;
    end if;
    insert into public.level_records as r (user_id, level_key, best_ms, stars, crystal, verified)
      values (uid, record_key, ms::integer, star_count::smallint, coalesce(has_crystal, false), false)
    on conflict on constraint level_records_pkey do update
      set best_ms = least(r.best_ms, excluded.best_ms),
          stars = greatest(r.stars, excluded.stars),
          crystal = r.crystal or excluded.crystal,
          verified = false,
          updated_at = case
            when excluded.best_ms < r.best_ms or excluded.stars > r.stars or (excluded.crystal and not r.crystal) then now()
            else r.updated_at
          end;
  end loop;
  return query select r.level_key, r.best_ms, r.stars, r.crystal
    from public.level_records r where r.user_id = uid order by r.level_key limit 2000;
end;
$$;


create or replace function public.add_deaths(p_total integer, p_levels jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  entry jsonb;
  record_key text;
  n numeric;
  level_sum bigint := 0;
  row_count integer;
  total bigint;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if p_total is null or p_total < 0 or p_total > 10000 then
    raise exception 'INVALID_DEATHS' using errcode = '22023';
  end if;
  if p_levels is not null and jsonb_typeof(p_levels) <> 'array' then
    raise exception 'INVALID_DEATHS' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_levels, '[]'::jsonb)::text) > 65536
     or jsonb_array_length(coalesce(p_levels, '[]'::jsonb)) > 200 then
    raise exception 'TOO_MANY_DEATHS' using errcode = '22023';
  end if;
  -- One lock per account serializes tabs and keeps the row quota exact
  perform 1 from public.profiles p where p.id = uid for update;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode = '28000'; end if;
  select count(*) into row_count from public.level_deaths d where d.user_id = uid;

  for entry in select value from jsonb_array_elements(coalesce(p_levels, '[]'::jsonb)) loop
    if jsonb_typeof(entry) <> 'object'
       or jsonb_typeof(entry->'key') is distinct from 'string'
       or jsonb_typeof(entry->'count') is distinct from 'number' then continue; end if;
    record_key := entry->>'key';
    if record_key !~ '^(custom:)?[A-Za-z0-9_-]{1,60}/((0|[1-9][0-9]{0,2})|[A-Za-z0-9_-]{1,60}@[a-f0-9]{64})$' then continue; end if;
    if position('@' in record_key) = 0 then
      if split_part(record_key, '/', 2)::integer > 998 then continue; end if;
    end if;
    n := (entry->>'count')::numeric;
    if n < 1 or n > 10000 or n <> floor(n) then continue; end if;
    if not exists (select 1 from public.level_deaths d where d.user_id = uid and d.level_key = record_key) then
      if row_count >= 2000 then continue; end if; -- quota full: the death still counts in the total
      row_count := row_count + 1;
    end if;
    insert into public.level_deaths as d (user_id, level_key, deaths)
      values (uid, record_key, n::bigint)
    on conflict on constraint level_deaths_pkey do update
      set deaths = d.deaths + excluded.deaths, updated_at = now();
    level_sum := level_sum + n::bigint;
  end loop;

  update public.profiles p
     set total_deaths = p.total_deaths + greatest(p_total::bigint, level_sum)
   where p.id = uid
  returning p.total_deaths into total;
  return total;
end;
$$;

-- Personal lifetime achievements count a stable level once across versions.
create or replace function public.refresh_achievements()
returns table (achievement_id text, unlocked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  insert into public.user_achievements (user_id, achievement_id)
  select uid, d.id from public.achievement_definitions d
  where (
    select coalesce(sum(case d.kind when 'stars' then least(3, greatest(0, r.stars))
      when 'perfect' then case when r.stars = 3 then 1 else 0 end else 1 end), 0)
    from (select split_part(level_key, '@', 1) as level_key, max(stars) as stars, min(best_ms) as best_ms
      from public.level_records where user_id = uid group by split_part(level_key, '@', 1)) r
    where r.level_key = any(d.level_keys) and r.best_ms > 0
  ) >= d.target
  on conflict on constraint user_achievements_pkey do nothing;
  return query select a.achievement_id, a.unlocked_at from public.user_achievements a where a.user_id = uid;
end;
$$;
notify pgrst, 'reload schema';
commit;
