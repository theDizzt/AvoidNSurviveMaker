-- Store total play time in whole seconds instead of milliseconds.
-- Runs after 20261117010000_play_time.sql; existing totals are carried over (rounded down).
--
--   total_play_seconds   running total in seconds (source of truth)
--   play_time            same total as hours:minutes:seconds, e.g. 76:05:06

alter table public.profiles
  add column total_play_seconds bigint not null default 0
    constraint total_play_seconds_nonnegative check (total_play_seconds >= 0);

update public.profiles set total_play_seconds = total_play_ms / 1000;

-- play_time is generated from the old column, so it goes first
alter table public.profiles drop column play_time;
alter table public.profiles drop column total_play_ms;
alter table public.profiles
  add column play_time interval
    generated always as (total_play_seconds::double precision * interval '1 second') stored;

comment on column public.profiles.total_play_seconds is 'Total time the game has been open (tab visible), in seconds.';
comment on column public.profiles.play_time is 'total_play_seconds as hours:minutes:seconds.';

-- The parameter changes from milliseconds to seconds, so the function is replaced
drop function public.add_play_time(integer);

-- Adds play time (seconds) for the signed-in player and returns the new total (seconds).
--
-- Reports come from the browser, so they are capped server-side: a report can never add more
-- than the wall-clock time since the previous accepted report (+5 s grace for network delay),
-- and never more than 1 hour at once. Forged or repeated requests can't push the total past
-- real elapsed time, and several open tabs don't double count.
create function public.add_play_time(p_seconds integer)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  total bigint;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if p_seconds is null or p_seconds <= 0 then
    select p.total_play_seconds into total from public.profiles p where p.id = uid;
    return total;
  end if;

  update public.profiles p
     set total_play_seconds = p.total_play_seconds + least(
           p_seconds::bigint,
           3600,
           greatest(
             0,
             floor(extract(epoch from (now() - coalesce(p.last_play_report_at, now() - interval '1 hour'))))::bigint
           ) + 5
         ),
         last_play_report_at = now()
   where p.id = uid
  returning p.total_play_seconds into total;

  return total;
end;
$$;

revoke all on function public.add_play_time(integer) from public, anon;
grant execute on function public.add_play_time(integer) to authenticated;
