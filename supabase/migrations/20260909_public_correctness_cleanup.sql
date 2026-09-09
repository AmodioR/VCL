-- VCL 2.1 stabilization: public correctness cleanup

begin;

-- ============================================================
-- Draft tournaments must not be public
-- ============================================================

-- The live DB has both the intended status-aware policy and this old allow-all
-- policy. Permissive SELECT policies are OR'ed, so the allow-all policy makes
-- drafts readable despite the newer rule.
drop policy if exists tournaments_public_read
on public.tournaments;

-- Re-state the canonical policy so fresh/live environments agree.
drop policy if exists "Public can read published tournaments"
on public.tournaments;

create policy "Public can read published tournaments"
on public.tournaments
for select
to anon, authenticated
using (status <> 'draft' or public.is_vcl_admin());

-- ============================================================
-- Keep the legacy leaderboard view safe while callers are migrated
-- ============================================================

-- `player_stats` is no longer the maintained points balance. Keep the old view
-- name for compatibility, but make it read the same canonical player ledger
-- totals/counters as `public_vcl_leaderboard_view`.
create or replace view public.leaderboard_view
with (security_invoker = true)
as
select
  rank() over (
    order by
      coalesce(p.points, 0) desc,
      coalesce(p.championship_wins, 0) desc,
      coalesce(p.contender_wins, 0) desc,
      coalesce(p.academy_wins, 0) desc,
      p.alias
  ) as leaderboard_rank,
  p.id as player_id,
  p.slug as player_slug,
  p.alias,
  p.discord,
  p.primary_role,
  p.level,
  lower(p.level) as tier,
  p.bio,
  p.is_free_agent,
  p.claim_status,
  p.current_team_id,
  t.name as current_team_name,
  coalesce(p.points, 0) as points,
  coalesce(p.championship_wins, 0) as championship_wins,
  coalesce(p.contender_wins, 0) as contender_wins,
  coalesce(p.academy_wins, 0) as academy_wins
from public.players p
left join public.teams t on t.id = p.current_team_id
where coalesce(p.claim_status, 'unclaimed') <> 'retired';

grant select on public.leaderboard_view to anon, authenticated;

notify pgrst, 'reload schema';

commit;
