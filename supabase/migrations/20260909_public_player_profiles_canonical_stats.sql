-- VCL 2.1 stabilization
-- Make public_player_profiles_view read the canonical counters on players.
-- Keeps the existing public view shape intact while removing its dependency
-- on the legacy player_stats table.

begin;

create or replace view public.public_player_profiles_view
with (security_invoker = true)
as
select
  p.id as player_id,
  p.slug as player_slug,
  p.alias,
  p.discord,
  p.primary_role,
  p.level,
  p.bio,
  p.is_free_agent,
  p.claim_status,
  p.current_team_id,
  t.name as current_team_name,
  coalesce(p.points, 0) as points,
  coalesce(p.championship_wins, 0) as championship_wins,
  coalesce(p.contender_wins, 0) as contender_wins,
  coalesce(p.academy_wins, 0) as academy_wins
from public.players p
left join public.teams t on t.id = p.current_team_id
where p.claim_status <> 'retired'::text;

grant select on public.public_player_profiles_view to anon, authenticated;

notify pgrst, 'reload schema';

commit;
