-- VCL 2.1 stabilization: retire the legacy player_stats aggregate table
--
-- The maintained player totals now live on public.players and are updated from
-- the canonical VCL points flow. The legacy player_stats table is stale for a
-- large portion of players and has no remaining application/view/function
-- dependency after public_player_profiles_view was migrated.
--
-- DROP TABLE uses RESTRICT by default, so this migration will fail safely if a
-- dependency still exists in the live database rather than cascading through it.

begin;

drop table if exists public.player_stats;

notify pgrst, 'reload schema';

commit;
