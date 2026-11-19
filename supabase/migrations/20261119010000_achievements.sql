-- Personal achievements v1. Apply after the existing profile and level-record migrations.
-- Release target keys match src/core/achievements.ts; do not expand existing definitions.
begin;

create table public.achievement_definitions (
  id text primary key,
  kind text not null check (kind in ('clear', 'stars', 'perfect')),
  target integer not null check (target > 0),
  level_keys text[] not null check (cardinality(level_keys) > 0)
);
alter table public.achievement_definitions enable row level security;
revoke all on public.achievement_definitions from anon, authenticated;

with targets as (
  select array(select 'workshop/' || i from generate_series(0,20) i)
      || array(select 'desert/' || i from generate_series(0,9) i) as keys
), defs(id, kind, target) as (
  values ('clear.1','clear',1), ('clear.5','clear',5), ('clear.10','clear',10), ('clear.20','clear',20),
    ('stars.3','stars',3), ('stars.15','stars',15), ('stars.30','stars',30), ('stars.60','stars',60),
    ('perfect.1','perfect',1), ('perfect.5','perfect',5)
)
insert into public.achievement_definitions select id, kind, target, keys from defs cross join targets;
insert into public.achievement_definitions values
  ('chapter.workshop.clear.v1','clear',21,array(select 'workshop/' || i from generate_series(0,20) i)),
  ('chapter.desert.clear.v1','clear',10,array(select 'desert/' || i from generate_series(0,9) i));

create table public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievement_definitions(id),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.user_achievements enable row level security;
revoke all on public.user_achievements from anon, authenticated;
grant select on public.user_achievements to authenticated;
create policy "Read own achievements" on public.user_achievements for select to authenticated
  using ((select auth.uid()) = user_id);

create function public.refresh_achievements()
returns table (achievement_id text, unlocked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  insert into public.user_achievements (user_id, achievement_id)
  select uid, d.id from public.achievement_definitions d
  where (
    select coalesce(sum(case d.kind when 'stars' then least(3, greatest(0, r.stars))
      when 'perfect' then case when r.stars = 3 then 1 else 0 end else 1 end), 0)
    from public.level_records r
    where r.user_id = uid and r.level_key = any(d.level_keys) and r.best_ms > 0
  ) >= d.target
  on conflict on constraint user_achievements_pkey do nothing;
  return query select a.achievement_id, a.unlocked_at from public.user_achievements a where a.user_id = uid;
end;
$$;
revoke all on function public.refresh_achievements() from public, anon;
grant execute on function public.refresh_achievements() to authenticated;

-- Issue achievements in the same transaction as record writes, even if the client disconnects.
create function public.refresh_achievements_after_records()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then perform public.refresh_achievements(); end if;
  return null;
end;
$$;
revoke all on function public.refresh_achievements_after_records() from public, anon, authenticated;
create trigger refresh_achievements_after_records
after insert or update on public.level_records for each statement
execute function public.refresh_achievements_after_records();

commit;
