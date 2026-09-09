-- VCL 2.1 stabilization
-- READ ONLY
-- Purpose: inspect the legacy events/player_placements history cluster before removing anything.

select
  '01_COUNTS' as section,
  'events_history_cluster' as object_name,
  jsonb_build_object(
    'events_rows', (select count(*) from public.events),
    'player_placements_rows', (select count(*) from public.player_placements),
    'team_achievements_rows', (select count(*) from public.team_achievements),
    'team_achievements_with_event', (select count(*) from public.team_achievements where event_id is not null)
  ) as details;

select
  '02_EVENT_SAMPLE' as section,
  coalesce(e.slug, e.id::text) as object_name,
  jsonb_build_object(
    'id', e.id,
    'slug', e.slug,
    'name', e.name,
    'event_date', e.event_date,
    'placement_rows', (select count(*) from public.player_placements pp where pp.event_id = e.id),
    'achievement_rows', (select count(*) from public.team_achievements ta where ta.event_id = e.id)
  ) as details
from public.events e
order by e.event_date desc nulls last, e.name
limit 15;
