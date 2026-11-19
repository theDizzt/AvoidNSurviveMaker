-- Crystal stars (#59): a level record also remembers whether the player has cleared the level
-- while carrying its crystal star. Apply after 20261119010000_achievements.sql.
--
-- Existing records are kept (crystal = false). submit_level_records() accepts an optional boolean
-- "crystal" per entry and merges it with OR: once earned, a crystal star is never lost. Its return
-- table gains a crystal column, so the function is dropped and created again (same grants).
-- Clients that send no "crystal" keep working; clients reading an older function see none.
begin;

alter table public.level_records
  add column crystal boolean not null default false;
comment on column public.level_records.crystal is
  'The level was cleared at least once while carrying its crystal star (#59).';

drop function if exists public.submit_level_records(jsonb);

-- Same as 20261118030000_records_always_verified.sql, plus the crystal flag.
create function public.submit_level_records(p_records jsonb)
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
    insert into public.level_records as r (user_id, level_key, best_ms, stars, crystal, verified)
      values (uid, record_key, ms::integer, star_count::smallint, coalesce(has_crystal, false), true)
    on conflict on constraint level_records_pkey do update
      set best_ms = least(r.best_ms, excluded.best_ms),
          stars = greatest(r.stars, excluded.stars),
          crystal = r.crystal or excluded.crystal,
          verified = true,
          updated_at = case
            when excluded.best_ms < r.best_ms or excluded.stars > r.stars or (excluded.crystal and not r.crystal) then now()
            else r.updated_at
          end;
  end loop;
  return query select r.level_key, r.best_ms, r.stars, r.crystal
    from public.level_records r where r.user_id = uid order by r.level_key limit 2000;
end;
$$;

revoke all on function public.submit_level_records(jsonb) from public, anon;
grant execute on function public.submit_level_records(jsonb) to authenticated;

commit;
