-- VCL 2.1 stabilization
-- Make the explicit entry-based tournament roster the canonical source for
-- bracket/settlement/history. This removes the old automatic whole-team
-- snapshot path from active tournament processing while keeping legacy columns
-- nullable for historical compatibility during the cleanup window.

begin;

-- ============================================================
-- Preflight: canonical rows must be unique per entry/player
-- ============================================================

do $$
begin
  if exists (
    select 1
    from public.tournament_roster_players
    where entry_id is not null
    group by entry_id, player_id
    having count(*) > 1
  ) then
    raise exception 'Canonical tournament roster contains duplicate entry/player rows. Resolve them before applying the stabilization migration.';
  end if;
end;
$$;

-- ============================================================
-- Stop the legacy automatic permanent-roster snapshot
-- ============================================================

drop trigger if exists tournament_match_roster_snapshot
on public.tournament_matches;

-- Keep the old functions temporarily as harmless compatibility stubs. They can
-- be dropped in the final legacy cleanup once no old client/admin path refers to
-- them anymore.
create or replace function public.vcl_snapshot_tournament_rosters(
  p_tournament_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return 0;
end;
$$;

create or replace function public.vcl_snapshot_roster_on_match_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;

-- ============================================================
-- Canonical table shape
-- ============================================================

-- These columns belong to the legacy snapshot generation. New explicit roster
-- inserts intentionally do not populate them, so they must not remain required.
alter table public.tournament_roster_players
  alter column tournament_id drop not null,
  alter column team_id drop not null,
  alter column alias_snapshot drop not null;

-- The new roster model requires one representation of a player per entry.
create unique index if not exists tournament_roster_players_entry_player_unique_idx
  on public.tournament_roster_players (entry_id, player_id)
  where entry_id is not null;

comment on column public.tournament_roster_players.entry_id is
  'Canonical tournament-roster ownership. Active VCL flows must resolve tournament/team through tournament_entries.';

comment on column public.tournament_roster_players.tournament_id is
  'Legacy compatibility column. Do not use for new tournament roster logic.';

comment on column public.tournament_roster_players.team_id is
  'Legacy compatibility column. Do not use for new tournament roster logic.';

comment on column public.tournament_roster_players.alias_snapshot is
  'Legacy compatibility snapshot. New flows use player_alias_snapshot.';

-- ============================================================
-- Admin settlement preview: read the submitted entry roster only
-- ============================================================

create or replace function public.admin_preview_tournament_settlement(
  p_tournament_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_issues jsonb := '[]'::jsonb;
  v_standings jsonb := '[]'::jsonb;
  v_match_count integer := 0;
  v_unfinished integer := 0;
  v_final_ready boolean := false;
  v_missing_rosters integer := 0;
begin
  if not public.is_vcl_admin() then
    raise exception 'Kun admins kan forhåndsvise pointafregning.';
  end if;

  select * into v_tournament
  from public.tournaments
  where id = p_tournament_id;

  if not found then
    raise exception 'Turneringen blev ikke fundet.';
  end if;

  select count(*) into v_match_count
  from public.tournament_matches
  where tournament_id = p_tournament_id;

  select count(*) into v_unfinished
  from public.tournament_matches
  where tournament_id = p_tournament_id
    and team_a_id is not null
    and team_b_id is not null
    and status <> 'completed';

  select exists (
    select 1
    from public.tournament_matches m
    where m.tournament_id = p_tournament_id
      and m.round_number = (
        select max(round_number)
        from public.tournament_matches
        where tournament_id = p_tournament_id
      )
      and m.status = 'completed'
      and m.winner_team_id is not null
  ) into v_final_ready;

  -- A settlement roster is valid only when the team has an active tournament
  -- entry, the captain explicitly confirmed the roster, and the saved canonical
  -- entry-based lineup still satisfies the tournament limits.
  select count(*) into v_missing_rosters
  from public.vcl_calculate_tournament_standings(p_tournament_id) s
  left join public.tournament_entries e
    on e.tournament_id = p_tournament_id
   and e.team_id = s.team_id
   and e.status in ('approved', 'checked_in')
  where e.id is null
     or e.roster_confirmed_at is null
     or (
       select count(*)
       from public.tournament_roster_players rp
       where rp.entry_id = e.id
         and rp.role = 'starter'
     ) <> coalesce(v_tournament.required_starters, 4)
     or (
       select count(*)
       from public.tournament_roster_players rp
       where rp.entry_id = e.id
         and rp.role = 'substitute'
     ) > coalesce(v_tournament.max_substitutes, 2);

  if v_tournament.settled_at is not null then
    v_issues := v_issues || jsonb_build_array('Turneringen er allerede afsluttet og afregnet.');
  end if;
  if v_match_count = 0 then
    v_issues := v_issues || jsonb_build_array('Bracketen er ikke genereret endnu.');
  end if;
  if v_unfinished > 0 then
    v_issues := v_issues || jsonb_build_array(v_unfinished || ' kamp(e) mangler stadig en vinder.');
  end if;
  if not v_final_ready then
    v_issues := v_issues || jsonb_build_array('Finalen er ikke afsluttet endnu.');
  end if;
  if v_missing_rosters > 0 then
    v_issues := v_issues || jsonb_build_array(
      v_missing_rosters || ' hold mangler en gyldig, bekræftet tournament roster.'
    );
  end if;

  select coalesce(jsonb_agg(team_row order by placement, team_name), '[]'::jsonb)
  into v_standings
  from (
    select
      jsonb_build_object(
        'team_id', s.team_id,
        'team_name', coalesce(t.name, e.team_name_snapshot, 'Ukendt hold'),
        'team_slug', coalesce(t.slug, e.team_slug_snapshot, ''),
        'logo_url', coalesce(t.logo_url, e.logo_url_snapshot, ''),
        'placement', s.placement,
        'points_per_player', s.points_per_player,
        'roster_count', (
          select count(*)
          from public.tournament_roster_players rp
          where rp.entry_id = e.id
        ),
        'players', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'player_id', rp.player_id,
              'alias', rp.player_alias_snapshot,
              'role', rp.role,
              'source', rp.source,
              'primary_role', rp.primary_role_snapshot,
              'home_team_id', rp.home_team_id,
              'replaces_player_id', rp.replaces_player_id,
              -- Compatibility keys for the current admin renderer/data shape.
              'member_role', rp.primary_role_snapshot,
              'roster_status', rp.role,
              'points', s.points_per_player
            )
            order by
              case when rp.role = 'starter' then 0 else 1 end,
              rp.player_alias_snapshot
          )
          from public.tournament_roster_players rp
          where rp.entry_id = e.id
        ), '[]'::jsonb)
      ) as team_row,
      s.placement,
      coalesce(t.name, e.team_name_snapshot, 'Ukendt hold') as team_name
    from public.vcl_calculate_tournament_standings(p_tournament_id) s
    left join public.teams t on t.id = s.team_id
    left join public.tournament_entries e
      on e.tournament_id = p_tournament_id
     and e.team_id = s.team_id
     and e.status in ('approved', 'checked_in')
  ) preview_rows;

  return jsonb_build_object(
    'tournament_id', v_tournament.id,
    'tournament_name', v_tournament.name,
    'series_slug', v_tournament.series_slug,
    'settled_at', v_tournament.settled_at,
    'ready', jsonb_array_length(v_issues) = 0,
    'issues', v_issues,
    'standings', v_standings
  );
end;
$$;

-- ============================================================
-- Final settlement: exact submitted players only
-- ============================================================

create or replace function public.admin_finalize_tournament(
  p_tournament_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_preview jsonb;
  v_team_count integer := 0;
  v_player_count integer := 0;
  v_points_total integer := 0;
  v_winner_team_id uuid;
begin
  if not public.is_vcl_admin() then
    raise exception 'Kun admins kan afslutte turneringen.';
  end if;

  select * into v_tournament
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception 'Turneringen blev ikke fundet.';
  end if;

  if v_tournament.settled_at is not null then
    raise exception 'Turneringen er allerede afsluttet og afregnet.';
  end if;

  v_preview := public.admin_preview_tournament_settlement(p_tournament_id);
  if coalesce((v_preview ->> 'ready')::boolean, false) is not true then
    raise exception 'Turneringen kan ikke afsluttes endnu: %', v_preview -> 'issues';
  end if;

  delete from public.tournament_player_results
  where tournament_id = p_tournament_id;

  delete from public.tournament_team_results
  where tournament_id = p_tournament_id;

  insert into public.tournament_team_results (
    tournament_id,
    team_id,
    placement,
    points_per_player,
    roster_size
  )
  select
    p_tournament_id,
    s.team_id,
    s.placement,
    s.points_per_player,
    count(rp.player_id)::integer
  from public.vcl_calculate_tournament_standings(p_tournament_id) s
  join public.tournament_entries e
    on e.tournament_id = p_tournament_id
   and e.team_id = s.team_id
   and e.status in ('approved', 'checked_in')
  left join public.tournament_roster_players rp
    on rp.entry_id = e.id
  group by s.team_id, s.placement, s.points_per_player;

  get diagnostics v_team_count = row_count;

  insert into public.tournament_player_results (
    tournament_id,
    team_id,
    player_id,
    placement,
    points_awarded
  )
  select
    p_tournament_id,
    s.team_id,
    rp.player_id,
    s.placement,
    s.points_per_player
  from public.vcl_calculate_tournament_standings(p_tournament_id) s
  join public.tournament_entries e
    on e.tournament_id = p_tournament_id
   and e.team_id = s.team_id
   and e.status in ('approved', 'checked_in')
  join public.tournament_roster_players rp
    on rp.entry_id = e.id;

  get diagnostics v_player_count = row_count;

  insert into public.player_point_transactions (
    player_id,
    points_delta,
    reason,
    source_type,
    source_ref,
    created_by
  )
  select
    r.player_id,
    r.points_awarded,
    v_tournament.name || ' · ' || r.placement || '. plads',
    'tournament',
    'tournament:' || p_tournament_id::text,
    auth.uid()
  from public.tournament_player_results r
  where r.tournament_id = p_tournament_id
    and r.points_awarded > 0
  on conflict (player_id, source_type, source_ref)
    where source_ref is not null
  do update set
    points_delta = excluded.points_delta,
    reason = excluded.reason,
    created_by = auth.uid(),
    created_at = now();

  update public.players p
  set points = totals.ledger_points
  from (
    select
      tx.player_id,
      coalesce(sum(tx.points_delta), 0)::integer as ledger_points
    from public.player_point_transactions tx
    where tx.player_id in (
      select distinct r.player_id
      from public.tournament_player_results r
      where r.tournament_id = p_tournament_id
    )
    group by tx.player_id
  ) totals
  where p.id = totals.player_id;

  select coalesce(sum(points_awarded), 0)::integer
  into v_points_total
  from public.tournament_player_results
  where tournament_id = p_tournament_id;

  if v_tournament.series_slug = 'academy' then
    update public.players p
    set academy_wins = coalesce(p.academy_wins, 0) + 1
    from public.tournament_player_results r
    where r.tournament_id = p_tournament_id
      and r.placement = 1
      and r.player_id = p.id;
  elsif v_tournament.series_slug = 'contender' then
    update public.players p
    set contender_wins = coalesce(p.contender_wins, 0) + 1
    from public.tournament_player_results r
    where r.tournament_id = p_tournament_id
      and r.placement = 1
      and r.player_id = p.id;
  elsif v_tournament.series_slug = 'championship' then
    update public.players p
    set championship_wins = coalesce(p.championship_wins, 0) + 1
    from public.tournament_player_results r
    where r.tournament_id = p_tournament_id
      and r.placement = 1
      and r.player_id = p.id;
  end if;

  select team_id into v_winner_team_id
  from public.tournament_team_results
  where tournament_id = p_tournament_id
    and placement = 1
  limit 1;

  update public.tournaments
  set
    status = 'completed',
    winner_team_id = v_winner_team_id,
    settled_at = now(),
    settled_by = auth.uid(),
    updated_at = now()
  where id = p_tournament_id
  returning * into v_tournament;

  return jsonb_build_object(
    'tournament_id', p_tournament_id,
    'status', v_tournament.status,
    'settled_at', v_tournament.settled_at,
    'winner_team_id', v_winner_team_id,
    'teams_processed', v_team_count,
    'players_processed', v_player_count,
    'points_awarded_total', v_points_total
  );
end;
$$;

-- ============================================================
-- Public settled team-result view: canonical roster metadata
-- ============================================================

create or replace view public.public_tournament_team_results_view
with (security_invoker = true)
as
select
  r.id,
  r.tournament_id,
  tr.slug as tournament_slug,
  tr.name as event_name,
  tr.series_slug as series,
  tr.starts_at as event_date,
  tr.settled_at,
  r.team_id,
  t.slug as team_slug,
  t.name as team_name,
  t.logo_url,
  r.placement,
  r.points_per_player,
  r.roster_size,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'player_id', pr.player_id,
        'slug', coalesce(rp.player_slug_snapshot, p.slug),
        'alias', coalesce(rp.player_alias_snapshot, p.alias),
        'role', coalesce(rp.primary_role_snapshot, 'Player'),
        'status', case when rp.role = 'substitute' then 'sub' else 'starter' end,
        'tournament_role', rp.role,
        'source', rp.source,
        'home_team_id', rp.home_team_id,
        'points', pr.points_awarded
      )
      order by
        case when rp.role = 'starter' then 0 else 1 end,
        coalesce(rp.player_alias_snapshot, p.alias)
    )
    from public.tournament_player_results pr
    join public.players p on p.id = pr.player_id
    left join public.tournament_entries e
      on e.tournament_id = pr.tournament_id
     and e.team_id = pr.team_id
    left join public.tournament_roster_players rp
      on rp.entry_id = e.id
     and rp.player_id = pr.player_id
    where pr.tournament_id = r.tournament_id
      and pr.team_id = r.team_id
  ), '[]'::jsonb) as roster_snapshot
from public.tournament_team_results r
join public.tournaments tr on tr.id = r.tournament_id
join public.teams t on t.id = r.team_id;

grant select on public.public_tournament_team_results_view to anon, authenticated;

notify pgrst, 'reload schema';

commit;
