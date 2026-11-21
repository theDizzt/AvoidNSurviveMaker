-- Chapter 3 level 1 records kept coming back under "wood/5" (level 6's key since
-- 20261121050000_split_shared_level_keys.sql): browsers that had downloaded the old "wood/5" row
-- before that migration ran, queued uploads, and older clients still send it on every sync.
--
-- A "wood/5" record faster than 3 s can't be a level 6 clear (its 3-star time is 7.5 s); it is
-- level 1's (3-star time 1 s). Such rows move to "wood/0", and submit_level_records files them
-- there from now on. The game does the same (SHARED_LEVEL_KEYS in src/core/record-identity.ts).
-- Safe to run again. Apply after 20261121050000_split_shared_level_keys.sql.
begin;

insert into public.level_records as r (user_id, level_key, best_ms, stars, crystal, verified, created_at, updated_at)
select l.user_id, 'wood/0', l.best_ms, l.stars, l.crystal, false, l.created_at, l.updated_at
from public.level_records l
where l.level_key = 'wood/5' and l.best_ms < 3000
on conflict on constraint level_records_pkey do update set
  best_ms = least(r.best_ms, excluded.best_ms),
  stars = greatest(r.stars, excluded.stars),
  crystal = r.crystal or excluded.crystal,
  created_at = least(r.created_at, excluded.created_at),
  updated_at = greatest(r.updated_at, excluded.updated_at);

delete from public.level_records where level_key = 'wood/5' and best_ms < 3000;

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
    -- Keys several levels once shared (see the header and 20261121050000)
    if record_key = 'desert/74030fc3f293a41f1025f88e725018ff' then record_key := 'desert/10';
    elsif record_key = 'wood/5' and ms < 3000 then record_key := 'wood/0';
    end if;
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

commit;
