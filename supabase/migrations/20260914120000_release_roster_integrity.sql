-- VCL 2.1 release blockers A1/A2.
-- Requires the roster foundation, loans/stand-ins and canonical settlement
-- migrations on the verified VCL baseline. No historical migrations are replayed.
-- Finalization already calls admin_preview_tournament_settlement under the
-- tournament lock before any result/point writes; its existing body is retained.
-- This migration has NOT been executed against Supabase.
begin;

create or replace function public.submit_my_team_tournament_roster_v2(
  p_tournament_id uuid,
  p_starter_ids uuid[],
  p_substitute_ids uuid[] default '{}'::uuid[],
  p_loan_request_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captain public.players%rowtype;
  v_team public.teams%rowtype;
  v_tournament public.tournaments%rowtype;
  v_entry public.tournament_entries%rowtype;
  v_player_id uuid;
  v_request_id uuid;
  v_member_count integer;
  v_required_starters integer;
  v_max_substitutes integer;
  v_max_loans integer;
  v_loan_count integer;
  v_loan_starters integer;
  v_loan_substitutes integer;
  v_accepted_total integer;
  v_existing_status text;
  v_selected_player_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'Du skal være logget ind.';
  end if;

  select * into v_captain
  from public.players
  where claimed_by_profile_id = auth.uid()
  limit 1;

  if v_captain.id is null then
    raise exception 'Din account er ikke koblet til en VCL-spillerprofil.';
  end if;

  select * into v_team
  from public.teams
  where captain_player_id = v_captain.id
  limit 1;

  if v_team.id is null then
    raise exception 'Kun holdets captain kan sende tournament rosteren.';
  end if;

  select * into v_tournament
  from public.tournaments
  where id = p_tournament_id
  for update;

  if v_tournament.id is null then
    raise exception 'Turneringen findes ikke.';
  end if;

  if (v_tournament.status <> 'open' or v_tournament.settled_at is not null) then
    raise exception 'Turneringen er ikke åben for rosterændringer.';
  end if;

  if v_tournament.signup_opens_at is not null and v_tournament.signup_opens_at > clock_timestamp() then
    raise exception 'Tilmeldingen er ikke åbnet endnu.';
  end if;

  if v_tournament.signup_closes_at is not null and v_tournament.signup_closes_at <= clock_timestamp() then
    raise exception 'Tilmeldingsfristen er udløbet.';
  end if;

  v_required_starters := coalesce(v_tournament.required_starters, 4);
  v_max_substitutes := coalesce(v_tournament.max_substitutes, 2);
  v_max_loans := case when coalesce(v_tournament.allows_loans, true) then coalesce(v_tournament.max_loans, 2) else 0 end;

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

  if (
    select count(distinct x)
    from unnest(coalesce(p_loan_request_ids, '{}'::uuid[])) x
  ) <> coalesce(cardinality(p_loan_request_ids), 0) then
    raise exception 'Den samme stand-in request kan ikke vælges flere gange.';
  end if;

  v_loan_count := coalesce(cardinality(p_loan_request_ids), 0);
  if v_loan_count > v_max_loans then
    raise exception 'Denne turnering tillader højst % stand-ins pr. hold.', v_max_loans;
  end if;

  -- Invalidate accepted offers whose permanent source changed before submission.
  update public.tournament_loan_requests lr
  set status = 'invalidated', responded_at = coalesce(lr.responded_at, now())
  from public.players p
  where lr.tournament_id = p_tournament_id
    and lr.requesting_team_id = v_team.id
    and lr.status = 'accepted'
    and lr.entry_id is null
    and p.id = lr.player_id
    and (
      (lr.home_team_id is null and (p.current_team_id is not null or coalesce(p.is_free_agent, false) = false))
      or
      (lr.home_team_id is not null and p.current_team_id is distinct from lr.home_team_id)
    );

      if found then
    return jsonb_build_object(
      'status', 'invalidated',
      'message', 'En eller flere accepterede stand-ins har ændret holdstatus. Opdater rosteren og prøv igen.'
    );
  end if;

  select count(*) into v_accepted_total
  from public.tournament_loan_requests lr
  where lr.tournament_id = p_tournament_id
    and lr.requesting_team_id = v_team.id
    and lr.status = 'accepted';

  if v_accepted_total <> v_loan_count then
    raise exception 'Alle accepterede stand-ins skal være med i rosteren. Annuller en ubrugt stand-in først.';
  end if;

  select
    count(*),
    count(*) filter (where lr.requested_role = 'starter'),
    count(*) filter (where lr.requested_role = 'substitute')
  into v_member_count, v_loan_starters, v_loan_substitutes
  from public.tournament_loan_requests lr
  where lr.id = any(coalesce(p_loan_request_ids, '{}'::uuid[]))
    and lr.tournament_id = p_tournament_id
    and lr.requesting_team_id = v_team.id
    and lr.status = 'accepted';

  if v_member_count <> v_loan_count then
    raise exception 'En eller flere stand-in requests er ikke længere gyldige.';
  end if;

  if coalesce(cardinality(p_starter_ids), 0) + coalesce(v_loan_starters, 0) <> v_required_starters then
    raise exception 'Vælg præcis % starters inklusive accepterede stand-ins.', v_required_starters;
  end if;

  if coalesce(cardinality(p_substitute_ids), 0) + coalesce(v_loan_substitutes, 0) > v_max_substitutes then
    raise exception 'Du kan højst vælge % substitutes inklusive accepterede stand-ins.', v_max_substitutes;
  end if;

  select count(*) into v_member_count
  from public.team_members tm
  where tm.team_id = v_team.id
    and tm.player_id = any(coalesce(p_starter_ids, '{}'::uuid[]))
    and tm.left_at is null;

  if v_member_count <> coalesce(cardinality(p_starter_ids), 0) then
    raise exception 'Alle valgte permanente starters skal være på holdets aktive VCL-roster.';
  end if;

  if coalesce(cardinality(p_substitute_ids), 0) > 0 then
    select count(*) into v_member_count
    from public.team_members tm
    where tm.team_id = v_team.id
      and tm.player_id = any(p_substitute_ids)
      and tm.left_at is null;

    if v_member_count <> cardinality(p_substitute_ids) then
      raise exception 'Alle valgte permanente substitutes skal være på holdets aktive VCL-roster.';
    end if;
  end if;

  -- A permanent member of this team cannot simultaneously be reserved for a
  -- different team in the same tournament.
  if exists (
    select 1
    from public.tournament_loan_requests lr
    where lr.tournament_id = p_tournament_id
      and lr.status = 'accepted'
      and lr.requesting_team_id <> v_team.id
      and lr.player_id = any(
        coalesce(p_starter_ids, '{}'::uuid[]) || coalesce(p_substitute_ids, '{}'::uuid[])
      )
  ) then
    raise exception 'En valgt spiller har accepteret at være stand-in for et andet hold i denne turnering.';
  end if;

  -- Validate each selected loan against its current permanent state and any
  -- already saved tournament representation.
  if exists (
    select 1
    from public.tournament_loan_requests lr
    join public.players p on p.id = lr.player_id
    where lr.id = any(coalesce(p_loan_request_ids, '{}'::uuid[]))
      and (
        (lr.home_team_id is null and (p.current_team_id is not null or coalesce(p.is_free_agent, false) = false))
        or
        (lr.home_team_id is not null and p.current_team_id is distinct from lr.home_team_id)
      )
  ) then
    raise exception 'En stand-ins permanente holdstatus har ændret sig. Send en ny request.';
  end if;

  -- Tournament FOR UPDATE above serializes all saves, acceptances and removals.
  -- Check permanent starters, substitutes AND loans against all active teams.
  v_selected_player_ids := coalesce(p_starter_ids, '{}'::uuid[])
    || coalesce(p_substitute_ids, '{}'::uuid[])
    || array(
      select lr.player_id from public.tournament_loan_requests lr
      where lr.id = any(coalesce(p_loan_request_ids, '{}'::uuid[]))
    );
  if (select count(distinct id) from unnest(v_selected_player_ids) id)
     <> cardinality(v_selected_player_ids) then
    raise exception 'En spiller kan kun have en plads i tournament rosteren.';
  end if;
  if exists (
    select 1 from public.tournament_roster_players rp
    join public.tournament_entries other_entry on other_entry.id = rp.entry_id
    where rp.player_id = any(v_selected_player_ids)
      and other_entry.tournament_id = p_tournament_id
      and other_entry.team_id is distinct from v_team.id
      and other_entry.status in ('pending', 'approved', 'checked_in')
  ) then
    raise exception 'En valgt spiller er allerede registreret for et andet aktivt hold i turneringen.';
  end if;

  if exists (
    select 1
    from public.tournament_loan_requests lr
    where lr.id = any(coalesce(p_loan_request_ids, '{}'::uuid[]))
      and lr.requested_role = 'starter'
      and lr.replaces_player_id is not null
      and lr.replaces_player_id = any(coalesce(p_starter_ids, '{}'::uuid[]))
  ) then
    raise exception 'Spilleren som stand-in erstatter kan ikke samtidig stå som starter.';
  end if;

  if (
    select count(lr.replaces_player_id)
    from public.tournament_loan_requests lr
    where lr.id = any(coalesce(p_loan_request_ids, '{}'::uuid[]))
      and lr.replaces_player_id is not null
  ) <> (
    select count(distinct lr.replaces_player_id)
    from public.tournament_loan_requests lr
    where lr.id = any(coalesce(p_loan_request_ids, '{}'::uuid[]))
      and lr.replaces_player_id is not null
  ) then
    raise exception 'To stand-ins kan ikke erstatte den samme starter.';
  end if;

  select * into v_entry
  from public.tournament_entries
  where tournament_id = p_tournament_id
    and team_id = v_team.id
  order by created_at desc
  limit 1
  for update;

  if v_entry.id is not null then
    v_existing_status := v_entry.status;

    if v_entry.roster_locked_at is not null then
      raise exception 'Denne tournament roster er låst og kan ikke længere ændres.';
    end if;

    if v_entry.status in ('checked_in', 'disqualified') then
      raise exception 'Denne tournament roster kan ikke længere ændres.';
    end if;
  end if;

  if v_entry.id is null or v_entry.status in ('rejected', 'withdrawn') then
    perform public.request_my_team_tournament_entry(p_tournament_id);

    select * into v_entry
    from public.tournament_entries
    where tournament_id = p_tournament_id
      and team_id = v_team.id
    order by created_at desc
    limit 1;
  end if;

  if v_entry.id is null then
    raise exception 'Tournament entry kunne ikke findes efter tilmeldingen.';
  end if;

  if v_entry.roster_locked_at is not null then
    raise exception 'Denne tournament roster er låst og kan ikke længere ændres.';
  end if;

  -- Entry locking may have waited behind an admin operation; recheck time.
  if v_tournament.signup_closes_at is not null
     and v_tournament.signup_closes_at <= clock_timestamp() then
    raise exception 'Tilmeldingsfristen er udløbet.';
  end if;

  delete from public.tournament_roster_players
  where entry_id = v_entry.id;

  foreach v_player_id in array coalesce(p_starter_ids, '{}'::uuid[]) loop
    insert into public.tournament_roster_players (
      entry_id, player_id, role, source, home_team_id,
      player_alias_snapshot, player_slug_snapshot, player_avatar_url_snapshot, primary_role_snapshot
    )
    select
      v_entry.id, p.id, 'starter', 'team', v_team.id,
      p.alias, p.slug, p.avatar_url, p.primary_role
    from public.players p
    where p.id = v_player_id;
  end loop;

  foreach v_player_id in array coalesce(p_substitute_ids, '{}'::uuid[]) loop
    insert into public.tournament_roster_players (
      entry_id, player_id, role, source, home_team_id,
      player_alias_snapshot, player_slug_snapshot, player_avatar_url_snapshot, primary_role_snapshot
    )
    select
      v_entry.id, p.id, 'substitute', 'team', v_team.id,
      p.alias, p.slug, p.avatar_url, p.primary_role
    from public.players p
    where p.id = v_player_id;
  end loop;

  foreach v_request_id in array coalesce(p_loan_request_ids, '{}'::uuid[]) loop
    insert into public.tournament_roster_players (
      entry_id,
      player_id,
      role,
      source,
      home_team_id,
      replaces_player_id,
      player_alias_snapshot,
      player_slug_snapshot,
      player_avatar_url_snapshot,
      primary_role_snapshot
    )
    select
      v_entry.id,
      p.id,
      lr.requested_role,
      case when lr.home_team_id is null then 'loan_free_agent' else 'loan_team' end,
      lr.home_team_id,
      lr.replaces_player_id,
      p.alias,
      p.slug,
      p.avatar_url,
      p.primary_role
    from public.tournament_loan_requests lr
    join public.players p on p.id = lr.player_id
    where lr.id = v_request_id
      and lr.status = 'accepted';

    update public.tournament_loan_requests
    set entry_id = v_entry.id
    where id = v_request_id;

    insert into public.roster_activity (
      player_id,
      event_type,
      from_team_id,
      to_team_id,
      player_alias,
      player_slug,
      player_avatar_url,
      from_team_name,
      from_team_slug,
      from_team_logo_url,
      to_team_name,
      to_team_slug,
      to_team_logo_url,
      tournament_id,
      entry_id,
      loan_request_id,
      tournament_name,
      tournament_slug
    )
    select
      lr.player_id,
      case when lr.home_team_id is null then 'loan_free_agent' else 'loan_from_team' end,
      lr.home_team_id,
      v_team.id,
      lr.player_alias_snapshot,
      lr.player_slug_snapshot,
      lr.player_avatar_url_snapshot,
      lr.home_team_name_snapshot,
      lr.home_team_slug_snapshot,
      lr.home_team_logo_url_snapshot,
      v_team.name,
      v_team.slug,
      v_team.logo_url,
      v_tournament.id,
      v_entry.id,
      lr.id,
      v_tournament.name,
      v_tournament.slug
    from public.tournament_loan_requests lr
    where lr.id = v_request_id
    on conflict (loan_request_id) where loan_request_id is not null do nothing;
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
    'starter_count', coalesce(cardinality(p_starter_ids), 0) + coalesce(v_loan_starters, 0),
    'substitute_count', coalesce(cardinality(p_substitute_ids), 0) + coalesce(v_loan_substitutes, 0),
    'loan_count', v_loan_count,
    'was_existing_status', v_existing_status
  );
end;
$$;

-- Cached clients retain their signature, but not their old validation path.
-- Empty loan IDs deliberately fail when the team has accepted reservations.
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
begin
  return public.submit_my_team_tournament_roster_v2(
    p_tournament_id, p_starter_ids, p_substitute_ids, '{}'::uuid[]
  );
end;
$$;

create or replace function public.respond_to_tournament_loan_request(
  p_request_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_request public.tournament_loan_requests%rowtype;
  v_tournament public.tournaments%rowtype;
  v_accepted_count integer;
begin
  if auth.uid() is null then
    raise exception 'Du skal være logget ind.';
  end if;

  if p_decision is null or p_decision not in ('accept', 'decline') then
    raise exception 'Ugyldigt svar på stand-in request.';
  end if;

  select * into v_player
  from public.players
  where claimed_by_profile_id = auth.uid()
  limit 1;

  if v_player.id is null then
    raise exception 'Din account er ikke koblet til en VCL-spillerprofil.';
  end if;

  select * into v_request
  from public.tournament_loan_requests
  where id = p_request_id;

  if v_request.id is null or v_request.player_id <> v_player.id then
    raise exception 'Stand-in requesten kunne ikke findes.';
  end if;

  select * into v_tournament
  from public.tournaments
  where id = v_request.tournament_id
  for update;

  -- Same lock order as save/removal: tournament, then request.
  select * into v_request from public.tournament_loan_requests
  where id = p_request_id and tournament_id = v_tournament.id
  for update;
  if v_request.id is null or v_request.player_id <> v_player.id then
    raise exception 'Stand-in requesten blev ikke fundet.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Stand-in requesten er ikke længere aktiv.';
  end if;

  perform 1 from public.tournament_entries e
  where e.tournament_id = v_tournament.id
    and e.team_id = v_request.requesting_team_id
  for update;
  if exists (
    select 1 from public.tournament_entries e
    where e.tournament_id = v_tournament.id
      and e.team_id = v_request.requesting_team_id
      and (e.roster_locked_at is not null or e.status in ('checked_in', 'disqualified'))
  ) then
    raise exception 'Tournament rosteren er låst.';
  end if;


  if v_request.expires_at <= clock_timestamp()
     or v_tournament.status <> 'open'
     or v_tournament.settled_at is not null
     or (v_tournament.signup_closes_at is not null and v_tournament.signup_closes_at <= clock_timestamp()) then
    update public.tournament_loan_requests
    set status = 'expired', responded_at = now()
    where id = v_request.id;

    return jsonb_build_object(
      'id', v_request.id,
      'status', 'expired',
      'message', 'Stand-in requesten er udløbet.'
    );
  end if;

  if p_decision = 'decline' then
    update public.tournament_loan_requests
    set status = 'declined', responded_at = now()
    where id = v_request.id
    returning * into v_request;

    return jsonb_build_object(
      'id', v_request.id,
      'status', 'declined',
      'tournament_name', v_request.tournament_name_snapshot,
      'requesting_team_name', v_request.requesting_team_name_snapshot
    );
  end if;

  if coalesce(v_tournament.allows_loans, true) = false then
    raise exception 'Turneringen tillader ikke længere stand-ins.';
  end if;

  if (
    (v_request.home_team_id is null and (v_player.current_team_id is not null or coalesce(v_player.is_free_agent, false) = false))
    or
    (v_request.home_team_id is not null and v_player.current_team_id is distinct from v_request.home_team_id)
  ) then
    update public.tournament_loan_requests
    set status = 'invalidated', responded_at = now()
    where id = v_request.id;
    return jsonb_build_object(
  'id', v_request.id,
  'status', 'invalidated',
  'tournament_id', v_request.tournament_id,
  'message', 'Din permanente holdstatus har ændret sig. Captain skal sende en ny stand-in request.'
);
  end if;

  if exists (
    select 1
    from public.tournament_roster_players rp
    join public.tournament_entries e on e.id = rp.entry_id
    where e.tournament_id = v_request.tournament_id
      and e.status not in ('rejected', 'withdrawn', 'disqualified')
      and rp.player_id = v_player.id
  ) then
    raise exception 'Du er allerede registreret for et hold i denne turnering.';
  end if;

  if exists (
    select 1
    from public.tournament_loan_requests lr
    where lr.tournament_id = v_request.tournament_id
      and lr.player_id = v_player.id
      and lr.status = 'accepted'
      and lr.id <> v_request.id
  ) then
    raise exception 'Du er allerede reserveret som stand-in for et andet hold i denne turnering.';
  end if;

  select count(*) into v_accepted_count
  from public.tournament_loan_requests lr
  where lr.tournament_id = v_request.tournament_id
    and lr.requesting_team_id = v_request.requesting_team_id
    and lr.status = 'accepted';

  if v_accepted_count >= coalesce(v_tournament.max_loans, 2) then
    raise exception 'Holdet har allerede nået grænsen for stand-ins i denne turnering.';
  end if;

  update public.tournament_loan_requests
  set status = 'accepted', responded_at = now()
  where id = v_request.id
  returning * into v_request;

  update public.tournament_loan_requests
  set status = 'invalidated', responded_at = coalesce(responded_at, now())
  where tournament_id = v_request.tournament_id
    and player_id = v_player.id
    and status = 'pending'
    and id <> v_request.id;

  return jsonb_build_object(
    'id', v_request.id,
    'status', 'accepted',
    'tournament_id', v_request.tournament_id,
    'tournament_name', v_request.tournament_name_snapshot,
    'requesting_team_id', v_request.requesting_team_id,
    'requesting_team_name', v_request.requesting_team_name_snapshot,
    'requested_role', v_request.requested_role
  );
end;
$$;

create or replace function public.cancel_my_tournament_loan_request(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captain public.players%rowtype;
  v_team public.teams%rowtype;
  v_request public.tournament_loan_requests%rowtype;
  v_tournament public.tournaments%rowtype;
  v_entry public.tournament_entries%rowtype;
  v_removed integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Du skal være logget ind.';
  end if;
  select * into v_captain from public.players
  where claimed_by_profile_id = auth.uid() limit 1;
  select * into v_team from public.teams
  where captain_player_id = v_captain.id limit 1;
  if v_team.id is null then
    raise exception 'Kun holdets captain kan fjerne stand-in requests.';
  end if;

  -- Discover identity without locking a request ahead of its tournament.
  select * into v_request from public.tournament_loan_requests
  where id = p_request_id and requesting_team_id = v_team.id;
  if v_request.id is null then
    raise exception 'Stand-in requesten blev ikke fundet.';
  end if;
  select * into v_tournament from public.tournaments
  where id = v_request.tournament_id for update;
  if v_tournament.id is null or v_tournament.status <> 'open'
     or v_tournament.settled_at is not null
     or (v_tournament.signup_opens_at is not null and v_tournament.signup_opens_at > clock_timestamp())
     or (v_tournament.signup_closes_at is not null and v_tournament.signup_closes_at <= clock_timestamp()) then
    raise exception 'Tournament rosteren er lukket eller tilmeldingsfristen er udløbet.';
  end if;

  select * into v_request from public.tournament_loan_requests
  where id = p_request_id and requesting_team_id = v_team.id
    and tournament_id = v_tournament.id
  for update;
  if v_request.id is null then
    raise exception 'Stand-in requesten blev ikke fundet.';
  end if;
  select * into v_entry from public.tournament_entries
  where tournament_id = v_tournament.id and team_id = v_team.id
  order by created_at desc limit 1 for update;
  if v_entry.roster_locked_at is not null
     or v_entry.status in ('checked_in', 'disqualified') then
    raise exception 'Tournament rosteren er låst.';
  end if;

  if v_tournament.signup_closes_at is not null
     and v_tournament.signup_closes_at <= clock_timestamp() then
    raise exception 'Tilmeldingsfristen er udløbet.';
  end if;

  -- Retrying a lost successful response must not modify rows or activity again.
  if v_request.status = 'cancelled' and v_request.entry_id is null then
    return jsonb_build_object('id', v_request.id, 'status', 'cancelled', 'roster_removed', false);
  end if;
  if v_request.status not in ('pending', 'accepted') then
    raise exception 'Denne stand-in request kan ikke længere annulleres.';
  end if;
  if v_request.entry_id is not null and v_request.entry_id is distinct from v_entry.id then
    raise exception 'Stand-in requesten matcher ikke holdets tilmelding.';
  end if;

  -- Resolve by entry/player/source; never delete a permanent roster row.
  delete from public.tournament_roster_players
  where entry_id = v_entry.id and player_id = v_request.player_id
    and source in ('loan_team', 'loan_free_agent');
  get diagnostics v_removed = row_count;
  if v_removed > 0 or v_request.entry_id is not null then
    update public.tournament_entries
    set roster_confirmed_at = null,
        roster_version = coalesce(roster_version, 0) + 1,
        updated_at = now()
    where id = v_entry.id;
  end if;
  update public.tournament_loan_requests
  set status = 'cancelled', entry_id = null, responded_at = now()
  where id = v_request.id;

  -- Keep the existing activity as history. No new joining event is emitted;
  -- permanent membership and other requests/roster rows remain untouched.
  return jsonb_build_object(
    'id', v_request.id, 'status', 'cancelled',
    'roster_removed', v_removed > 0,
    'roster_requires_confirmation', v_removed > 0 or v_request.entry_id is not null
  );
end;
$$;

create or replace function public.get_my_tournament_loan_context(
  p_tournament_id uuid,
  p_search text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captain public.players%rowtype;
  v_team public.teams%rowtype;
  v_tournament public.tournaments%rowtype;
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_requests jsonb := '[]'::jsonb;
  v_candidates jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Du skal være logget ind.';
  end if;

  select * into v_captain
  from public.players
  where claimed_by_profile_id = auth.uid()
  limit 1;

  if v_captain.id is null then
    raise exception 'Din account er ikke koblet til en VCL-spillerprofil.';
  end if;

  select * into v_team
  from public.teams
  where captain_player_id = v_captain.id
  limit 1;

  if v_team.id is null then
    raise exception 'Kun holdets captain kan administrere tournament stand-ins.';
  end if;

  select * into v_tournament
  from public.tournaments
  where id = p_tournament_id
  for update;

  if v_tournament.id is null then
    raise exception 'Turneringen findes ikke.';
  end if;

  -- Expire old unanswered requests.
  update public.tournament_loan_requests
  set status = 'expired', responded_at = coalesce(responded_at, now())
  where tournament_id = p_tournament_id
    and status = 'pending'
    and expires_at <= now();

  -- If the candidate changed permanent state before roster lock, the old offer
  -- no longer describes a valid loan source and must be requested again.
  update public.tournament_loan_requests lr
  set status = 'invalidated', responded_at = coalesce(lr.responded_at, now())
  from public.players p
  where lr.tournament_id = p_tournament_id
    and lr.status in ('pending', 'accepted')
    and lr.entry_id is null
    and p.id = lr.player_id
    and (
      (lr.home_team_id is null and (p.current_team_id is not null or coalesce(p.is_free_agent, false) = false))
      or
      (lr.home_team_id is not null and p.current_team_id is distinct from lr.home_team_id)
    );

  select coalesce(jsonb_agg(to_jsonb(request_row) order by request_row.created_at desc), '[]'::jsonb)
  into v_requests
  from (
    select
      lr.id,
      lr.player_id,
      lr.player_alias_snapshot as player_alias,
      lr.player_slug_snapshot as player_slug,
      lr.player_avatar_url_snapshot as player_avatar_url,
      lr.primary_role_snapshot as primary_role,
      lr.home_team_id,
      lr.home_team_name_snapshot as home_team_name,
      lr.home_team_slug_snapshot as home_team_slug,
      lr.home_team_logo_url_snapshot as home_team_logo_url,
      lr.requesting_team_id,
      lr.requesting_team_name_snapshot as requesting_team_name,
      lr.requesting_team_slug_snapshot as requesting_team_slug,
      lr.requesting_team_logo_url_snapshot as requesting_team_logo_url,
      lr.tournament_id,
      lr.tournament_name_snapshot as tournament_name,
      lr.tournament_slug_snapshot as tournament_slug,
      lr.entry_id,
      lr.requested_role,
      lr.replaces_player_id,
      lr.replaces_player_alias_snapshot as replaces_player_alias,
      lr.status,
      lr.message,
      lr.created_at,
      lr.expires_at,
      lr.responded_at
    from public.tournament_loan_requests lr
    where lr.tournament_id = p_tournament_id
      and lr.requesting_team_id = v_team.id
    order by (lr.status in ('pending', 'accepted')) desc, lr.created_at desc
    limit 40
  ) request_row;

  select coalesce(jsonb_agg(to_jsonb(candidate_row) order by candidate_row.alias), '[]'::jsonb)
  into v_candidates
  from (
    select
      p.id as player_id,
      p.alias,
      p.slug,
      p.avatar_url,
      p.primary_role,
      p.level,
      p.current_team_id as home_team_id,
      coalesce(p.is_free_agent, false) as is_free_agent,
      home_team.name as home_team_name,
      home_team.slug as home_team_slug,
      home_team.logo_url as home_team_logo_url,
      pending.id as pending_request_id,
      pending.expires_at as pending_expires_at
    from public.players p
    left join public.teams home_team on home_team.id = p.current_team_id
    left join public.tournament_loan_requests pending
      on pending.tournament_id = p_tournament_id
      and pending.requesting_team_id = v_team.id
      and pending.player_id = p.id
      and pending.status = 'pending'
    where p.claimed_by_profile_id is not null
      and p.current_team_id is distinct from v_team.id
      and (
        p.current_team_id is not null
        or (p.current_team_id is null and coalesce(p.is_free_agent, false) = true)
      )
      and not exists (
        select 1
        from public.tournament_roster_players rp
        join public.tournament_entries e on e.id = rp.entry_id
        where e.tournament_id = p_tournament_id
          and e.status not in ('rejected', 'withdrawn', 'disqualified')
          and rp.player_id = p.id
      )
      and not exists (
        select 1
        from public.tournament_loan_requests accepted
        where accepted.tournament_id = p_tournament_id
          and accepted.player_id = p.id
          and accepted.status = 'accepted'
      )
      and (
        v_search is null
        or p.alias ilike '%' || v_search || '%'
        or coalesce(home_team.name, 'Free Agent') ilike '%' || v_search || '%'
        or coalesce(p.primary_role, '') ilike '%' || v_search || '%'
      )
    order by p.alias
    limit 40
  ) candidate_row;

  return jsonb_build_object(
    'team', jsonb_build_object(
      'id', v_team.id,
      'name', v_team.name,
      'slug', v_team.slug,
      'logo_url', v_team.logo_url
    ),
    'tournament', jsonb_build_object(
      'id', v_tournament.id,
      'name', v_tournament.name,
      'slug', v_tournament.slug,
      'status', v_tournament.status,
      'allows_loans', coalesce(v_tournament.allows_loans, true),
      'max_loans', coalesce(v_tournament.max_loans, 2),
      'required_starters', coalesce(v_tournament.required_starters, 4),
      'max_substitutes', coalesce(v_tournament.max_substitutes, 2),
      'signup_closes_at', v_tournament.signup_closes_at
    ),
    'entry', (
      select jsonb_build_object(
        'id', e.id, 'status', e.status,
        'roster_locked_at', e.roster_locked_at,
        'roster_confirmed_at', e.roster_confirmed_at
      ) from public.tournament_entries e
      where e.tournament_id = p_tournament_id and e.team_id = v_team.id
      order by e.created_at desc limit 1
    ),
    'roster_integrity_version', 1,
    'requests', v_requests,
    'candidates', v_candidates
  );
end;
$$;

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

  -- Finalization invokes this preview under its tournament row lock, BEFORE
  -- deleting results or applying any points/trophies. Include pending entries.
  if exists (
    select 1 from public.tournament_roster_players rp
    join public.tournament_entries e on e.id = rp.entry_id
    where e.tournament_id = p_tournament_id
      and e.status in ('pending', 'approved', 'checked_in')
      and rp.player_id is not null
    group by rp.player_id
    having count(distinct e.team_id) > 1
  ) then
    v_issues := v_issues || jsonb_build_array(
      'En spiller er registreret for flere aktive hold. Ret rosterne før afregning.'
    );
  end if;

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

revoke all on function public.submit_my_team_tournament_roster_v2(uuid, uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.submit_my_team_tournament_roster_v2(uuid, uuid[], uuid[], uuid[]) to authenticated;

revoke all on function public.submit_my_team_tournament_roster(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.submit_my_team_tournament_roster(uuid, uuid[], uuid[]) to authenticated;

revoke all on function public.respond_to_tournament_loan_request(uuid, text) from public, anon;
grant execute on function public.respond_to_tournament_loan_request(uuid, text) to authenticated;

revoke all on function public.cancel_my_tournament_loan_request(uuid) from public, anon;
grant execute on function public.cancel_my_tournament_loan_request(uuid) to authenticated;

revoke all on function public.get_my_tournament_loan_context(uuid, text) from public, anon;
grant execute on function public.get_my_tournament_loan_context(uuid, text) to authenticated;

revoke all on function public.admin_preview_tournament_settlement(uuid) from public, anon;
grant execute on function public.admin_preview_tournament_settlement(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
