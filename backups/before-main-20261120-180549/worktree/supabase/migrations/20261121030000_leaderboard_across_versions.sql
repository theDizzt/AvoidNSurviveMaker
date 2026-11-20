-- Leaderboards count a level across all its record keys: the old slot keys ("workshop/14") and
-- every revision of the map ("workshop/14@<hash>"). Each player is ranked by their best time on
-- any of them, like the game carries records over map updates (src/web/progress.ts).
-- Apply after 20261121020000_drop_public_profiles.sql.
begin;

create index if not exists level_records_rank_base
  on public.level_records (split_part(level_key, '@', 1), best_ms);

create or replace function public.level_leaderboard(p_key text, p_limit integer default 10)
returns table (place bigint, nickname text, discriminator smallint, best_ms integer, stars smallint, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with best as (
    -- One row per player: their fastest record of this level, with the most stars they earned
    select distinct on (r.user_id) r.user_id, r.best_ms, r.updated_at,
      max(r.stars) over (partition by r.user_id) as stars
    from public.level_records r
    where split_part(r.level_key, '@', 1) = split_part(p_key, '@', 1) and p_key !~ '^custom:'
    order by r.user_id, r.best_ms, r.updated_at
  ), ranked as (
    select b.*, rank() over (order by b.best_ms) as place from best b
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
