-- VCL direct permanent team transfers
--
-- Captain of Team B may invite a claimed player currently belonging to Team A.
-- The player must personally accept. Acceptance moves players.current_team_id
-- directly from Team A -> Team B in one transaction, so the existing
-- roster_activity trigger records one clean `transfer` event.
--
-- Newly transferred players enter the receiving permanent roster as `bench`.
-- The receiving captain may promote them afterwards from Team Dashboard.

begin;

create extension if not exists pgcrypto;

create table if not exists public.player_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  from_team_id uuid not null references public.teams(id) on delete cascade,
  to_team_id uuid not null references public.teams(id) on delete cascade,
  requested_by_player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'pending',
  message text not null default '',

  -- Snapshot fields keep old transfer requests/history readable after renames.
  player_alias_snapshot text not null,
  player_slug_snapshot text,
  player_avatar_url_snapshot text,
  from_team_name_snapshot text not null,
  from_team_slug_snapshot text,
  from_team_logo_url_snapshot text,
  to_team_name_snapshot text not null,
  to_team_slug_snapshot text,
  to_team_logo_url_snapshot text,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  responded_at timestamptz,

  constraint player_transfer_requests_different_teams_check
    check (from_team_id <> to_team_id),
  constraint player_transfer_requests_status_check
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'invalidated', 'expired')),
  constraint player_transfer_requests_message_length_check
    check (char_length(message) <= 280)
);

create index if not exists player_transfer_requests_player_idx
  on public.player_transfer_requests (player_id, created_at desc);

create index if not exists player_transfer_requests_from_team_idx
  on public.player_transfer_requests (from_team_id, created_at desc);

create index if not exists player_transfer_requests_to_team_idx
  on public.player_transfer_requests (to_team_id, created_at desc);

create unique index if not exists player_transfer_requests_one_pending_per_team_idx
  on public.player_transfer_requests (to_team_id, player_id)
  where status = 'pending';

alter table public.player_transfer_requests enable row level security;

-- Direct browser table access is intentionally disabled. All reads/writes happen
-- through security-definer RPCs below so captains/players only see their own data.
revoke all on public.player_transfer_requests from public, anon, authenticated;

-- ============================================================
-- Captain helper: eligible players on OTHER permanent teams
-- ============================================================

create or replace function public.get_my_team_transfer_candidates(
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
  v_search text := nullif(trim(coalesce(p_search, '')), '');
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
    raise exception 'Kun holdets captain kan sende transferanmodninger.';
  end if;

  -- Clean up stale requests sent by this team before candidates are rendered.
  update public.player_transfer_requests r
  set status = 'expired', responded_at = coalesce(responded_at, now())
  where r.to_team_id = v_team.id
    and r.status = 'pending'
    and r.expires_at <= now();

  update public.player_transfer_requests r
  set status = 'invalidated', responded_at = coalesce(responded_at, now())
  from public.players p
  where r.to_team_id = v_team.id
    and r.status = 'pending'
    and p.id = r.player_id
    and p.current_team_id is distinct from r.from_team_id;

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
      p.current_team_id,
      source_team.name as current_team_name,
      source_team.slug as current_team_slug,
      source_team.logo_url as current_team_logo_url,
      pending.id as pending_request_id,
      pending.created_at as pending_requested_at,
      pending.expires_at as pending_expires_at
    from public.players p
    join public.teams source_team on source_team.id = p.current_team_id
    left join public.player_transfer_requests pending
      on pending.player_id = p.id
      and pending.to_team_id = v_team.id
      and pending.status = 'pending'
    where p.current_team_id is not null
      and p.current_team_id <> v_team.id
      and p.claimed_by_profile_id is not null
      -- A team captain must transfer captain ownership before leaving their team.
      and not exists (
        select 1
        from public.teams captain_team
        where captain_team.captain_player_id = p.id
      )
      and (
        v_search is null
        or p.alias ilike '%' || v_search || '%'
        or source_team.name ilike '%' || v_search || '%'
        or coalesce(p.primary_role, '') ilike '%' || v_search || '%'
      )
    order by p.alias
    limit 50
  ) candidate_row;

  return jsonb_build_object(
    'team', jsonb_build_object(
      'id', v_team.id,
      'name', v_team.name,
      'slug', v_team.slug,
      'logo_url', v_team.logo_url
    ),
    'candidates', v_candidates
  );
end;
$$;

revoke all on function public.get_my_team_transfer_candidates(text) from public;
grant execute on function public.get_my_team_transfer_candidates(text) to authenticated;

-- ============================================================
-- Captain: create a direct transfer request
-- ============================================================

create or replace function public.create_player_transfer_request(
  p_player_id uuid,
  p_message text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captain public.players%rowtype;
  v_to_team public.teams%rowtype;
  v_player public.players%rowtype;
  v_from_team public.teams%rowtype;
  v_request public.player_transfer_requests%rowtype;
  v_message text := left(trim(coalesce(p_message, '')), 280);
begin
  if auth.uid() is null then
    raise exception 'Du skal være logget ind.';
  end if;

  if p_player_id is null then
    raise exception 'Vælg en spiller først.';
  end if;

  select * into v_captain
  from public.players
  where claimed_by_profile_id = auth.uid()
  limit 1;

  if v_captain.id is null then
    raise exception 'Din account er ikke koblet til en VCL-spillerprofil.';
  end if;

  select * into v_to_team
  from public.teams
  where captain_player_id = v_captain.id
  limit 1;

  if v_to_team.id is null then
    raise exception 'Kun holdets captain kan sende transferanmodninger.';
  end if;

  select * into v_player
  from public.players
  where id = p_player_id
  for update;

  if v_player.id is null then
    raise exception 'Spilleren findes ikke.';
  end if;

  if v_player.claimed_by_profile_id is null then
    raise exception 'Spilleren skal have claimet sin VCL-profil før en direkte transfer kan sendes.';
  end if;

  if v_player.current_team_id is null then
    raise exception 'Spilleren er Free Agent. Brug den normale Roster Market-invitation i stedet.';
  end if;

  if v_player.current_team_id = v_to_team.id then
    raise exception 'Spilleren er allerede på dit hold.';
  end if;

  if exists (
    select 1 from public.teams t
    where t.captain_player_id = v_player.id
  ) then
    raise exception 'En captain skal overdrage captain-rollen, før spilleren kan transferes.';
  end if;

  select * into v_from_team
  from public.teams
  where id = v_player.current_team_id;

  if v_from_team.id is null then
    raise exception 'Spillerens nuværende hold kunne ikke findes.';
  end if;

  update public.player_transfer_requests
  set status = 'expired', responded_at = coalesce(responded_at, now())
  where to_team_id = v_to_team.id
    and player_id = v_player.id
    and status = 'pending'
    and expires_at <= now();

  if exists (
    select 1
    from public.player_transfer_requests
    where to_team_id = v_to_team.id
      and player_id = v_player.id
      and status = 'pending'
  ) then
    raise exception 'Dit hold har allerede en aktiv transferanmodning til denne spiller.';
  end if;

  insert into public.player_transfer_requests (
    player_id,
    from_team_id,
    to_team_id,
    requested_by_player_id,
    status,
    message,
    player_alias_snapshot,
    player_slug_snapshot,
    player_avatar_url_snapshot,
    from_team_name_snapshot,
    from_team_slug_snapshot,
    from_team_logo_url_snapshot,
    to_team_name_snapshot,
    to_team_slug_snapshot,
    to_team_logo_url_snapshot
  ) values (
    v_player.id,
    v_from_team.id,
    v_to_team.id,
    v_captain.id,
    'pending',
    v_message,
    v_player.alias,
    v_player.slug,
    v_player.avatar_url,
    v_from_team.name,
    v_from_team.slug,
    v_from_team.logo_url,
    v_to_team.name,
    v_to_team.slug,
    v_to_team.logo_url
  )
  returning * into v_request;

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'player_id', v_request.player_id,
    'player_alias', v_request.player_alias_snapshot,
    'from_team_id', v_request.from_team_id,
    'from_team_name', v_request.from_team_name_snapshot,
    'to_team_id', v_request.to_team_id,
    'to_team_name', v_request.to_team_name_snapshot,
    'message', v_request.message,
    'created_at', v_request.created_at,
    'expires_at', v_request.expires_at
  );
end;
$$;

revoke all on function public.create_player_transfer_request(uuid, text) from public;
grant execute on function public.create_player_transfer_request(uuid, text) to authenticated;

-- ============================================================
-- Captain: own sent requests + accepted transfers involving own team
-- ============================================================

create or replace function public.get_my_captain_transfer_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captain public.players%rowtype;
  v_team public.teams%rowtype;
  v_requests jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Du skal være logget ind.';
  end if;

  select * into v_captain
  from public.players
  where claimed_by_profile_id = auth.uid()
  limit 1;

  if v_captain.id is null then
    return jsonb_build_object('team', null, 'requests', '[]'::jsonb);
  end if;

  select * into v_team
  from public.teams
  where captain_player_id = v_captain.id
  limit 1;

  if v_team.id is null then
    return jsonb_build_object('team', null, 'requests', '[]'::jsonb);
  end if;

  update public.player_transfer_requests r
  set status = 'expired', responded_at = coalesce(responded_at, now())
  where r.to_team_id = v_team.id
    and r.status = 'pending'
    and r.expires_at <= now();

  update public.player_transfer_requests r
  set status = 'invalidated', responded_at = coalesce(responded_at, now())
  from public.players p
  where r.to_team_id = v_team.id
    and r.status = 'pending'
    and p.id = r.player_id
    and p.current_team_id is distinct from r.from_team_id;

  select coalesce(jsonb_agg(to_jsonb(history_row) order by history_row.created_at desc), '[]'::jsonb)
  into v_requests
  from (
    select
      r.id,
      r.player_id,
      r.player_alias_snapshot as player_alias,
      r.player_slug_snapshot as player_slug,
      r.player_avatar_url_snapshot as player_avatar_url,
      r.from_team_id,
      r.from_team_name_snapshot as from_team_name,
      r.from_team_slug_snapshot as from_team_slug,
      r.from_team_logo_url_snapshot as from_team_logo_url,
      r.to_team_id,
      r.to_team_name_snapshot as to_team_name,
      r.to_team_slug_snapshot as to_team_slug,
      r.to_team_logo_url_snapshot as to_team_logo_url,
      r.status,
      r.message,
      r.created_at,
      r.expires_at,
      r.responded_at,
      case
        when r.status = 'accepted' and r.from_team_id = v_team.id then 'out'
        when r.to_team_id = v_team.id then 'in'
        else 'other'
      end as direction
    from public.player_transfer_requests r
    where
      -- Captains see their own outgoing invitations in every state.
      r.to_team_id = v_team.id
      -- The old team only sees a move after the player has actually accepted it.
      or (r.from_team_id = v_team.id and r.status = 'accepted')
    order by r.created_at desc
    limit 50
  ) history_row;

  return jsonb_build_object(
    'team', jsonb_build_object(
      'id', v_team.id,
      'name', v_team.name,
      'slug', v_team.slug,
      'logo_url', v_team.logo_url
    ),
    'requests', v_requests
  );
end;
$$;

revoke all on function public.get_my_captain_transfer_requests() from public;
grant execute on function public.get_my_captain_transfer_requests() to authenticated;

create or replace function public.cancel_my_player_transfer_request(
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
  v_request public.player_transfer_requests%rowtype;
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
    raise exception 'Kun holdets captain kan annullere en transferanmodning.';
  end if;

  select * into v_request
  from public.player_transfer_requests
  where id = p_request_id
  for update;

  if v_request.id is null or v_request.to_team_id <> v_team.id then
    raise exception 'Transferanmodningen kunne ikke findes.';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Kun aktive transferanmodninger kan annulleres.';
  end if;

  update public.player_transfer_requests
  set status = 'cancelled', responded_at = now()
  where id = v_request.id
  returning * into v_request;

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'player_alias', v_request.player_alias_snapshot
  );
end;
$$;

revoke all on function public.cancel_my_player_transfer_request(uuid) from public;
grant execute on function public.cancel_my_player_transfer_request(uuid) to authenticated;

-- ============================================================
-- Player: own incoming direct-transfer requests
-- ============================================================

create or replace function public.get_my_player_transfer_requests()
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
    return jsonb_build_object('player', null, 'requests', '[]'::jsonb);
  end if;

  select * into v_player
  from public.players
  where claimed_by_profile_id = auth.uid()
  limit 1;

  if v_player.id is null then
    return jsonb_build_object('player', null, 'requests', '[]'::jsonb);
  end if;

  update public.player_transfer_requests r
  set status = 'expired', responded_at = coalesce(responded_at, now())
  where r.player_id = v_player.id
    and r.status = 'pending'
    and r.expires_at <= now();

  update public.player_transfer_requests r
  set status = 'invalidated', responded_at = coalesce(responded_at, now())
  where r.player_id = v_player.id
    and r.status = 'pending'
    and (
      v_player.current_team_id is distinct from r.from_team_id
      or not exists (
        select 1
        from public.teams destination
        where destination.id = r.to_team_id
          and destination.captain_player_id = r.requested_by_player_id
      )
    );

  select coalesce(jsonb_agg(to_jsonb(request_row) order by request_row.created_at desc), '[]'::jsonb)
  into v_requests
  from (
    select
      r.id,
      r.player_id,
      r.player_alias_snapshot as player_alias,
      r.from_team_id,
      r.from_team_name_snapshot as from_team_name,
      r.from_team_slug_snapshot as from_team_slug,
      r.from_team_logo_url_snapshot as from_team_logo_url,
      r.to_team_id,
      r.to_team_name_snapshot as to_team_name,
      r.to_team_slug_snapshot as to_team_slug,
      r.to_team_logo_url_snapshot as to_team_logo_url,
      r.message,
      r.created_at,
      r.expires_at
    from public.player_transfer_requests r
    where r.player_id = v_player.id
      and r.status = 'pending'
    order by r.created_at desc
  ) request_row;

  return jsonb_build_object(
    'player', jsonb_build_object(
      'id', v_player.id,
      'alias', v_player.alias,
      'current_team_id', v_player.current_team_id
    ),
    'requests', v_requests
  );
end;
$$;

revoke all on function public.get_my_player_transfer_requests() from public;
grant execute on function public.get_my_player_transfer_requests() to authenticated;

-- ============================================================
-- Player: accept/decline. Acceptance is the atomic permanent transfer.
-- ============================================================

create or replace function public.respond_to_player_transfer_request(
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
  v_request public.player_transfer_requests%rowtype;
  v_from_team public.teams%rowtype;
  v_to_team public.teams%rowtype;
  v_existing_target_member_id uuid;
  v_changed integer := 0;
  v_decision text := lower(trim(coalesce(p_decision, '')));
begin
  if auth.uid() is null then
    raise exception 'Du skal være logget ind.';
  end if;

  if v_decision not in ('accept', 'decline') then
    raise exception 'Svar skal være accept eller decline.';
  end if;

  select * into v_player
  from public.players
  where claimed_by_profile_id = auth.uid()
  limit 1
  for update;

  if v_player.id is null then
    raise exception 'Din account er ikke koblet til en VCL-spillerprofil.';
  end if;

  select * into v_request
  from public.player_transfer_requests
  where id = p_request_id
    and player_id = v_player.id
  for update;

  if v_request.id is null then
    raise exception 'Transferanmodningen kunne ikke findes.';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Transferanmodningen er ikke længere aktiv.';
  end if;

  if v_request.expires_at <= now() then
    update public.player_transfer_requests
    set status = 'expired', responded_at = now()
    where id = v_request.id;

    return jsonb_build_object(
      'id', v_request.id,
      'status', 'expired',
      'message', 'Transferanmodningen er udløbet.'
    );
  end if;

  if v_decision = 'decline' then
    update public.player_transfer_requests
    set status = 'declined', responded_at = now()
    where id = v_request.id
    returning * into v_request;

    return jsonb_build_object(
      'id', v_request.id,
      'status', v_request.status,
      'player_alias', v_request.player_alias_snapshot,
      'to_team_name', v_request.to_team_name_snapshot
    );
  end if;

  if v_player.current_team_id is distinct from v_request.from_team_id then
    raise exception 'Du tilhører ikke længere det hold, transferanmodningen blev sendt fra.';
  end if;

  select * into v_from_team
  from public.teams
  where id = v_request.from_team_id
  for update;

  select * into v_to_team
  from public.teams
  where id = v_request.to_team_id
  for update;

  if v_from_team.id is null or v_to_team.id is null then
    raise exception 'Et af holdene findes ikke længere.';
  end if;

  if v_from_team.captain_player_id = v_player.id then
    raise exception 'Overdrag captain-rollen, før du kan acceptere en transfer.';
  end if;

  if v_to_team.captain_player_id is distinct from v_request.requested_by_player_id then
    raise exception 'Captain-rollen på det inviterende hold er ændret. Bed den nye captain sende en ny anmodning.';
  end if;

  -- A player already committed to a locked active tournament roster should not
  -- silently change permanent teams mid-event. Completed/archived events do not block.
  if exists (
    select 1
    from public.tournament_roster_players trp
    join public.tournament_entries e on e.id = trp.entry_id
    join public.tournaments t on t.id = e.tournament_id
    where trp.player_id = v_player.id
      and e.team_id = v_request.from_team_id
      and e.roster_locked_at is not null
      and t.status in ('checkin', 'live')
  ) then
    raise exception 'Du er registreret på en låst aktiv tournament roster. Transferen kan gennemføres, når turneringen ikke længere er aktiv.';
  end if;

  -- Close every active membership row first. The player row itself is NOT moved
  -- through NULL / Free Agency; current_team_id changes directly below.
  update public.team_members
  set left_at = now()
  where player_id = v_player.id
    and left_at is null;

  -- Reuse a historical membership row if the player has previously represented
  -- the receiving team; otherwise create a new permanent membership row.
  select tm.id into v_existing_target_member_id
  from public.team_members tm
  where tm.player_id = v_player.id
    and tm.team_id = v_to_team.id
  order by tm.joined_at desc nulls last, tm.id
  limit 1
  for update;

  if v_existing_target_member_id is not null then
    update public.team_members
    set
      member_role = 'player',
      roster_status = 'bench',
      joined_at = now(),
      left_at = null
    where id = v_existing_target_member_id;
  else
    insert into public.team_members (
      team_id,
      player_id,
      member_role,
      roster_status,
      joined_at,
      left_at
    ) values (
      v_to_team.id,
      v_player.id,
      'player',
      'bench',
      now(),
      null
    );
  end if;

  -- CRITICAL: direct Team A -> Team B update. Do not set current_team_id to NULL
  -- first. The roster_activity trigger will therefore create exactly one transfer.
  update public.players
  set
    current_team_id = v_to_team.id,
    is_free_agent = false,
    updated_at = now()
  where id = v_player.id
    and current_team_id = v_from_team.id;

  get diagnostics v_changed = row_count;

  if v_changed <> 1 then
    raise exception 'Spillerens hold ændrede sig under transferen. Prøv igen.';
  end if;

  update public.player_transfer_requests
  set status = 'accepted', responded_at = now()
  where id = v_request.id
  returning * into v_request;

  -- Once the player has moved, every other direct-transfer request is stale.
  update public.player_transfer_requests
  set status = 'invalidated', responded_at = now()
  where player_id = v_player.id
    and id <> v_request.id
    and status = 'pending';

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'player_id', v_player.id,
    'player_alias', v_request.player_alias_snapshot,
    'from_team_id', v_request.from_team_id,
    'from_team_name', v_request.from_team_name_snapshot,
    'to_team_id', v_request.to_team_id,
    'to_team_name', v_request.to_team_name_snapshot,
    'roster_status', 'bench'
  );
end;
$$;

revoke all on function public.respond_to_player_transfer_request(uuid, text) from public;
grant execute on function public.respond_to_player_transfer_request(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';
