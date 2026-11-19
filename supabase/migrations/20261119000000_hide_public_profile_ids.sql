-- Apply after 20261118040000_public_profiles_invoker.sql.
-- Keep UUIDs for internal synchronization, but never expose them in the public directory.
begin;

revoke all on public.profile_directory from public, anon, authenticated;
grant select (nickname, discriminator) on public.profile_directory to anon, authenticated;

-- PostgreSQL cannot remove a view column with CREATE OR REPLACE VIEW.
-- Deliberately avoid CASCADE: unexpected dependents must stop this migration.
drop view public.public_profiles;
create view public.public_profiles
  with (security_invoker = true, security_barrier = true) as
  select nickname, discriminator from public.profile_directory;
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;
comment on view public.public_profiles is
  'Public player tags only. Account UUIDs are not part of this API.';

notify pgrst, 'reload schema';
commit;
