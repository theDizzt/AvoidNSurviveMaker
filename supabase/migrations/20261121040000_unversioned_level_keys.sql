-- Level keys are "<theme>/<level id>" again, without the "@<content hash>" suffix: a map
-- update keeps its records instead of starting a new row. Merges the duplicate rows the suffix
-- created. Apply after 20261121030000_leaderboard_across_versions.sql.
begin;

-- Records: one row per player and level, keeping the best of every version
insert into public.level_records as r (user_id, level_key, best_ms, stars, crystal, verified, created_at, updated_at)
select user_id, split_part(level_key, '@', 1), min(best_ms), max(stars), bool_or(crystal), false, min(created_at), max(updated_at)
from public.level_records where position('@' in level_key) > 0
group by user_id, split_part(level_key, '@', 1)
on conflict on constraint level_records_pkey do update set
  best_ms = least(r.best_ms, excluded.best_ms),
  stars = greatest(r.stars, excluded.stars),
  crystal = r.crystal or excluded.crystal,
  created_at = least(r.created_at, excluded.created_at),
  updated_at = greatest(r.updated_at, excluded.updated_at);
delete from public.level_records where position('@' in level_key) > 0;

-- Deaths: add the versions together
alter table public.level_deaths drop constraint level_deaths_key_format;
insert into public.level_deaths as d (user_id, level_key, deaths, updated_at)
select user_id, split_part(level_key, '@', 1), sum(deaths), max(updated_at)
from public.level_deaths where position('@' in level_key) > 0
group by user_id, split_part(level_key, '@', 1)
on conflict on constraint level_deaths_pkey do update set
  deaths = d.deaths + excluded.deaths,
  updated_at = greatest(d.updated_at, excluded.updated_at);
delete from public.level_deaths where position('@' in level_key) > 0;
alter table public.level_deaths add constraint level_deaths_key_format
  check (level_key ~ '^(custom:)?[A-Za-z0-9_-]{1,60}/[A-Za-z0-9_-]{1,60}$');

-- Both writers accept the old suffixed keys and store them without the suffix
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
    -- "<theme>/<level id>"; older clients add "@<content hash>", which is dropped
    if record_key !~ '^(custom:)?[A-Za-z0-9_-]{1,60}/[A-Za-z0-9_-]{1,60}(@[a-f0-9]{64})?$' then continue; end if;
    record_key := split_part(record_key, '@', 1);
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
    -- "<theme>/<level id>"; older clients add "@<content hash>", which is dropped
    if record_key !~ '^(custom:)?[A-Za-z0-9_-]{1,60}/[A-Za-z0-9_-]{1,60}(@[a-f0-9]{64})?$' then continue; end if;
    record_key := split_part(record_key, '@', 1);
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

-- Keys match exactly again
create or replace function public.level_leaderboard(p_key text, p_limit integer default 10)
returns table (place bigint, nickname text, discriminator smallint, best_ms integer, stars smallint, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with ranked as (
    select r.user_id, r.best_ms, r.stars, r.updated_at, rank() over (order by r.best_ms) as place
    from public.level_records r
    where r.level_key = split_part(p_key, '@', 1) and p_key !~ '^custom:'
  )
  select x.place, p.nickname, p.discriminator, x.best_ms, x.stars,
    coalesce(x.user_id = auth.uid(), false)
  from ranked x join public.profiles p on p.id = x.user_id
  where x.place <= least(greatest(coalesce(p_limit, 10), 1), 50) or x.user_id = auth.uid()
  order by x.place, x.updated_at, x.user_id limit 51;
$$;
revoke all on function public.level_leaderboard(text, integer) from public;
grant execute on function public.level_leaderboard(text, integer) to anon, authenticated;
drop index if exists public.level_records_rank_base;

notify pgrst, 'reload schema';
commit;
