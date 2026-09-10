-- VCL 2.1 stabilization: remove obsolete team_invites recipient policy

begin;

-- Live invite flow uses invited_profile_id for authorization and
-- invited_player_id for the linked VCL player. The legacy player_id column is
-- not populated by the canonical invite RPCs, so this SELECT policy never
-- grants access to current invite rows and only adds compatibility debt.
drop policy if exists team_invites_select_own_player
on public.team_invites;

notify pgrst, 'reload schema';

commit;
