-- Achievements v2: integer ids from 1 and no definitions table. Apply after
-- 20261120010000_verified_replays.sql. The rules live inside refresh_achievements() and must
-- match src/core/achievements.ts; never renumber an id or change its goal.
begin;

-- The v1 achievements are replaced by a new list, so their unlocks don't carry over.
-- refresh_achievements() re-issues the new ones from the player's records.
delete from public.user_achievements;
alter table public.user_achievements drop constraint if exists user_achievements_achievement_id_fkey;
alter table public.user_achievements drop constraint user_achievements_pkey;
alter table public.user_achievements drop column achievement_id;
alter table public.user_achievements add column achievement_id integer not null
  check (achievement_id between 1 and 16);
alter table public.user_achievements add constraint user_achievements_pkey primary key (user_id, achievement_id);

-- if exists: safe to re-run
drop table if exists public.achievement_definitions cascade;

-- The return type changes, so the function is recreated (the record trigger calls it by name)
drop function public.refresh_achievements();
create function public.refresh_achievements()
returns table (achievement_id integer, unlocked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  -- Official chapters (theme ids) in order, 21 levels each
  chapters text[] := array['workshop', 'desert', 'wood', 'botany', 'frost', 'factory', 'sky', 'magma',
    'optics', 'ocean', 'cavern', 'galaxy', 'chapter-13', 'chapter-14', 'cyberfunk', 'chapter-16'];
  all_levels text[] := array(select c || '/' || i from unnest(chapters) c cross join generate_series(0, 20) i);
  chapter1 text[] := array(select 'workshop/' || i from generate_series(0, 20) i);
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  insert into public.user_achievements (user_id, achievement_id)
  select uid, d.id from (values
      -- Stars over every official level (best stars 0–3 plus 1 per crystal star)
      (1, 'stars', 16, all_levels, null::integer), (2, 'stars', 66, all_levels, null),
      (3, 'stars', 132, all_levels, null), (4, 'stars', 264, all_levels, null),
      (5, 'stars', 339, all_levels, null), (6, 'stars', 420, all_levels, null),
      (7, 'stars', 528, all_levels, null), (8, 'stars', 666, all_levels, null),
      (9, 'stars', 777, all_levels, null), (10, 'stars', 884, all_levels, null),
      (11, 'stars', 1056, all_levels, null),
      -- 12 (Discord visit) is issued by claim_discord_achievement()
      (13, 'stars', 33, chapter1, null),
      -- A clear of one level at or under the time
      (14, 'time', 1, array['workshop/0'], 35), (15, 'time', 1, array['workshop/1'], 61),
      (16, 'stars', 66, chapter1, null)
    ) as d(id, kind, target, level_keys, max_ms)
  where (
    select coalesce(sum(case d.kind
      when 'stars' then least(3, greatest(0, r.stars)) + case when r.crystal then 1 else 0 end
      else case when r.best_ms <= d.max_ms then 1 else 0 end end), 0)
    from (select split_part(level_key, '@', 1) as level_key, max(stars) as stars,
        min(best_ms) as best_ms, bool_or(crystal) as crystal
      from public.level_records where user_id = uid group by split_part(level_key, '@', 1)) r
    where r.level_key = any(d.level_keys) and r.best_ms > 0
  ) >= d.target
  on conflict on constraint user_achievements_pkey do nothing;
  return query select a.achievement_id, a.unlocked_at from public.user_achievements a where a.user_id = uid;
end;
$$;
revoke all on function public.refresh_achievements() from public, anon;
grant execute on function public.refresh_achievements() to authenticated;

-- Achievement 12: the player opened the Discord invite. There is nothing to verify; the reward
-- is cosmetic, so the client's word is enough.
create function public.claim_discord_achievement()
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  insert into public.user_achievements (user_id, achievement_id) values (uid, 12)
  on conflict on constraint user_achievements_pkey do nothing;
end;
$$;
revoke all on function public.claim_discord_achievement() from public, anon;
grant execute on function public.claim_discord_achievement() to authenticated;

notify pgrst, 'reload schema';
commit;
