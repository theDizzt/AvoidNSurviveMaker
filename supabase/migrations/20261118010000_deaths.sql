-- Death counts per player: a running total and a count per level.
-- Apply after 20261118000000_security_hardening.sql.
--
--   profiles.total_deaths     every death in a run (chapters, custom packs, shared maps and packs;
--                             not editor test plays)
--   level_deaths.level_key    level id as the game keys its progress (same format as level_records):
--                             '<theme id>/<level index>' or 'custom:<theme id>/<level index>'
--   level_deaths.deaths       deaths on that level
--
-- A death is a run ended by the maze (wall, moving wall, void, map bounds, laser). Runs stopped by
-- the browser (cursor left the window, tab lost focus, a non-mouse pointer) don't count.
--
-- Counts are client-reported, like level records: private stats, never evidence for rankings.
-- Players read only their own rows; writes go through add_deaths(), which only adds.
begin;

alter table public.profiles
  add column total_deaths bigint not null default 0
    constraint total_deaths_nonnegative check (total_deaths >= 0);
comment on column public.profiles.total_deaths is 'Total deaths in runs (client-reported), all maps.';

create table public.level_deaths (
  user_id     uuid not null references auth.users (id) on delete cascade,
  level_key   text not null
    constraint level_deaths_key_format check (level_key ~ '^(custom:)?[A-Za-z0-9_-]{1,60}/(0|[1-9][0-9]{0,2})$'),
  deaths      bigint not null default 0 constraint level_deaths_nonnegative check (deaths >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, level_key)
);
comment on table public.level_deaths is 'Deaths per player per level. Private, client-reported; never rank.';

alter table public.level_deaths enable row level security;
create policy "Players read their own level deaths"
  on public.level_deaths for select
  to authenticated
  using (user_id = auth.uid());
revoke all on public.level_deaths from public, anon, authenticated;
grant select on public.level_deaths to authenticated;

-- Adds deaths for the signed-in player and returns the new total.
--
--   p_total   deaths since the last report, on any map (0–10000)
--   p_levels  [{"key": "workshop/0", "count": 3}, ...] — the part of p_total on chapter / custom
--             pack levels (at most 200 entries, each count 1–10000). Invalid entries are skipped.
--
-- The total grows by at least the sum of the level counts, so it never trails them. At most 2000
-- level rows per player (same quota as level_records).
create function public.add_deaths(p_total integer, p_levels jsonb)
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
    if record_key !~ '^(custom:)?[A-Za-z0-9_-]{1,60}/(0|[1-9][0-9]{0,2})$' then continue; end if;
    if split_part(record_key, '/', 2)::integer > 998 then continue; end if;
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

revoke all on function public.add_deaths(integer, jsonb) from public, anon;
grant execute on function public.add_deaths(integer, jsonb) to authenticated;

commit;
