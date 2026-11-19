-- The public_profiles view was never read by the game (leaderboards join profiles inside
-- level_leaderboard). Removed; it may already be gone (deleted in the dashboard).
-- Apply after 20261121010000_drop_replay_verification.sql.
begin;
drop view if exists public.public_profiles;
notify pgrst, 'reload schema';
commit;
