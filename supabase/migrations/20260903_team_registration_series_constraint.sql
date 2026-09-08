-- VCL team registration compatibility fix
-- Team registration is no longer a tournament signup, but the legacy team_signups
-- table still requires series_slug. Keep the constraint compatible with all VCL levels
-- while the frontend mirrors team_level as academy/contender/championship.

begin;

alter table public.team_signups
  drop constraint if exists team_signups_series_slug_check;

alter table public.team_signups
  add constraint team_signups_series_slug_check
  check (series_slug in ('academy', 'contender', 'championship', 'community'));

commit;
