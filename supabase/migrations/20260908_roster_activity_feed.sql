-- VCL Roster Market activity feed
-- Records public roster movement automatically from player state changes.
--
-- Covered events:
--   team -> team       = transfer
--   Free Agent -> team = signed_free_agent
--   team -> Free Agent = became_free_agent
--   no team -> market  = joined_roster_market
--
-- The future direct-transfer flow should update players.current_team_id directly
-- from the old team to the new team in one transaction. This trigger will then
-- create a single transfer event instead of a temporary Free Agent event.

begin;

create table if not exists public.roster_activity (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.players(id) on delete set null,
  event_type text not null,
  from_team_id uuid references public.teams(id) on delete set null,
  to_team_id uuid references public.teams(id) on delete set null,

  -- Snapshot fields keep old feed entries readable after renames/logo changes.
  player_alias text not null,
  player_slug text,
  player_avatar_url text,
  from_team_name text,
  from_team_slug text,
  from_team_logo_url text,
  to_team_name text,
  to_team_slug text,
  to_team_logo_url text,

  created_at timestamptz not null default now(),

  constraint roster_activity_event_type_check
    check (
      event_type in (
        'transfer',
        'signed_free_agent',
        'became_free_agent',
        'joined_roster_market',
        'joined_team'
      )
    )
);

create index if not exists roster_activity_created_at_idx
  on public.roster_activity (created_at desc);

create index if not exists roster_activity_player_idx
  on public.roster_activity (player_id, created_at desc);

create index if not exists roster_activity_event_type_idx
  on public.roster_activity (event_type, created_at desc);

alter table public.roster_activity enable row level security;

drop policy if exists "Public can read roster activity" on public.roster_activity;
create policy "Public can read roster activity"
on public.roster_activity
for select
to anon, authenticated
using (true);

revoke all on public.roster_activity from anon, authenticated;
grant select on public.roster_activity to anon, authenticated;

-- Public view intentionally exposes only display-safe snapshot fields.
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
  created_at
from public.roster_activity;

grant select on public.public_roster_activity_view to anon, authenticated;

create or replace function public.vcl_capture_roster_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text;

  v_from_name text;
  v_from_slug text;
  v_from_logo text;

  v_to_name text;
  v_to_slug text;
  v_to_logo text;
begin
  -- New player who enters VCL directly as a visible Free Agent.
  if tg_op = 'INSERT' then
    if coalesce(new.is_free_agent, false) = true
       and new.current_team_id is null then
      v_event_type := 'joined_roster_market';
    else
      return new;
    end if;
  else
    -- Permanent team relationship changed.
    if old.current_team_id is distinct from new.current_team_id then
      if old.current_team_id is not null
         and new.current_team_id is not null then
        v_event_type := 'transfer';

      elsif old.current_team_id is null
            and new.current_team_id is not null then
        -- A player moving from no permanent team to a team is treated as a
        -- Free Agency signing. This remains correct even if an existing RPC
        -- clears is_free_agent in a separate statement immediately beforehand.
        v_event_type := 'signed_free_agent';

      elsif old.current_team_id is not null
            and new.current_team_id is null then
        -- Existing roster-removal RPCs may set current_team_id and is_free_agent
        -- in the same statement or in two consecutive statements. Record the
        -- team exit here so both implementations produce the same feed event.
        v_event_type := 'became_free_agent';
      else
        return new;
      end if;

    -- Existing unrostered player becomes visible on the Roster Market.
    elsif coalesce(old.is_free_agent, false) = false
          and coalesce(new.is_free_agent, false) = true
          and new.current_team_id is null then

      -- If this status flip is the second statement of a team-removal flow,
      -- the became_free_agent event was already created above. Do not create a
      -- duplicate "joined Roster Market" event seconds later.
      if exists (
        select 1
        from public.roster_activity a
        where a.player_id = new.id
          and a.event_type = 'became_free_agent'
          and a.created_at >= now() - interval '5 minutes'
      ) then
        return new;
      end if;

      v_event_type := 'joined_roster_market';
    else
      return new;
    end if;
  end if;

  if tg_op = 'UPDATE' and old.current_team_id is not null then
    select t.name, t.slug, t.logo_url
      into v_from_name, v_from_slug, v_from_logo
    from public.teams t
    where t.id = old.current_team_id;
  end if;

  if new.current_team_id is not null then
    select t.name, t.slug, t.logo_url
      into v_to_name, v_to_slug, v_to_logo
    from public.teams t
    where t.id = new.current_team_id;
  end if;

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
    to_team_logo_url
  )
  values (
    new.id,
    v_event_type,
    case when tg_op = 'UPDATE' then old.current_team_id else null end,
    new.current_team_id,
    coalesce(nullif(trim(new.alias), ''), 'Ukendt spiller'),
    new.slug,
    new.avatar_url,
    v_from_name,
    v_from_slug,
    v_from_logo,
    v_to_name,
    v_to_slug,
    v_to_logo
  );

  return new;
end;
$$;

revoke all on function public.vcl_capture_roster_activity() from public;

drop trigger if exists vcl_capture_roster_activity_trigger on public.players;
create trigger vcl_capture_roster_activity_trigger
after insert or update of current_team_id, is_free_agent
on public.players
for each row
execute function public.vcl_capture_roster_activity();

commit;

notify pgrst, 'reload schema';
