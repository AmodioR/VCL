-- VCL 2.1 stabilization
-- READ ONLY
-- Final safety check before retiring public.player_stats.

select
  '01_COUNTS' as section,
  'player_stats' as object_name,
  jsonb_build_object(
    'player_stats_rows', (select count(*) from public.player_stats),
    'players_rows', (select count(*) from public.players),
    'player_stats_without_player', (
      select count(*)
      from public.player_stats s
      left join public.players p on p.id = s.player_id
      where p.id is null
    )
  ) as details

union all

select
  '02_DATA_COMPARE' as section,
  'player_stats_vs_players' as object_name,
  jsonb_build_object(
    'different_points', (
      select count(*)
      from public.player_stats s
      join public.players p on p.id = s.player_id
      where coalesce(s.points, 0) <> coalesce(p.points, 0)
    ),
    'different_championship_wins', (
      select count(*)
      from public.player_stats s
      join public.players p on p.id = s.player_id
      where coalesce(s.championship_wins, 0) <> coalesce(p.championship_wins, 0)
    ),
    'different_contender_wins', (
      select count(*)
      from public.player_stats s
      join public.players p on p.id = s.player_id
      where coalesce(s.contender_wins, 0) <> coalesce(p.contender_wins, 0)
    ),
    'different_academy_wins', (
      select count(*)
      from public.player_stats s
      join public.players p on p.id = s.player_id
      where coalesce(s.academy_wins, 0) <> coalesce(p.academy_wins, 0)
    )
  ) as details

union all

select
  '03_SAMPLE' as section,
  coalesce(p.alias, s.player_id::text) as object_name,
  jsonb_build_object(
    'player_id', s.player_id,
    'legacy_points', s.points,
    'canonical_points', p.points,
    'legacy_championship_wins', s.championship_wins,
    'canonical_championship_wins', p.championship_wins,
    'legacy_contender_wins', s.contender_wins,
    'canonical_contender_wins', p.contender_wins,
    'legacy_academy_wins', s.academy_wins,
    'canonical_academy_wins', p.academy_wins
  ) as details
from public.player_stats s
left join public.players p on p.id = s.player_id
order by section, object_name
limit 25;
