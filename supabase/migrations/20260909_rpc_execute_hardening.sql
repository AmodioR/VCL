-- VCL 2.1 stabilization: RPC execute hardening
--
-- The live security inventory showed several authenticated/admin/captain RPCs
-- still inheriting PostgreSQL's default EXECUTE grant to PUBLIC. Their function
-- bodies may already validate auth/roles, but PUBLIC execute is unnecessary and
-- makes the API surface wider than intended.
--
-- This migration removes PUBLIC execute from the user-facing RPCs that are
-- supposed to require a logged-in account, while preserving authenticated
-- access. Public lookup helpers such as get_claim_invite_by_token and
-- is_profile_username_available are intentionally untouched here.

begin;

do $$
declare
  v_name text;
  v_oid oid;
  v_identity_args text;
  v_authenticated_names text[] := array[
    'accept_claim_invite',
    'accept_team_invite',
    'admin_approve_team_signup',
    'admin_approve_team_signup_strict',
    'admin_clear_home_latest_result',
    'admin_create_claim_invite',
    'admin_generate_single_elimination_bracket',
    'admin_reject_team_signup',
    'admin_set_home_latest_result',
    'captain_create_claim_invite',
    'captain_remove_roster_member',
    'captain_set_roster_status',
    'captain_swap_roster_members',
    'create_my_free_agent_profile',
    'decline_team_invite',
    'send_team_invite_to_free_agent',
    'transfer_my_team_captain',
    'update_my_captain_team'
  ];
begin
  foreach v_name in array v_authenticated_names loop
    for v_oid, v_identity_args in
      select p.oid, pg_get_function_identity_arguments(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = v_name
        and p.prokind = 'f'
    loop
      execute format(
        'revoke execute on function public.%I(%s) from public',
        v_name,
        v_identity_args
      );

      execute format(
        'grant execute on function public.%I(%s) to authenticated',
        v_name,
        v_identity_args
      );
    end loop;
  end loop;
end;
$$;

-- This is an internal admin helper, not a browser-facing RPC. It currently has
-- PUBLIC execute in the live database but no intentional frontend caller.
do $$
declare
  v_oid oid;
  v_identity_args text;
begin
  for v_oid, v_identity_args in
    select p.oid, pg_get_function_identity_arguments(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_find_or_create_signup_player'
      and p.prokind = 'f'
  loop
    execute format(
      'revoke execute on function public.%I(%s) from public, anon, authenticated',
      'admin_find_or_create_signup_player',
      v_identity_args
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
