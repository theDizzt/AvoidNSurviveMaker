-- Total play time per player.
--
-- "Play time" = total time the game is open (signed in, tab visible), summed over all sessions.
-- The client reports the counted time every 30 s and when the tab is hidden, via add_play_time(ms).
--
--   total_play_ms        running total in milliseconds (source of truth)
--   play_time            same total as an interval, e.g. 76:05:06 (hours:minutes:seconds),
--                        readable in the Table Editor and in SQL
--   last_play_report_at  when the last report was accepted (used to cap reports, see below)

alter table public.profiles
  add column total_play_ms bigint not null default 0
    constraint total_play_ms_nonnegative check (total_play_ms >= 0),
  add column play_time interval
    generated always as (((total_play_ms / 1000)::double precision) * interval '1 second') stored,
  add column last_play_report_at timestamptz;

comment on column public.profiles.total_play_ms is 'Total time the game has been open (tab visible), in milliseconds.';
comment on column public.profiles.play_time is 'total_play_ms as hours:minutes:seconds.';

-- Adds play time for the signed-in player and returns the new total (ms).
--
-- Reports come from the browser, so they are capped server-side: a report can never add more
-- than the wall-clock time that has passed since the previous accepted report (+5 s grace for
-- network delay), and never more than 1 hour at once. Replaying or forging requests therefore
-- can't push the total beyond real elapsed time.
create or replace function public.add_play_time(p_ms integer)
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

  if p_ms is null or p_ms <= 0 then
    select p.total_play_ms into total from public.profiles p where p.id = uid;
    return total;
  end if;

  update public.profiles p
     set total_play_ms = p.total_play_ms + least(
           p_ms::bigint,
           3600000,
           greatest(
             0,
             floor(extract(epoch from (now() - coalesce(p.last_play_report_at, now() - interval '1 hour'))) * 1000)::bigint
           ) + 5000
         ),
         last_play_report_at = now()
   where p.id = uid
  returning p.total_play_ms into total;

  return total;
end;
$$;

revoke all on function public.add_play_time(integer) from public, anon;
grant execute on function public.add_play_time(integer) to authenticated;
