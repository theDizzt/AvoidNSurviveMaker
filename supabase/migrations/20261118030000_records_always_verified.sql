-- TEMPORARY: every level record counts as verified, so leaderboards show all records.
-- Apply after 20261118020000_leaderboard.sql.
--
-- There is no replay verifier yet, so this trusts browser submissions: a forged time WILL appear
-- on the leaderboard. To return to verified-only boards, add a trusted verifier and replace
-- submit_level_records() again with one that stores false (see docs/SECURITY.md).
begin;

alter table public.level_records alter column verified set default true;
update public.level_records set verified = true where not verified;
comment on column public.level_records.verified is
  'Temporarily always true (20261118030000_records_always_verified.sql): browser records are trusted until a replay verifier exists.';

-- Same as 20261118000000_security_hardening.sql, except every stored record is verified.
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
      values (uid, record_key, ms::integer, star_count::smallint, true)
    on conflict on constraint level_records_pkey do update
      set best_ms = least(r.best_ms, excluded.best_ms),
          stars = greatest(r.stars, excluded.stars),
          verified = true,
          updated_at = case when excluded.best_ms < r.best_ms or excluded.stars > r.stars then now() else r.updated_at end;
  end loop;
  return query select r.level_key, r.best_ms, r.stars
    from public.level_records r where r.user_id = uid order by r.level_key limit 2000;
end;
$$;

revoke all on function public.submit_level_records(jsonb) from public, anon;
grant execute on function public.submit_level_records(jsonb) to authenticated;

commit;
