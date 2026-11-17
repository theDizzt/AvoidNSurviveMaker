-- Best record per player per level.
--
--   level_key   level id as the game keys its progress: '<theme id>/<level index>' for chapters,
--               'custom:<theme id>/<level index>' for custom theme packs
--   best_ms     best clear time in whole milliseconds
--   stars       most stars earned on the level (0–3)
--
-- Players read only their own rows. Writes go through submit_level_records(), which merges so a
-- record can only improve: best_ms keeps the lowest value and stars the highest.

create table public.level_records (
  user_id     uuid not null references auth.users (id) on delete cascade,
  level_key   text not null constraint level_key_length check (char_length(level_key) between 1 and 200),
  best_ms     integer not null constraint best_ms_positive check (best_ms > 0),
  stars       smallint not null constraint stars_range check (stars between 0 and 3),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, level_key)
);

comment on table public.level_records is 'Best clear time (ms) and most stars per player per level.';

alter table public.level_records enable row level security;

create policy "Players read their own level records"
  on public.level_records for select
  to authenticated
  using (user_id = auth.uid());

-- Merge records for the signed-in player and return all of their records.
-- p_records: [{"key": "workshop/0", "best_ms": 12345, "stars": 3}, ...] (at most 2000 entries).
-- Invalid entries are skipped.
create function public.submit_level_records(p_records jsonb)
returns table (level_key text, best_ms integer, stars smallint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_records is not null and jsonb_typeof(p_records) <> 'array' then
    raise exception 'INVALID_RECORDS' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_records, '[]'::jsonb)) > 2000 then
    raise exception 'TOO_MANY_RECORDS' using errcode = '22023';
  end if;

  insert into public.level_records as r (user_id, level_key, best_ms, stars)
  select uid, e.k, min(e.ms), max(e.st)
    from (
      select x->>'key' as k,
             floor((x->>'best_ms')::numeric)::integer as ms,
             (x->>'stars')::numeric::smallint as st
        from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) as x
       where jsonb_typeof(x) = 'object'
         and jsonb_typeof(x->'key') = 'string'
         and char_length(x->>'key') between 1 and 200
         and jsonb_typeof(x->'best_ms') = 'number'
         and (x->>'best_ms')::numeric between 1 and 2147483647
         and jsonb_typeof(x->'stars') = 'number'
         and (x->>'stars')::numeric in (0, 1, 2, 3)
    ) as e
   group by e.k
  on conflict on constraint level_records_pkey do update
     set best_ms = least(r.best_ms, excluded.best_ms),
         stars = greatest(r.stars, excluded.stars),
         updated_at = case
           when excluded.best_ms < r.best_ms or excluded.stars > r.stars then now()
           else r.updated_at
         end;

  return query
    select r.level_key, r.best_ms, r.stars
      from public.level_records r
     where r.user_id = uid;
end;
$$;

revoke all on function public.submit_level_records(jsonb) from public, anon;
grant execute on function public.submit_level_records(jsonb) to authenticated;
