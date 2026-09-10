-- VCL 2.1 stabilization
-- Remove legacy team_invites.player_id recipient path.
-- Canonical invite identity uses invited_player_id + invited_profile_id.

alter table public.team_invites
  drop constraint if exists team_invites_player_id_fkey;

alter table public.team_invites
  drop column if exists player_id;
