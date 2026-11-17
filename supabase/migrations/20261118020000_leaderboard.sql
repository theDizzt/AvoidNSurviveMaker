-- Per-level leaderboard of VERIFIED records only.
-- Apply after 20261118010000_deaths.sql.
--
-- Browser submissions are never verified (see 20261118000000_security_hardening.sql and
-- docs/SECURITY.md), so a leaderboard stays empty until a trusted replay verifier sets
-- level_records.verified = true. Unverified rows are never ranked or returned.
--
-- Official chapter levels only ('<theme id>/<level index>'): custom pack ids aren't unique, so two
-- different packs could share a key.
begin;

create index level_records_leaderboard
  on public.level_records (level_key, best_ms, updated_at)
  where verified;

-- Top p_limit (1–50, default 10) verified records of a level, plus the caller's own row when it
-- is ranked lower. Equal times share a place; the earlier record is listed first.
-- Readable by everyone (signed in or not); exposes only the public tag, time and stars.
create function public.level_leaderboard(p_key text, p_limit integer default 10)
returns table (place bigint, nickname text, discriminator smallint, best_ms integer, stars smallint, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select r.user_id, r.best_ms, r.stars, r.updated_at,
           rank() over (order by r.best_ms) as place
      from public.level_records r
     where r.verified
       and r.level_key = p_key
       and p_key ~ '^[A-Za-z0-9_-]{1,60}/(0|[1-9][0-9]{0,2})$'
  )
  select x.place, p.nickname, p.discriminator, x.best_ms, x.stars,
         coalesce(x.user_id = auth.uid(), false) as is_me
    from ranked x
    join public.profiles p on p.id = x.user_id
   where x.place <= least(greatest(coalesce(p_limit, 10), 1), 50)
      or x.user_id = auth.uid()
   order by x.place, x.updated_at
   limit 51;
$$;

revoke all on function public.level_leaderboard(text, integer) from public;
grant execute on function public.level_leaderboard(text, integer) to anon, authenticated;

commit;
