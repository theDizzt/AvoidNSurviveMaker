-- Player profiles: nickname + 4-digit discriminator ("Dizzt#3942").
--
-- Where each sign-up field lives:
--   auth.users (managed by Supabase Auth)
--     id                  UID (uuid)
--     email               email address
--     encrypted_password  bcrypt hash — the plain password is never stored
--     created_at          sign-up time (timestamptz, UTC)
--     email_confirmed_at  set when the verification link is clicked
--   public.profiles (this file)
--     id                  same UID as auth.users.id
--     nickname            up to 32 bytes (UTF-8)
--     discriminator       0001–9999, random at sign-up, unique per nickname
--     created_at          copy of the sign-up time (UTC)
--
-- Email and password hash stay in auth.users only: profiles are publicly readable
-- (so other players can see "Name#1234"), so they must not hold private data.

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  nickname      text not null,
  discriminator smallint not null,
  created_at    timestamptz not null default now(),

  constraint nickname_length check (octet_length(nickname) between 1 and 32),
  constraint nickname_trimmed check (nickname = btrim(nickname)),
  -- '#' would make "name#1234" ambiguous; control characters are never valid
  constraint nickname_chars check (nickname !~ '[#[:cntrl:]]'),
  constraint discriminator_range check (discriminator between 1 and 9999)
);

comment on table public.profiles is 'Public player profile. Display name is nickname#discriminator (zero-padded to 4 digits).';

-- A nickname+discriminator pair is unique. Case-insensitive, so "Dizzt#0001" and "dizzt#0001"
-- can't both exist (prevents look-alike impersonation). Also serves the free-number lookup below.
create unique index profiles_nickname_tag on public.profiles (lower(nickname), discriminator);

-- ───────────────────────── Row level security ─────────────────────────

alter table public.profiles enable row level security;

create policy "Profiles are readable by everyone"
  on public.profiles for select
  using (true);

-- No insert/update/delete policies: rows are only written by the trigger below
-- (security definer), so clients can't pick or change their own discriminator.

-- ───────────────────────── Sign-up trigger ─────────────────────────

-- Runs inside the same transaction as the auth.users insert. If it raises, the sign-up fails
-- and no half-created account is left behind.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nick text := btrim(coalesce(new.raw_user_meta_data ->> 'nickname', ''));
  disc smallint;
  attempt int := 0;
begin
  if octet_length(nick) not between 1 and 32 or nick ~ '[#[:cntrl:]]' then
    raise exception 'INVALID_NICKNAME' using errcode = 'P0001',
      hint = 'Nickname must be 1-32 bytes and must not contain "#".';
  end if;

  loop
    attempt := attempt + 1;

    -- Random pick among the numbers this nickname hasn't used yet
    select d::smallint into disc
      from generate_series(1, 9999) as d
     where not exists (
             select 1 from public.profiles p
              where lower(p.nickname) = lower(nick) and p.discriminator = d)
     order by random()
     limit 1;

    if disc is null then
      raise exception 'NICKNAME_FULL' using errcode = 'P0001',
        hint = 'All 9999 tags for this nickname are taken.';
    end if;

    begin
      insert into public.profiles (id, nickname, discriminator, created_at)
      values (new.id, nick, disc, new.created_at);
      return new;
    exception when unique_violation then
      -- Another sign-up grabbed the same number at the same moment: pick again
      if attempt >= 5 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Helpers for the client ─────────────────────────

-- How many tags are still free for a nickname, so the sign-up form can warn before submitting.
create or replace function public.nickname_slots_left(p_nickname text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select 9999 - count(*)::int
    from public.profiles
   where lower(nickname) = lower(btrim(p_nickname));
$$;

revoke all on function public.nickname_slots_left(text) from public;
grant execute on function public.nickname_slots_left(text) to anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
