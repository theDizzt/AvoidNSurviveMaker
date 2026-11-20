-- Some official level files were copied with the same level id, so several levels shared one
-- record key. Once 20261121040000_unversioned_level_keys.sql dropped the "@<content hash>" suffix
-- that had kept them apart, every level of chapter 3 showed the same time and leaderboard.
--
-- Those levels now have ids "level − 1" like the other chapters: chapter 3 "wood/0"…"wood/6",
-- chapter 2 levels 11–13 "desert/10"…"desert/12". The records under the shared keys move to the
-- level they mostly belong to: "wood/5" was chapter 3 level 1's key while it was the only level
-- of the chapter ("wood/0" now), and the chapter 2 key goes to level 11 ("desert/10"). They can't
-- be split any further: the merge kept only each player's best time.
-- The game moves them in browser saves too (SHARED_LEVEL_KEYS in src/core/record-identity.ts).
-- Apply once, together with the game update (before players sync): "wood/5" is level 6's key now.
-- Safe to run again if a run stopped partway (keys already moved are simply not found).
-- Apply after 20261121040000_unversioned_level_keys.sql.
begin;

-- Records: keep the better of the moved record and any already under the new key
insert into public.level_records as r (user_id, level_key, best_ms, stars, crystal, verified, created_at, updated_at)
select l.user_id, k.to_key, l.best_ms, l.stars, l.crystal, false, l.created_at, l.updated_at
from public.level_records l
join (values ('wood/5', 'wood/0'), ('desert/74030fc3f293a41f1025f88e725018ff', 'desert/10')) as k(from_key, to_key)
  on l.level_key = k.from_key
on conflict on constraint level_records_pkey do update set
  best_ms = least(r.best_ms, excluded.best_ms),
  stars = greatest(r.stars, excluded.stars),
  crystal = r.crystal or excluded.crystal,
  created_at = least(r.created_at, excluded.created_at),
  updated_at = greatest(r.updated_at, excluded.updated_at);

delete from public.level_records
where level_key in ('wood/5', 'desert/74030fc3f293a41f1025f88e725018ff');

-- Deaths: add them up
insert into public.level_deaths as d (user_id, level_key, deaths, updated_at)
select l.user_id, k.to_key, l.deaths, l.updated_at
from public.level_deaths l
join (values ('wood/5', 'wood/0'), ('desert/74030fc3f293a41f1025f88e725018ff', 'desert/10')) as k(from_key, to_key)
  on l.level_key = k.from_key
on conflict on constraint level_deaths_pkey do update set
  deaths = d.deaths + excluded.deaths,
  updated_at = greatest(d.updated_at, excluded.updated_at);

delete from public.level_deaths
where level_key in ('wood/5', 'desert/74030fc3f293a41f1025f88e725018ff');

commit;
