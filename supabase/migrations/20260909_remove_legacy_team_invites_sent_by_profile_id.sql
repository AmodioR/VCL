-- VCL 2.1 stabilization: remove legacy team_invites.sent_by_profile_id
--
-- The active sender model uses invited_by_profile_id / invited_by_player_id.
-- The legacy sent_by_profile_id column has no remaining data or dependency
-- outside its own foreign key.

begin;

alter table public.team_invites
  drop constraint if exists team_invites_sent_by_profile_id_fkey;

alter table public.team_invites
  drop column if exists sent_by_profile_id;

notify pgrst, 'reload schema';

commit;
