-- Personal sync data is client-reported, never evidence of a verified clear.
-- Apply after 20261117030000_level_records.sql. Existing records are preserved.
begin;

-- Keep private activity fields behind owner-only RLS. Public identity has its
-- own explicitly projected view; adding profile columns cannot expose them.
drop policy "Profiles are readable by everyone" on public.profiles;
create policy "Players read their own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
create view public.public_profiles with (security_barrier = true) as
  select id, nickname, discriminator from public.profiles;
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

alter table public.level_records
  add column verified boolean not null default false;
comment on column public.level_records.verified is
  'False for all browser submissions, including historical records. Only a trusted replay verifier may set true. Never rank unverified rows.';
comment on table public.level_records is
  'Private client-reported progress backups. Times and stars are untrusted unless verified by a trusted server.';
revoke all on public.level_records from public, anon, authenticated;
grant select on public.level_records to authenticated;

create or replace function public.add_play_time(p_seconds integer)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  profile public.profiles%rowtype;
  report_at timestamptz;
  credit_from timestamptz;
  credited bigint;
  total bigint;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  -- Serialize tabs and concurrent requests before reading the clock.
  select * into strict profile from public.profiles p where p.id = uid for update;
  if p_seconds is null or p_seconds <= 0 then return profile.total_play_seconds; end if;
  report_at := clock_timestamp();
  credit_from := greatest(coalesce(profile.last_play_report_at, profile.created_at),
                          profile.created_at, report_at - interval '1 hour');
  credited := least(p_seconds::bigint, 3600,
    greatest(0, floor(extract(epoch from (report_at - credit_from)))::bigint));
  update public.profiles p
    set total_play_seconds = p.total_play_seconds + credited,
        -- Consume only credited whole seconds; no repeatable per-request grace.
        last_play_report_at = credit_from + credited * interval '1 second'
    where p.id = uid returning p.total_play_seconds into total;
  return total;
end;
$$;

create or replace function public.submit_level_records(p_records jsonb)
returns table (level_key text, best_ms integer, stars smallint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  entry jsonb;
  record_key text;
  ms numeric;
  star_count numeric;
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
    record_key := entry->>'key';
    -- Theme IDs follow the content schema; custom packs contain at most 999 levels.
    if record_key !~ '^(custom:)?[A-Za-z0-9_-]{1,60}/(0|[1-9][0-9]{0,2})$' then continue; end if;
    if split_part(record_key, '/', 2)::integer > 998 then continue; end if;
    ms := (entry->>'best_ms')::numeric;
    star_count := (entry->>'stars')::numeric;
    if ms < 1 or ms > 2147483647 or ms <> floor(ms)
       or star_count not in (0, 1, 2, 3) then continue; end if;
    if not exists (select 1 from public.level_records r where r.user_id = uid and r.level_key = record_key) then
      if row_count >= 2000 then raise exception 'RECORD_QUOTA_EXCEEDED' using errcode = '22023'; end if;
      row_count := row_count + 1;
    end if;
    insert into public.level_records as r (user_id, level_key, best_ms, stars, verified)
      values (uid, record_key, ms::integer, star_count::smallint, false)
    on conflict on constraint level_records_pkey do update
      set best_ms = least(r.best_ms, excluded.best_ms),
          stars = greatest(r.stars, excluded.stars),
          verified = case when excluded.best_ms < r.best_ms or excluded.stars > r.stars then false else r.verified end,
          updated_at = case when excluded.best_ms < r.best_ms or excluded.stars > r.stars then now() else r.updated_at end;
  end loop;
  return query select r.level_key, r.best_ms, r.stars
    from public.level_records r where r.user_id = uid order by r.level_key limit 2000;
end;
$$;

revoke all on function public.add_play_time(integer) from public, anon;
grant execute on function public.add_play_time(integer) to authenticated;
revoke all on function public.submit_level_records(jsonb) from public, anon;
grant execute on function public.submit_level_records(jsonb) to authenticated;
commit;
