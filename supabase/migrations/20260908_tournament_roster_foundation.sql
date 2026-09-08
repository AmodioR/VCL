-- VCL tournament roster foundation
-- Adds explicit starters/substitutes to tournament registration while preserving
-- the existing tournament-entry approval flow.
--
-- Phase covered here:
--   - captain confirms a tournament-specific roster
--   - exactly N starters (default 4)
--   - up to N substitutes (default 2)
--   - roster is stored as a historical snapshot on the tournament entry
--   - captains may edit while the tournament is open and before roster lock
--
-- Future loan / stand-in rows can use the same tournament_roster_players table
-- with source = loan_team or loan_free_agent.

begin;

-- ============================================================
-- Tournament roster rules
-- ============================================================

alter table public.tournaments
  add column if not exists required_starters integer not null default 4,
  add column if not exists max_substitutes integer not null default 2;

alter table public.tournaments
  drop constraint if exists tournaments_required_starters_check;

alter table public.tournaments
  add constraint tournaments_required_starters_check
  check (required_starters between 1 and 8);

alter table public.tournaments
  drop constraint if exists tournaments_max_substitutes_check;

alter table public.tournaments
  add constraint tournaments_max_substitutes_check
  check (max_substitutes between 0 and 8);

-- The live tournament-entry flow already uses pending/rejected states. Keep the
-- canonical constraint in the repository so fresh environments match production.
alter table public.tournament_entries
  drop constraint if exists tournament_entries_status_check;

alter table public.tournament_entries
  add constraint tournament_entries_status_check
  check (
    status in (
      'pending',
      'approved',
      'checked_in',
      'rejected',
      'withdrawn',
      'disqualified'
    )
  );

alter table public.tournament_entries
  add column if not exists roster_confirmed_at timestamptz,
  add column if not exists roster_locked_at timestamptz,
  add column if not exists roster_version integer not null default 0;

-- ============================================================
-- Tournament-specific roster snapshot
-- ============================================================

create table if not exists public.tournament_roster_players (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.tournament_entries(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  role text not null,
  source text not null default 'team',
  home_team_id uuid references public.teams(id) on delete set null,
  replaces_player_id uuid references public.players(id) on delete set null,

  -- Snapshot fields make historical lineups stable even after profile changes.
  player_alias_snapshot text not null,
  player_slug_snapshot text,
  player_avatar_url_snapshot text,
  primary_role_snapshot text,

  created_at timestamptz not null default now(),

  constraint tournament_roster_players_role_check
    check (role in ('starter', 'substitute')),

  constraint tournament_roster_players_source_check
    check (source in ('team', 'loan_team', 'loan_free_agent')),

  unique (entry_id, player_id)
);

create index if not exists tournament_roster_players_entry_idx
  on public.tournament_roster_players (entry_id, role, created_at);

create index if not exists tournament_roster_players_player_idx
  on public.tournament_roster_players (player_id, created_at desc);

alter table public.tournament_roster_players enable row level security;

drop policy if exists "Public can read approved tournament rosters"
on public.tournament_roster_players;

create policy "Public can read approved tournament rosters"
on public.tournament_roster_players
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.tournament_entries e
    join public.tournaments t on t.id = e.tournament_id
    where e.id = entry_id
      and e.status in ('approved', 'checked_in')
      and (t.status <> 'draft' or public.is_vcl_admin())
  )
);

drop policy if exists "Admins manage tournament rosters"
on public.tournament_roster_players;

create policy "Admins manage tournament rosters"
on public.tournament_roster_players
for all
to authenticated
using (public.is_vcl_admin())
with check (public.is_vcl_admin());

revoke all on public.tournament_roster_players from anon, authenticated;
grant select on public.tournament_roster_players to anon, authenticated;
grant select, insert, update, delete on public.tournament_roster_players to authenticated;

-- ============================================================
-- Public approved-roster view
-- ============================================================

create or replace view public.public_tournament_roster_view
with (security_invoker = true)
as
select
  rp.id,
  e.id as entry_id,
  e.tournament_id,
  e.team_id,
  e.team_name_snapshot as team_name,
  e.team_slug_snapshot as team_slug,
  rp.player_id,
  rp.player_alias_snapshot as player_alias,
  rp.player_slug_snapshot as player_slug,
  rp.player_avatar_url_snapshot as player_avatar_url,
  rp.primary_role_snapshot as primary_role,
  rp.role,
  rp.source,
  rp.home_team_id,
  rp.replaces_player_id,
  rp.created_at
from public.tournament_roster_players rp
join public.tournament_entries e on e.id = rp.entry_id
where e.status in ('approved', 'checked_in');

grant select on public.public_tournament_roster_view to anon, authenticated;

-- ============================================================
-- Captain: read the saved selection for one tournament
-- ============================================================

create or replace function public.get_my_tournament_roster_selection(
  p_tournament_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_team public.teams%rowtype;
  v_entry public.tournament_entries%rowtype;
  v_players jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Du skal være logget ind.';
  end if;

  select * into v_player
  from public.players
  where claimed_by_profile_id = auth.uid()
  limit 1;

  if v_player.id is null then
    return jsonb_build_object('entry', null, 'players', '[]'::jsonb);
  end if;

  select * into v_team
  from public.teams
  where captain_player_id = v_player.id
  limit 1;

  if v_team.id is null then
    return jsonb_build_object('entry', null, 'players', '[]'::jsonb);
  end if;

  select * into v_entry
  from public.tournament_entries
  where tournament_id = p_tournament_id
    and team_id = v_team.id
  order by created_at desc
  limit 1;

  if v_entry.id is null then
    return jsonb_build_object('entry', null, 'players', '[]'::jsonb);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'player_id', rp.player_id,
        'alias', rp.player_alias_snapshot,
        'slug', rp.player_slug_snapshot,
        'avatar_url', rp.player_avatar_url_snapshot,
        'primary_role', rp.primary_role_snapshot,
        'role', rp.role,
        'source', rp.source,
        'home_team_id', rp.home_team_id,
        'replaces_player_id', rp.replaces_player_id
      )
      order by
        case when rp.role = 'starter' then 0 else 1 end,
        rp.created_at,
        rp.player_alias_snapshot
    ),
    '[]'::jsonb
  )
  into v_players
  from public.tournament_roster_players rp
  where rp.entry_id = v_entry.id;

  return jsonb_build_object(
    'entry', jsonb_build_object(
      'id', v_entry.id,
      'status', v_entry.status,
      'roster_confirmed_at', v_entry.roster_confirmed_at,
      'roster_locked_at', v_entry.roster_locked_at,
      'roster_version', v_entry.roster_version
    ),
    'players', v_players
  );
end;
$$;

revoke all on function public.get_my_tournament_roster_selection(uuid) from public;
grant execute on function public.get_my_tournament_roster_selection(uuid) to authenticated;

-- ============================================================
-- Captain: submit / update tournament roster
-- ============================================================

create or replace function public.submit_my_team_tournament_roster(
  p_tournament_id uuid,
  p_starter_ids uuid[],
  p_substitute_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_team public.teams%rowtype;
  v_tournament public.tournaments%rowtype;
  v_entry public.tournament_entries%rowtype;
  v_player_id uuid;
  v_member_count integer;
  v_required_starters integer;
  v_max_substitutes integer;
  v_existing_status text;
begin
  if auth.uid() is null then
    raise exception 'Du skal være logget ind.';
  end if;

  select * into v_player
  from public.players
  where claimed_by_profile_id = auth.uid()
  limit 1;

  if v_player.id is null then
    raise exception 'Din account er ikke koblet til en VCL-spillerprofil.';
  end if;

  select * into v_team
  from public.teams
  where captain_player_id = v_player.id
  limit 1;

  if v_team.id is null then
    raise exception 'Kun holdets captain kan sende turneringsrosteren.';
  end if;

  select * into v_tournament
  from public.tournaments
  where id = p_tournament_id;

  if v_tournament.id is null then
    raise exception 'Turneringen findes ikke.';
  end if;

  if v_tournament.status <> 'open' then
    raise exception 'Turneringen er ikke åben for tilmelding.';
  end if;

  if v_tournament.signup_opens_at is not null
     and v_tournament.signup_opens_at > now() then
    raise exception 'Tilmeldingen er ikke åbnet endnu.';
  end if;

  if v_tournament.signup_closes_at is not null
     and v_tournament.signup_closes_at <= now() then
    raise exception 'Tilmeldingsfristen er udløbet.';
  end if;

  v_required_starters := coalesce(v_tournament.required_starters, 4);
  v_max_substitutes := coalesce(v_tournament.max_substitutes, 2);

  if coalesce(cardinality(p_starter_ids), 0) <> v_required_starters then
    raise exception 'Vælg præcis % starters.', v_required_starters;
  end if;

  if coalesce(cardinality(p_substitute_ids), 0) > v_max_substitutes then
    raise exception 'Du kan højst vælge % substitutes.', v_max_substitutes;
  end if;

  if (
    select count(distinct x)
    from unnest(coalesce(p_starter_ids, '{}'::uuid[])) x
  ) <> coalesce(cardinality(p_starter_ids), 0) then
    raise exception 'Den samme spiller kan ikke vælges flere gange som starter.';
  end if;

  if (
    select count(distinct x)
    from unnest(coalesce(p_substitute_ids, '{}'::uuid[])) x
  ) <> coalesce(cardinality(p_substitute_ids), 0) then
    raise exception 'Den samme spiller kan ikke vælges flere gange som substitute.';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_starter_ids, '{}'::uuid[])) s
    join unnest(coalesce(p_substitute_ids, '{}'::uuid[])) b on b = s
  ) then
    raise exception 'En spiller kan ikke være både starter og substitute.';
  end if;

  select count(*) into v_member_count
  from public.team_members tm
  where tm.team_id = v_team.id
    and tm.player_id = any(coalesce(p_starter_ids, '{}'::uuid[]))
    and tm.left_at is null;

  if v_member_count <> v_required_starters then
    raise exception 'Alle valgte starters skal være på holdets aktive VCL-roster.';
  end if;

  if coalesce(cardinality(p_substitute_ids), 0) > 0 then
    select count(*) into v_member_count
    from public.team_members tm
    where tm.team_id = v_team.id
      and tm.player_id = any(p_substitute_ids)
      and tm.left_at is null;

    if v_member_count <> cardinality(p_substitute_ids) then
      raise exception 'Alle valgte substitutes skal være på holdets aktive VCL-roster.';
    end if;
  end if;

  select * into v_entry
  from public.tournament_entries
  where tournament_id = p_tournament_id
    and team_id = v_team.id
  order by created_at desc
  limit 1;

  if v_entry.id is not null then
    v_existing_status := v_entry.status;

    if v_entry.roster_locked_at is not null then
      raise exception 'Denne tournament roster er låst og kan ikke længere ændres.';
    end if;

    if v_entry.status in ('checked_in', 'disqualified') then
      raise exception 'Denne tournament roster kan ikke længere ændres.';
    end if;
  end if;

  -- Reuse the existing entry-request function so all current VCL eligibility,
  -- tier and duplicate-entry rules continue to apply. Only call it when an
  -- active request does not already exist; pending/approved rosters may be edited.
  if v_entry.id is null
     or v_entry.status in ('rejected', 'withdrawn') then
    perform public.request_my_team_tournament_entry(p_tournament_id);

    select * into v_entry
    from public.tournament_entries
    where tournament_id = p_tournament_id
      and team_id = v_team.id
    order by created_at desc
    limit 1;
  end if;

  if v_entry.id is null then
    raise exception 'Tilmeldingen blev oprettet, men tournament entry kunne ikke findes.';
  end if;

  if v_entry.roster_locked_at is not null then
    raise exception 'Denne tournament roster er låst og kan ikke længere ændres.';
  end if;

  -- Replace the saved selection atomically. Snapshot data is copied from players
  -- now, so later profile changes do not rewrite this tournament lineup.
  delete from public.tournament_roster_players
  where entry_id = v_entry.id;

  foreach v_player_id in array p_starter_ids loop
    insert into public.tournament_roster_players (
      entry_id,
      player_id,
      role,
      source,
      home_team_id,
      player_alias_snapshot,
      player_slug_snapshot,
      player_avatar_url_snapshot,
      primary_role_snapshot
    )
    select
      v_entry.id,
      p.id,
      'starter',
      'team',
      v_team.id,
      p.alias,
      p.slug,
      p.avatar_url,
      p.primary_role
    from public.players p
    where p.id = v_player_id;
  end loop;

  foreach v_player_id in array coalesce(p_substitute_ids, '{}'::uuid[]) loop
    insert into public.tournament_roster_players (
      entry_id,
      player_id,
      role,
      source,
      home_team_id,
      player_alias_snapshot,
      player_slug_snapshot,
      player_avatar_url_snapshot,
      primary_role_snapshot
    )
    select
      v_entry.id,
      p.id,
      'substitute',
      'team',
      v_team.id,
      p.alias,
      p.slug,
      p.avatar_url,
      p.primary_role
    from public.players p
    where p.id = v_player_id;
  end loop;

  update public.tournament_entries
  set
    roster_confirmed_at = now(),
    roster_version = coalesce(roster_version, 0) + 1,
    updated_at = now()
  where id = v_entry.id
  returning * into v_entry;

  return jsonb_build_object(
    'id', v_entry.id,
    'tournament_id', v_entry.tournament_id,
    'team_id', v_entry.team_id,
    'status', v_entry.status,
    'roster_confirmed_at', v_entry.roster_confirmed_at,
    'roster_locked_at', v_entry.roster_locked_at,
    'roster_version', v_entry.roster_version,
    'starter_count', cardinality(p_starter_ids),
    'substitute_count', coalesce(cardinality(p_substitute_ids), 0),
    'was_existing_status', v_existing_status
  );
end;
$$;

revoke all on function public.submit_my_team_tournament_roster(uuid, uuid[], uuid[]) from public;
grant execute on function public.submit_my_team_tournament_roster(uuid, uuid[], uuid[]) to authenticated;

-- ============================================================
-- Automatic roster lock when a tournament leaves signup state
-- ============================================================

create or replace function public.vcl_lock_tournament_rosters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'open'
     and new.status <> 'open' then
    update public.tournament_entries
    set roster_locked_at = coalesce(roster_locked_at, now()),
        updated_at = now()
    where tournament_id = new.id
      and status in ('pending', 'approved', 'checked_in');
  end if;

  return new;
end;
$$;

revoke all on function public.vcl_lock_tournament_rosters() from public;

drop trigger if exists vcl_lock_tournament_rosters_trigger on public.tournaments;
create trigger vcl_lock_tournament_rosters_trigger
after update of status on public.tournaments
for each row
execute function public.vcl_lock_tournament_rosters();

commit;

notify pgrst, 'reload schema';
