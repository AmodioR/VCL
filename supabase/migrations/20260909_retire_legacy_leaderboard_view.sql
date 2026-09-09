-- VCL 2.1 stabilization
-- Retire the old compatibility leaderboard view now that VCL uses the
-- canonical leaderboard path.
--
-- Intentionally no CASCADE: if anything still depends on this view, the
-- migration will stop safely instead of removing dependent objects.

begin;

drop view if exists public.leaderboard_view;

notify pgrst, 'reload schema';

commit;
