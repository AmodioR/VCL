-- VCL tournament core
-- Run once in Supabase SQL Editor before testing the tournament admin tools.

create extension if not exists pgcrypto;

create or replace function public.is_vcl_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

grant execute on function public.is_vcl_admin() to anon, authenticated;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  series_slug text not null check (series_slug in ('academy', 'contender', 'championship', 'community')),
  status text not null default 'draft' check (status in ('draft', 'open', 'checkin', 'live', 'completed', 'archived')),
  description text not null default '',
  map_order text not null default 'HP · SND · OL · HP · SND',
  bracket_type text not null default 'single_elimination' check (bracket_type in ('single_elimination')),
  max_teams integer not null default 16 check (max_teams between 2 and 64),
  starts_at timestamptz,
  signup_opens_at timestamptz,
  signup_closes_at timestamptz,
  checkin_opens_at timestamptz,
  checkin_closes_at timestamptz,
  rules_url text,
  points_schema jsonb not null default '{"1":100,"2":70,"3":50,"4":35}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.team_signups
  add column if not exists tournament_id uuid references public.tournaments(id) on delete set null,
  add column if not exists tournament_slug text,
  add column if not exists tournament_label text,
  add column if not exists discord_confirmed boolean not null default false,
  add column if not exists checkin_confirmed boolean not null default false,
  add column if not exists approved_team_id uuid references public.teams(id) on delete set null;

create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  signup_id uuid references public.team_signups(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  team_name_snapshot text not null,
  team_slug_snapshot text,
  logo_url_snapshot text,
  seed integer check (seed is null or seed between 1 and 64),
  status text not null default 'approved' check (status in ('approved', 'checked_in', 'withdrawn', 'disqualified')),
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (signup_id),
  unique (tournament_id, team_id)
);

create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_number integer not null check (round_number >= 1),
  match_number integer not null check (match_number >= 1),
  round_label text,
  team_a_id uuid references public.teams(id) on delete set null,
  team_b_id uuid references public.teams(id) on delete set null,
  team_a_score integer check (team_a_score is null or team_a_score >= 0),
  team_b_score integer check (team_b_score is null or team_b_score >= 0),
  winner_team_id uuid references public.teams(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'ready', 'live', 'completed', 'cancelled')),
  scheduled_at timestamptz,
  twitch_url text,
  next_match_id uuid references public.tournament_matches(id) on delete set null,
  next_match_slot text check (next_match_slot is null or next_match_slot in ('a', 'b')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, round_number, match_number)
);

create index if not exists tournaments_status_starts_idx
  on public.tournaments(status, starts_at);
create index if not exists tournament_entries_tournament_idx
  on public.tournament_entries(tournament_id, status, seed);
create index if not exists tournament_matches_tournament_idx
  on public.tournament_matches(tournament_id, round_number, match_number);
create index if not exists team_signups_tournament_idx
  on public.team_signups(tournament_id, status);

create or replace function public.vcl_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tournaments_set_updated_at on public.tournaments;
create trigger tournaments_set_updated_at
before update on public.tournaments
for each row execute function public.vcl_set_updated_at();

drop trigger if exists tournament_entries_set_updated_at on public.tournament_entries;
create trigger tournament_entries_set_updated_at
before update on public.tournament_entries
for each row execute function public.vcl_set_updated_at();

drop trigger if exists tournament_matches_set_updated_at on public.tournament_matches;
create trigger tournament_matches_set_updated_at
before update on public.tournament_matches
for each row execute function public.vcl_set_updated_at();

create or replace function public.sync_approved_signup_to_tournament_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams%rowtype;
begin
  if new.tournament_id is null then
    return new;
  end if;

  if new.approved_team_id is not null then
    select * into v_team
    from public.teams
    where id = new.approved_team_id;
  end if;

  if new.status = 'approved' then
    insert into public.tournament_entries (
      tournament_id,
      signup_id,
      team_id,
      team_name_snapshot,
      team_slug_snapshot,
      logo_url_snapshot,
      status
    )
    values (
      new.tournament_id,
      new.id,
      new.approved_team_id,
      coalesce(v_team.name, new.team_name, 'Ukendt hold'),
      v_team.slug,
      coalesce(v_team.logo_url, new.logo_url),
      'approved'
    )
    on conflict (signup_id) do update set
      tournament_id = excluded.tournament_id,
      team_id = excluded.team_id,
      team_name_snapshot = excluded.team_name_snapshot,
      team_slug_snapshot = excluded.team_slug_snapshot,
      logo_url_snapshot = excluded.logo_url_snapshot,
      status = case
        when public.tournament_entries.status = 'checked_in' then 'checked_in'
        else 'approved'
      end,
      updated_at = now();
  elsif new.status = 'rejected' then
    update public.tournament_entries
    set status = 'withdrawn', updated_at = now()
    where signup_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists team_signup_tournament_entry_sync on public.team_signups;
create trigger team_signup_tournament_entry_sync
after insert or update of status, tournament_id, approved_team_id, team_name, logo_url
on public.team_signups
for each row execute function public.sync_approved_signup_to_tournament_entry();

-- Backfill already approved signups that have a tournament attached.
insert into public.tournament_entries (
  tournament_id,
  signup_id,
  team_id,
  team_name_snapshot,
  team_slug_snapshot,
  logo_url_snapshot,
  status
)
select
  ts.tournament_id,
  ts.id,
  ts.approved_team_id,
  coalesce(t.name, ts.team_name, 'Ukendt hold'),
  t.slug,
  coalesce(t.logo_url, ts.logo_url),
  'approved'
from public.team_signups ts
left join public.teams t on t.id = ts.approved_team_id
where ts.status = 'approved'
  and ts.tournament_id is not null
on conflict do nothing;

create or replace function public.sync_tournament_match_winner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.winner_team_id is not null
     and new.winner_team_id is distinct from new.team_a_id
     and new.winner_team_id is distinct from new.team_b_id then
    raise exception 'Vinderen skal være et af holdene i kampen.';
  end if;

  if tg_op = 'UPDATE'
     and old.winner_team_id is distinct from new.winner_team_id
     and old.next_match_id is not null then
    if old.next_match_slot = 'a' then
      update public.tournament_matches
      set team_a_id = null
      where id = old.next_match_id
        and team_a_id = old.winner_team_id;
    elsif old.next_match_slot = 'b' then
      update public.tournament_matches
      set team_b_id = null
      where id = old.next_match_id
        and team_b_id = old.winner_team_id;
    end if;
  end if;

  if new.winner_team_id is not null and new.next_match_id is not null then
    if new.next_match_slot = 'a' then
      update public.tournament_matches
      set team_a_id = new.winner_team_id
      where id = new.next_match_id;
    elsif new.next_match_slot = 'b' then
      update public.tournament_matches
      set team_b_id = new.winner_team_id
      where id = new.next_match_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tournament_match_winner_sync on public.tournament_matches;
create trigger tournament_match_winner_sync
after insert or update of winner_team_id, next_match_id, next_match_slot
on public.tournament_matches
for each row execute function public.sync_tournament_match_winner();

alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_matches enable row level security;

drop policy if exists "Public can read published tournaments" on public.tournaments;
create policy "Public can read published tournaments"
on public.tournaments for select
to anon, authenticated
using (status <> 'draft' or public.is_vcl_admin());

drop policy if exists "Admins manage tournaments" on public.tournaments;
create policy "Admins manage tournaments"
on public.tournaments for all
to authenticated
using (public.is_vcl_admin())
with check (public.is_vcl_admin());

drop policy if exists "Public can read active tournament entries" on public.tournament_entries;
create policy "Public can read active tournament entries"
on public.tournament_entries for select
to anon, authenticated
using (
  status in ('approved', 'checked_in')
  and exists (
    select 1 from public.tournaments t
    where t.id = tournament_id
      and (t.status <> 'draft' or public.is_vcl_admin())
  )
);

drop policy if exists "Admins manage tournament entries" on public.tournament_entries;
create policy "Admins manage tournament entries"
on public.tournament_entries for all
to authenticated
using (public.is_vcl_admin())
with check (public.is_vcl_admin());

drop policy if exists "Public can read tournament matches" on public.tournament_matches;
create policy "Public can read tournament matches"
on public.tournament_matches for select
to anon, authenticated
using (
  exists (
    select 1 from public.tournaments t
    where t.id = tournament_id
      and (t.status <> 'draft' or public.is_vcl_admin())
  )
);

drop policy if exists "Admins manage tournament matches" on public.tournament_matches;
create policy "Admins manage tournament matches"
on public.tournament_matches for all
to authenticated
using (public.is_vcl_admin())
with check (public.is_vcl_admin());

create or replace view public.public_tournaments_view
with (security_invoker = true)
as
select
  t.*,
  count(distinct e.id) filter (where e.status in ('approved', 'checked_in'))::integer as approved_team_count,
  count(distinct e.id) filter (where e.status = 'checked_in')::integer as checked_in_team_count,
  count(distinct m.id) filter (where m.status = 'live')::integer as live_match_count
from public.tournaments t
left join public.tournament_entries e on e.tournament_id = t.id
left join public.tournament_matches m on m.tournament_id = t.id
group by t.id;

create or replace view public.public_tournament_entries_view
with (security_invoker = true)
as
select
  e.id,
  e.tournament_id,
  e.signup_id,
  e.team_id,
  e.team_name_snapshot as team_name,
  e.team_slug_snapshot as team_slug,
  coalesce(e.logo_url_snapshot, t.logo_url) as logo_url,
  e.seed,
  e.status,
  e.checked_in_at,
  e.created_at
from public.tournament_entries e
left join public.teams t on t.id = e.team_id
where e.status in ('approved', 'checked_in');

create or replace view public.public_tournament_matches_view
with (security_invoker = true)
as
select
  m.*,
  ta.name as team_a_name,
  ta.slug as team_a_slug,
  ta.logo_url as team_a_logo_url,
  tb.name as team_b_name,
  tb.slug as team_b_slug,
  tb.logo_url as team_b_logo_url,
  tw.name as winner_team_name,
  tw.slug as winner_team_slug
from public.tournament_matches m
left join public.teams ta on ta.id = m.team_a_id
left join public.teams tb on tb.id = m.team_b_id
left join public.teams tw on tw.id = m.winner_team_id;

grant select on public.public_tournaments_view to anon, authenticated;
grant select on public.public_tournament_entries_view to anon, authenticated;
grant select on public.public_tournament_matches_view to anon, authenticated;

grant select, insert, update, delete on public.tournaments to authenticated;
grant select, insert, update, delete on public.tournament_entries to authenticated;
grant select, insert, update, delete on public.tournament_matches to authenticated;

create or replace function public.admin_generate_single_elimination_bracket(p_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_ids uuid[];
  v_team_count integer;
  v_bracket_size integer := 2;
  v_round_count integer := 1;
  v_round integer;
  v_match integer;
  v_match_count integer;
  v_seed_order integer[] := array[1, 2];
  v_next_seed_order integer[];
  v_current_size integer := 4;
  v_seed integer;
  v_seed_a integer;
  v_seed_b integer;
  v_team_a uuid;
  v_team_b uuid;
  v_existing_locked integer;
begin
  if not public.is_vcl_admin() then
    raise exception 'Kun admins kan generere bracket.';
  end if;

  select count(*) into v_existing_locked
  from public.tournament_matches
  where tournament_id = p_tournament_id
    and status in ('live', 'completed');

  if v_existing_locked > 0 then
    raise exception 'Bracketen har live eller afsluttede kampe og kan ikke regenereres.';
  end if;

  select array_agg(team_id order by seed nulls last, created_at, id)
  into v_team_ids
  from public.tournament_entries
  where tournament_id = p_tournament_id
    and status in ('approved', 'checked_in')
    and team_id is not null;

  v_team_count := coalesce(array_length(v_team_ids, 1), 0);

  if v_team_count < 2 then
    raise exception 'Der skal være mindst 2 godkendte hold med et oprettet team.';
  end if;

  while v_bracket_size < v_team_count loop
    v_bracket_size := v_bracket_size * 2;
    v_round_count := v_round_count + 1;
  end loop;

  while v_current_size <= v_bracket_size loop
    v_next_seed_order := array[]::integer[];
    foreach v_seed in array v_seed_order loop
      v_next_seed_order := array_append(v_next_seed_order, v_seed);
      v_next_seed_order := array_append(v_next_seed_order, v_current_size + 1 - v_seed);
    end loop;
    v_seed_order := v_next_seed_order;
    v_current_size := v_current_size * 2;
  end loop;

  delete from public.tournament_matches
  where tournament_id = p_tournament_id;

  for v_round in 1..v_round_count loop
    v_match_count := v_bracket_size / power(2, v_round)::integer;

    for v_match in 1..v_match_count loop
      insert into public.tournament_matches (
        tournament_id,
        round_number,
        match_number,
        round_label,
        status
      )
      values (
        p_tournament_id,
        v_round,
        v_match,
        case
          when v_round = v_round_count then 'Finale'
          when v_round = v_round_count - 1 then 'Semifinale'
          when v_round = v_round_count - 2 then 'Kvartfinale'
          else 'Runde ' || v_round
        end,
        'scheduled'
      );
    end loop;
  end loop;

  update public.tournament_matches current_match
  set
    next_match_id = next_match.id,
    next_match_slot = case when current_match.match_number % 2 = 1 then 'a' else 'b' end
  from public.tournament_matches next_match
  where current_match.tournament_id = p_tournament_id
    and next_match.tournament_id = p_tournament_id
    and next_match.round_number = current_match.round_number + 1
    and next_match.match_number = ceil(current_match.match_number / 2.0)
    and current_match.round_number < v_round_count;

  v_match_count := v_bracket_size / 2;

  for v_match in 1..v_match_count loop
    v_seed_a := v_seed_order[(v_match * 2) - 1];
    v_seed_b := v_seed_order[v_match * 2];

    v_team_a := case when v_seed_a <= v_team_count then v_team_ids[v_seed_a] else null end;
    v_team_b := case when v_seed_b <= v_team_count then v_team_ids[v_seed_b] else null end;

    update public.tournament_matches
    set
      team_a_id = v_team_a,
      team_b_id = v_team_b
    where tournament_id = p_tournament_id
      and round_number = 1
      and match_number = v_match;
  end loop;

  update public.tournament_matches
  set
    status = 'completed',
    winner_team_id = coalesce(team_a_id, team_b_id),
    team_a_score = case when team_a_id is not null then 1 else 0 end,
    team_b_score = case when team_b_id is not null then 1 else 0 end
  where tournament_id = p_tournament_id
    and round_number = 1
    and ((team_a_id is null) <> (team_b_id is null));

  return jsonb_build_object(
    'tournament_id', p_tournament_id,
    'team_count', v_team_count,
    'bracket_size', v_bracket_size,
    'round_count', v_round_count
  );
end;
$$;

grant execute on function public.admin_generate_single_elimination_bracket(uuid) to authenticated;
