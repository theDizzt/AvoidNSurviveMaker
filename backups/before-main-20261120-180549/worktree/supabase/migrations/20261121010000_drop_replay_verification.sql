-- The game is for fun: no server replay verification. Leaderboards rank the players' own
-- records (level_records) again. Apply after 20261121000000_achievement_int_ids.sql.
begin;

drop function if exists public.store_verified_record(uuid, text, integer, smallint, boolean);
drop function if exists public.claim_replay_verification(uuid);
drop table if exists public.verified_level_records;
drop table if exists public.replay_verification_limits;

comment on column public.level_records.verified is 'Legacy column, unused. Leaderboards rank every official record.';
drop index if exists public.level_records_leaderboard;
create index if not exists level_records_rank on public.level_records (level_key, best_ms, updated_at);

-- Top p_limit (1–50, default 10) records of an official level, plus the caller's own row when it
-- is ranked lower. Custom pack keys are never ranked (their ids aren't unique across packs).
create or replace function public.level_leaderboard(p_key text, p_limit integer default 10)
returns table (place bigint, nickname text, discriminator smallint, best_ms integer, stars smallint, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with ranked as (
    select r.user_id, r.best_ms, r.stars, r.updated_at, rank() over(order by r.best_ms) as place
    from public.level_records r
    where r.level_key = p_key and p_key !~ '^custom:'
  )
  select x.place, p.nickname, p.discriminator, x.best_ms, x.stars,
    coalesce(x.user_id = auth.uid(), false)
  from ranked x join public.profiles p on p.id = x.user_id
  where x.place <= least(greatest(coalesce(p_limit, 10), 1), 50) or x.user_id = auth.uid()
  order by x.place, x.updated_at, x.user_id limit 51;
$$;
revoke all on function public.level_leaderboard(text, integer) from public;
grant execute on function public.level_leaderboard(text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
