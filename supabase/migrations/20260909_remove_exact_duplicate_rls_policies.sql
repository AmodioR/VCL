-- VCL 2.1 stabilization
-- Remove only RLS policies that are exact duplicates in the live audit.
-- No permission scope is changed because one identical policy is retained.

begin;

-- players: keep the canonical snake_case policy
drop policy if exists "Claimed players can update own public profile"
on public.players;

-- profiles: keep profiles_select_own
drop policy if exists "Users can read own profile"
on public.profiles;

-- tournament roster: keep the newer canonical admin policy
drop policy if exists "Admins manage tournament roster snapshots"
on public.tournament_roster_players;

commit;
