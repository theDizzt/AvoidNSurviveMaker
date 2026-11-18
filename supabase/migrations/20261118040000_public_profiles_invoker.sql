-- Apply after the existing migrations. Requires PostgreSQL 15+.
-- Keep private profiles owner-only while preserving the public_profiles API.
begin;

-- Prevent profile writes between the initial copy and trigger installation.
lock table public.profiles in share row exclusive mode;

create table public.profile_directory (
  id uuid primary key references public.profiles (id) on update cascade on delete cascade,
  nickname text not null,
  discriminator smallint not null
);
comment on table public.profile_directory is
  'Public identity only. Maintained by a profiles trigger; never add private activity fields.';
alter table public.profile_directory enable row level security;
revoke all on public.profile_directory from public, anon, authenticated;
grant select on public.profile_directory to anon, authenticated;
create policy "Public identities are readable by everyone"
  on public.profile_directory for select to anon, authenticated using (true);

insert into public.profile_directory (id, nickname, discriminator)
  select id, nickname, discriminator from public.profiles;

create function public.sync_profile_directory()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profile_directory (id, nickname, discriminator)
    values (new.id, new.nickname, new.discriminator)
    on conflict (id) do update
      set nickname = excluded.nickname, discriminator = excluded.discriminator;
  return new;
end;
$$;
-- Only the trigger may invoke this function; it is not a public RPC.
revoke all on function public.sync_profile_directory() from public, anon, authenticated;
create trigger sync_public_profile_identity
  after insert or update of id, nickname, discriminator on public.profiles
  for each row execute function public.sync_profile_directory();

create or replace view public.public_profiles
  with (security_invoker = true, security_barrier = true) as
  select id, nickname, discriminator from public.profile_directory;
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

commit;
