-- VCL tournament loans / stand-ins
--
-- Adds tournament-specific stand-in requests without changing permanent team
-- membership. A captain can request a claimed player from another VCL team or
-- a claimed Free Agent. The player personally accepts or declines.
--
-- Accepted requests reserve the player for one team in one tournament. The
-- tournament roster submission RPC then stores the player as loan_team or
-- loan_free_agent and writes one public Roster Moves event.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- Tournament loan rules
-- ============================================================

alter table public.tournaments
  add column if not exists allows_loans boolean not null default true,
  add column if not exists max_loans integer not null default 2;

alter table public.tournaments
  drop constraint if exists tournaments_max_loans_check;

alter table public.tournaments
  add constraint tournaments_max_loans_check
  check (max_loans between 0 and 8);

-- ============================================================
-- Tournament-specific loan requests
-- ============================================================

create table if not exists public.tournament_loan_requests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  requesting_team_id uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  home_team_id uuid references public.teams(id) on delete set null,
  requested_by_player_id uuid not null references public.players(id) on delete cascade,
  entry_id uuid references public.tournament_entries(id) on delete set null,
  requested_role text not null,
  replaces_player_id uuid references public.players(id) on delete set null,
  status text not null default 'pending',
  message text not null default '',

  -- Snapshot labels keep old requests understandable after renames/transfers.
  player_alias_snapshot text not null,
  player_slug_snapshot text,
  player_avatar_url_snapshot text,
  primary_role_snapshot text,
  home_team_name_snapshot text,
  home_team_slug_snapshot text,
  home_team_logo_url_snapshot text,
  requesting_team_name_snapshot text not null,
  requesting_team_slug_snapshot text,
  requesting_team_logo_url_snapshot text,
  tournament_name_snapshot text not null,
  tournament_slug_snapshot text,
  replaces_player_alias_snapshot text,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,

  constraint tournament_loan_requests_role_check
    check (requested_role in ('starter', 'substitute')),
  constraint tournament_loan_requests_status_check
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'invalidated', 'expired')),
  constraint tournament_loan_requests_message_length_check
    check (char_length(message) <= 280)
);

create index if not exists tournament_loan_requests_tournament_idx
  on public.tournament_loan_requests (tournament_id, status, created_at desc);

create index if not exists tournament_loan_requests_player_idx
  on public.tournament_loan_requests (player_id, status, created_at desc);

create index if not exists tournament_loan_requests_team_idx
  on public.tournament_loan_requests (requesting_team_id, tournament_id, created_at desc);

create unique index if not exists tournament_loan_requests_one_pending_team_player_idx
  on public.tournament_loan_requests (tournament_id, requesting_team_id, player_id)
  where status = 'pending';

-- A player may receive several offers, but can only reserve one team in a given
-- tournament. The first accepted request wins and other pending offers are invalidated.
create unique index if not exists tournament_loan_requests_one_accepted_player_idx
  on public.tournament_loan_requests (tournament_id, player_id)
  where status = 'accepted';

alter table public.tournament_loan_requests enable row level security;

revoke all on public.tournament_loan_requests from public, anon, authenticated;

-- ============================================================
-- Roster Moves: add tournament loan event support
-- ============================================================

alter table public.roster_activity
  add column if not exists tournament_id uuid references public.tournaments(id) on delete set null,
  add column if not exists entry_id uuid references public.tournament_entries(id) on delete set null,
  add column if not exists loan_request_id uuid references public.tournament_loan_requests(id) on delete set null,
  add column if not exists tournament_name text,
  add column if not exists tournament_slug text;

alter table public.roster_activity
  drop constraint if exists roster_activity_event_type_check;

alter table public.roster_activity
  add constraint roster_activity_event_type_check
  check (
    event_type in (
      'transfer',
      'signed_free_agent',
      'became_free_agent',
      'joined_roster_market',
      'joined_team',
      'loan_from_team',
      'loan_free_agent'
    )
  );

create unique index if not exists roster_activity_loan_request_unique_idx
  on public.roster_activity (loan_request_id)
  where loan_request_id is not null;

-- Recreate the public view so the new tournament metadata is available to the
-- Roster Market UI. Existing display-safe fields keep their names/order.
drop view if exists public.public_roster_activity_view;
create view public.public_roster_activity_view
with (security_invoker = true)
as
select
  id,
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
  tournament_slug,
  created_at
from public.roster_activity;

grant select on public.public_roster_activity_view to anon, authenticated;

-- ============================================================
-- Shared locked-roster invariant
-- ============================================================

create or replace function public.vcl_guard_locked_tournament_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.current_team_id is not distinct from new.current_team_id then
    return new;
  end if;

  if exists (
    select 1
    from public.tournament_roster_players rp
    join public.tournament_entries e on e.id = rp.entry_id
    join public.tournaments t on t.id = e.tournament_id
    where rp.player_id = old.id
      and e.roster_locked_at is not null
      and e.status in ('approved', 'checked_in')
      and t.status in ('checkin', 'live')
  ) then
    raise exception 'Du er registreret på en låst tournament roster og kan ikke skifte permanent hold lige nu.';
  end if;

  return new;
end;
$$;

revoke all on function public.vcl_guard_locked_tournament_membership() from public;

drop trigger if exists vcl_guard_locked_tournament_membership_trigger on public.players;
create trigger vcl_guard_locked_tournament_membership_trigger
before update of current_team_id on public.players
for each row
execute function public.vcl_guard_locked_tournament_membership();

-- ============================================================
-- Captain: loan workspace / eligible candidates
-- ============================================================

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
  where id = p_tournament_id;

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
    order by lr.created_at desc
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
    'requests', v_requests,
    'candidates', v_candidates
  );
end;
$$;

revoke all on function public.get_my_tournament_loan_context(uuid, text) from public;
grant execute on function public.get_my_tournament_loan_context(uuid, text) to authenticated;

-- ============================================================
-- Captain: send a tournament loan request
-- ============================================================

create or replace function public.create_tournament_loan_request(
  p_tournament_id uuid,
  p_player_id uuid,
  p_requested_role text,
  p_replaces_player_id uuid default null,
  p_message text default ''
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
  v_player public.players%rowtype;
  v_home_team public.teams%rowtype;
  v_replaced public.players%rowtype;
  v_request public.tournament_loan_requests%rowtype;
  v_active_count integer;
  v_expires_at timestamptz;
  v_message text := left(trim(coalesce(p_message, '')), 280);
begin
  if auth.uid() is null then
    raise exception 'Du skal være logget ind.';
  end if;

  if p_player_id is null then
    raise exception 'Vælg en spiller først.';
  end if;

  if p_requested_role not in ('starter', 'substitute') then
    raise exception 'Vælg om stand-in spilleren skal være starter eller substitute.';
  end if;

  select * into v_captain
  from public.players
  where claimed_by_profile_id = auth.uid()
  limit 1;

  select * into v_team
  from public.teams
  where captain_player_id = v_captain.id
  limit 1;

  if v_team.id is null then
    raise exception 'Kun holdets captain kan sende en stand-in request.';
  end if;

  select * into v_tournament
  from public.tournaments
  where id = p_tournament_id
  for update;

  if v_tournament.id is null then
    raise exception 'Turneringen findes ikke.';
  end if;

  if v_tournament.status <> 'open' then
    raise exception 'Tournament rosteren er ikke længere åben.';
  end if;

  if coalesce(v_tournament.allows_loans, true) = false
     or coalesce(v_tournament.max_loans, 2) <= 0 then
    raise exception 'Denne turnering tillader ikke stand-ins / loans.';
  end if;

  if v_tournament.signup_opens_at is not null and v_tournament.signup_opens_at > now() then
    raise exception 'Tilmeldingen er ikke åbnet endnu.';
  end if;

  if v_tournament.signup_closes_at is not null and v_tournament.signup_closes_at <= now() then
    raise exception 'Tilmeldingsfristen er udløbet.';
  end if;

  if p_requested_role = 'substitute' and coalesce(v_tournament.max_substitutes, 2) = 0 then
    raise exception 'Denne turnering tillader ikke substitutes.';
  end if;

  select * into v_player
  from public.players
  where id = p_player_id
  for update;

  if v_player.id is null then
    raise exception 'Spilleren findes ikke.';
  end if;

  if v_player.claimed_by_profile_id is null then
    raise exception 'Spilleren skal have claimet sin VCL-profil for selv at kunne acceptere requesten.';
  end if;

  if v_player.current_team_id = v_team.id then
    raise exception 'Spilleren er allerede på dit permanente hold.';
  end if;

  if v_player.current_team_id is null and coalesce(v_player.is_free_agent, false) = false then
    raise exception 'Spilleren er ikke aktiv Free Agent og har intet VCL-hold.';
  end if;

  if v_player.current_team_id is not null then
    select * into v_home_team
    from public.teams
    where id = v_player.current_team_id;
  end if;

  if exists (
    select 1
    from public.tournament_roster_players rp
    join public.tournament_entries e on e.id = rp.entry_id
    where e.tournament_id = p_tournament_id
      and e.status not in ('rejected', 'withdrawn', 'disqualified')
      and rp.player_id = v_player.id
  ) then
    raise exception 'Spilleren er allerede registreret for et andet hold i denne turnering.';
  end if;

  if exists (
    select 1
    from public.tournament_loan_requests lr
    where lr.tournament_id = p_tournament_id
      and lr.player_id = v_player.id
      and lr.status = 'accepted'
  ) then
    raise exception 'Spilleren er allerede reserveret som stand-in for et andet hold i denne turnering.';
  end if;

  update public.tournament_loan_requests
  set status = 'expired', responded_at = coalesce(responded_at, now())
  where tournament_id = p_tournament_id
    and requesting_team_id = v_team.id
    and player_id = v_player.id
    and status = 'pending'
    and expires_at <= now();

  if exists (
    select 1
    from public.tournament_loan_requests
    where tournament_id = p_tournament_id
      and requesting_team_id = v_team.id
      and player_id = v_player.id
      and status = 'pending'
  ) then
    raise exception 'Dit hold har allerede en aktiv stand-in request til denne spiller.';
  end if;

  select count(*) into v_active_count
  from public.tournament_loan_requests
  where tournament_id = p_tournament_id
    and requesting_team_id = v_team.id
    and status in ('pending', 'accepted');

  if v_active_count >= coalesce(v_tournament.max_loans, 2) then
    raise exception 'I kan højst have % aktive stand-in requests til denne turnering.', coalesce(v_tournament.max_loans, 2);
  end if;

  if p_replaces_player_id is not null then
    if not exists (
      select 1
      from public.team_members tm
      where tm.team_id = v_team.id
        and tm.player_id = p_replaces_player_id
        and tm.left_at is null
    ) then
      raise exception 'Spilleren der erstattes skal være på dit holds aktive roster.';
    end if;

    select * into v_replaced
    from public.players
    where id = p_replaces_player_id;
  end if;

  v_expires_at := now() + interval '72 hours';
  if v_tournament.signup_closes_at is not null then
    v_expires_at := least(v_expires_at, v_tournament.signup_closes_at);
  end if;

  insert into public.tournament_loan_requests (
    tournament_id,
    requesting_team_id,
    player_id,
    home_team_id,
    requested_by_player_id,
    requested_role,
    replaces_player_id,
    status,
    message,
    player_alias_snapshot,
    player_slug_snapshot,
    player_avatar_url_snapshot,
    primary_role_snapshot,
    home_team_name_snapshot,
    home_team_slug_snapshot,
    home_team_logo_url_snapshot,
    requesting_team_name_snapshot,
    requesting_team_slug_snapshot,
    requesting_team_logo_url_snapshot,
    tournament_name_snapshot,
    tournament_slug_snapshot,
    replaces_player_alias_snapshot,
    expires_at
  ) values (
    v_tournament.id,
    v_team.id,
    v_player.id,
    v_player.current_team_id,
    v_captain.id,
    p_requested_role,
    p_replaces_player_id,
    'pending',
    v_message,
    v_player.alias,
    v_player.slug,
    v_player.avatar_url,
    v_player.primary_role,
    v_home_team.name,
    v_home_team.slug,
    v_home_team.logo_url,
    v_team.name,
    v_team.slug,
    v_team.logo_url,
    v_tournament.name,
    v_tournament.slug,
    v_replaced.alias,
    v_expires_at
  )
  returning * into v_request;

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'player_id', v_request.player_id,
    'player_alias', v_request.player_alias_snapshot,
    'requested_role', v_request.requested_role,
    'replaces_player_id', v_request.replaces_player_id,
    'expires_at', v_request.expires_at
  );
end;
$$;

revoke all on function public.create_tournament_loan_request(uuid, uuid, text, uuid, text) from public;
grant execute on function public.create_tournament_loan_request(uuid, uuid, text, uuid, text) to authenticated;

-- ============================================================
-- Player: read incoming loan requests
-- ============================================================

create or replace function public.get_my_tournament_loan_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_requests jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('requests', '[]'::jsonb);
  end if;

  select * into v_player
  from public.players
  where claimed_by_profile_id = auth.uid()
  limit 1;

  if v_player.id is null then
    return jsonb_build_object('requests', '[]'::jsonb);
  end if;

  update public.tournament_loan_requests
  set status = 'expired', responded_at = coalesce(responded_at, now())
  where player_id = v_player.id
    and status = 'pending'
    and expires_at <= now();

  update public.tournament_loan_requests lr
  set status = 'invalidated', responded_at = coalesce(lr.responded_at, now())
  from public.tournaments t
  where lr.player_id = v_player.id
    and lr.status = 'pending'
    and t.id = lr.tournament_id
    and t.status <> 'open';

  update public.tournament_loan_requests lr
  set status = 'invalidated', responded_at = coalesce(lr.responded_at, now())
  where lr.player_id = v_player.id
    and lr.status = 'pending'
    and (
      (lr.home_team_id is null and (v_player.current_team_id is not null or coalesce(v_player.is_free_agent, false) = false))
      or
      (lr.home_team_id is not null and v_player.current_team_id is distinct from lr.home_team_id)
    );

  select coalesce(jsonb_agg(to_jsonb(request_row) order by request_row.created_at desc), '[]'::jsonb)
  into v_requests
  from (
    select
      lr.id,
      lr.tournament_id,
      lr.tournament_name_snapshot as tournament_name,
      lr.tournament_slug_snapshot as tournament_slug,
      lr.requesting_team_id,
      lr.requesting_team_name_snapshot as requesting_team_name,
      lr.requesting_team_slug_snapshot as requesting_team_slug,
      lr.requesting_team_logo_url_snapshot as requesting_team_logo_url,
      lr.home_team_id,
      lr.home_team_name_snapshot as home_team_name,
      lr.home_team_slug_snapshot as home_team_slug,
      lr.home_team_logo_url_snapshot as home_team_logo_url,
      lr.requested_role,
      lr.replaces_player_id,
      lr.replaces_player_alias_snapshot as replaces_player_alias,
      lr.message,
      lr.created_at,
      lr.expires_at
    from public.tournament_loan_requests lr
    where lr.player_id = v_player.id
      and lr.status = 'pending'
      and lr.expires_at > now()
    order by lr.created_at desc
  ) request_row;

  return jsonb_build_object('requests', v_requests);
end;
$$;

revoke all on function public.get_my_tournament_loan_requests() from public;
grant execute on function public.get_my_tournament_loan_requests() to authenticated;

-- ============================================================
-- Player: accept / decline a loan request
-- ============================================================

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

  if p_decision not in ('accept', 'decline') then
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
  where id = p_request_id
  for update;

  if v_request.id is null or v_request.player_id <> v_player.id then
    raise exception 'Stand-in requesten kunne ikke findes.';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Stand-in requesten er ikke længere aktiv.';
  end if;

  select * into v_tournament
  from public.tournaments
  where id = v_request.tournament_id
  for update;

  if v_request.expires_at <= now()
     or v_tournament.status <> 'open'
     or (v_tournament.signup_closes_at is not null and v_tournament.signup_closes_at <= now()) then
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
    raise exception 'Din permanente holdstatus har ændret sig. Captain skal sende en ny stand-in request.';
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

revoke all on function public.respond_to_tournament_loan_request(uuid, text) from public;
grant execute on function public.respond_to_tournament_loan_request(uuid, text) to authenticated;

-- ============================================================
-- Captain: cancel an unanswered / unused accepted request
-- ============================================================

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
begin
  if auth.uid() is null then
    raise exception 'Du skal være logget ind.';
  end if;

  select * into v_captain
  from public.players
  where claimed_by_profile_id = auth.uid()
  limit 1;

  select * into v_team
  from public.teams
  where captain_player_id = v_captain.id
  limit 1;

  if v_team.id is null then
    raise exception 'Kun holdets captain kan annullere stand-in requests.';
  end if;

  select * into v_request
  from public.tournament_loan_requests
  where id = p_request_id
  for update;

  if v_request.id is null or v_request.requesting_team_id <> v_team.id then
    raise exception 'Stand-in requesten kunne ikke findes.';
  end if;

  if v_request.status not in ('pending', 'accepted') then
    raise exception 'Denne stand-in request kan ikke længere annulleres.';
  end if;

  select * into v_tournament
  from public.tournaments
  where id = v_request.tournament_id;

  if v_tournament.status <> 'open' then
    raise exception 'Tournament rosteren er låst.';
  end if;

  if v_request.status = 'accepted' and v_request.entry_id is not null then
    raise exception 'Stand-in spilleren er allerede gemt i tournament rosteren. Erstat spilleren i roster-flowet før VCL låser turneringen.';
  end if;

  update public.tournament_loan_requests
  set status = 'cancelled', responded_at = coalesce(responded_at, now())
  where id = v_request.id
  returning * into v_request;

  return jsonb_build_object('id', v_request.id, 'status', v_request.status);
end;
$$;

revoke all on function public.cancel_my_tournament_loan_request(uuid) from public;
grant execute on function public.cancel_my_tournament_loan_request(uuid) to authenticated;

-- ============================================================
-- Captain: submit permanent members + accepted loans atomically
-- ============================================================

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

  if v_tournament.status <> 'open' then
    raise exception 'Turneringen er ikke åben for rosterændringer.';
  end if;

  if v_tournament.signup_opens_at is not null and v_tournament.signup_opens_at > now() then
    raise exception 'Tilmeldingen er ikke åbnet endnu.';
  end if;

  if v_tournament.signup_closes_at is not null and v_tournament.signup_closes_at <= now() then
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

  if exists (
    select 1
    from public.tournament_loan_requests lr
    join public.tournament_roster_players rp on rp.player_id = lr.player_id
    join public.tournament_entries other_entry on other_entry.id = rp.entry_id
    where lr.id = any(coalesce(p_loan_request_ids, '{}'::uuid[]))
      and other_entry.tournament_id = p_tournament_id
      and other_entry.team_id is distinct from v_team.id
      and other_entry.status not in ('rejected', 'withdrawn', 'disqualified')
  ) then
    raise exception 'En stand-in er allerede registreret for et andet hold i denne turnering.';
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

revoke all on function public.submit_my_team_tournament_roster_v2(uuid, uuid[], uuid[], uuid[]) from public;
grant execute on function public.submit_my_team_tournament_roster_v2(uuid, uuid[], uuid[], uuid[]) to authenticated;

-- ============================================================
-- Public tournament roster view: expose loan source context
-- ============================================================

drop view if exists public.public_tournament_roster_view;
create view public.public_tournament_roster_view
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
  home_team.name as home_team_name,
  home_team.slug as home_team_slug,
  rp.replaces_player_id,
  replaced.alias as replaces_player_alias,
  rp.created_at
from public.tournament_roster_players rp
join public.tournament_entries e on e.id = rp.entry_id
left join public.teams home_team on home_team.id = rp.home_team_id
left join public.players replaced on replaced.id = rp.replaces_player_id
where e.status in ('approved', 'checked_in');

grant select on public.public_tournament_roster_view to anon, authenticated;

-- Pending requests die when registration closes. Accepted requests remain as
-- roster reservations/history and the existing tournament-roster trigger locks
-- the actual submitted lineups.
create or replace function public.vcl_close_pending_tournament_loans()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'open' and new.status <> 'open' then
    update public.tournament_loan_requests
    set status = 'invalidated', responded_at = coalesce(responded_at, now())
    where tournament_id = new.id
      and status = 'pending';
  end if;

  return new;
end;
$$;

revoke all on function public.vcl_close_pending_tournament_loans() from public;

drop trigger if exists vcl_close_pending_tournament_loans_trigger on public.tournaments;
create trigger vcl_close_pending_tournament_loans_trigger
after update of status on public.tournaments
for each row
execute function public.vcl_close_pending_tournament_loans();

commit;

notify pgrst, 'reload schema';
