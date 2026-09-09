# VCL Supabase Audit — 2026-09-09

Audit based on a read-only export of the live Supabase schema using `supabase/tools/schema_inventory.sql`.

This is a structural audit, not a destructive cleanup plan. The live database contains compatibility layers from several generations of VCL, so fixes should be made in small migrations with explicit validation.

## Executive summary

The database is generally well protected by RLS and already has strong server-side flows for transfers, tournament registration and loans. The audit also found one **critical tournament-roster split-brain issue**, one definite tournament visibility policy issue, and several legacy/duplicate layers that increase the chance of future bugs.

Priority order:

1. Reconcile the tournament roster / tournament settlement data model before relying on the next real tournament flow.
2. Remove the old public-all tournament RLS policy so draft tournaments are actually private.
3. Remove the stale leaderboard fallback or make it use the canonical points source.
4. Verify view security settings for admin/news compatibility views.
5. Clean duplicates only after functional QA is complete.

---

## P0 — Critical: `tournament_roster_players` currently contains two incompatible schemas

### What the live table contains

Legacy required columns:

- `tournament_id` NOT NULL
- `team_id` NOT NULL
- `alias_snapshot` NOT NULL
- `member_role`
- `roster_status`

New tournament-roster columns:

- `entry_id`
- `role` NOT NULL
- `source` NOT NULL
- `home_team_id`
- `replaces_player_id`
- `player_alias_snapshot` NOT NULL
- `player_slug_snapshot`
- `player_avatar_url_snapshot`
- `primary_role_snapshot`

The new roster migration was intentionally additive because an older live table already existed. That kept production data safe, but it also means the table is now a hybrid of the old automatic snapshot model and the new explicit tournament-lineup model.

### Why this can fail immediately

`submit_my_team_tournament_roster()` and `submit_my_team_tournament_roster_v2()` insert the new fields (`entry_id`, `role`, `source`, `player_alias_snapshot`, etc.) but do not populate the old required `tournament_id`, `team_id` and `alias_snapshot` fields.

Because those legacy fields are still NOT NULL with no defaults, a real roster submission can fail with a NOT NULL violation.

The reverse problem also exists:

`vcl_snapshot_tournament_rosters()` inserts legacy fields but does not populate the new required `role` and `player_alias_snapshot` fields.

So the old snapshot function can also fail against the new hybrid table.

### Additional trigger conflict

`tournament_match_roster_snapshot` runs after a round-one `tournament_matches` insert and calls `vcl_snapshot_tournament_rosters()`.

That means bracket generation can invoke the legacy snapshot path automatically.

Even if the NOT NULL mismatch were patched, this trigger is conceptually wrong for the new system because it can add the entire permanent `team_members` roster after the captain has explicitly chosen a smaller tournament lineup.

### Settlement is still wired to the legacy columns

`admin_preview_tournament_settlement()`:

- explicitly calls `vcl_snapshot_tournament_rosters()`
- checks roster presence via legacy `tournament_id` + `team_id`
- displays `alias_snapshot`, `member_role`, `roster_status`

`admin_finalize_tournament()`:

- calculates `roster_size` through legacy `tournament_id` + `team_id`
- awards tournament points to every player found through those legacy columns

This creates a major correctness problem for the new roster system:

- an unselected permanent team member can be included in tournament settlement,
- a selected loan/Free Agent stand-in can be omitted from settlement,
- historical results may disagree with the actual submitted lineup.

### Required fix direction

Make the **explicit entry-based tournament roster** canonical.

Recommended migration direction:

1. stop automatic permanent-roster snapshotting on match insert,
2. make settlement read the roster through `entry_id` / `tournament_entries`,
3. use `player_alias_snapshot`, `role`, and `source` as canonical fields,
4. include `loan_team` / `loan_free_agent` players in settlement naturally,
5. backfill any legacy rows that must be kept,
6. remove legacy NOT NULL requirements only after old dependencies are migrated,
7. eventually remove legacy columns/functions once no dependency remains.

**Do this before the next real tournament reaches bracket generation / settlement.**

---

## P1 — High: draft tournaments are currently publicly readable

The live `tournaments` table has two public SELECT policies:

- `Public can read published tournaments` -> `status <> 'draft'`
- `tournaments_public_read` -> `true`

PostgreSQL permissive RLS policies are combined with OR logic.

Therefore the second policy effectively makes every tournament row readable to `anon` and `authenticated`, including drafts.

This defeats the intended published-only policy and also affects `public_tournaments_view`, which is intentionally a `security_invoker` view over the base table.

### Fix

Remove the obsolete `tournaments_public_read` policy and keep the explicit published/admin policy.

This is a small, low-risk migration and should be part of the first cleanup pass.

---

## P1 — High: leaderboard has two data models, but only one is maintained

Modern path:

`player_point_transactions` -> `recalculate_player_points()` -> `players.points` -> `public_vcl_leaderboard_view`

Legacy path:

`player_stats` -> `leaderboard_view`

The live function inventory contains no function that updates `player_stats` from the current VCL Points ledger.

The frontend currently prefers `public_vcl_leaderboard_view` but retains `leaderboard_view` as a fallback.

If the preferred view fails or is unavailable, the fallback can return stale or empty leaderboard data because it reads a table the modern points system does not maintain.

### Fix direction

Preferred:

- make `public_vcl_leaderboard_view` the single canonical leaderboard endpoint,
- remove the `leaderboard_view` runtime fallback after QA.

Alternative:

- redefine the compatibility `leaderboard_view` to read the same canonical `players.points` source.

Do not keep two independently maintained point balances.

---

## P1 — Security follow-up required: compatibility/admin views

The live grants show SELECT access that deserves a dedicated view-security check.

### `news_posts_view`

The view contains:

- all news statuses rather than published-only rows,
- `author_email`.

It currently has anon/authenticated SELECT grants in the live grant inventory.

The public website correctly uses `public_news_posts_view`, which contains published posts only, but the old compatibility/admin view should not be accidentally public.

### Admin views

Examples:

- `admin_team_signups_view`
- `admin_signup_claim_targets_view`
- `admin_unclaimed_profiles_view`
- `admin_roster_limit_audit_view`

`admin_team_signups_view` includes contact data such as captain email and phone.

Authenticated SELECT grants can be safe if the views are `security_invoker` and their base-table RLS requires admin access. They can be unsafe if an older view executes with owner privileges and bypasses underlying RLS.

### Follow-up

Extend the schema inventory to record view `reloptions` / `security_invoker` and routine EXECUTE grants, then verify these views explicitly.

Until that check is complete, treat this as a security-review item rather than a confirmed exposure.

---

## P2 — Medium: duplicate RLS policies

The database contains multiple policies that are effectively duplicates or compatibility leftovers.

Examples:

### `players`

Two own-profile UPDATE policies with the same condition:

- `Claimed players can update own public profile`
- `players_update_own_claimed_profile`

### `profiles`

Duplicate own SELECT and UPDATE families:

- `Users can read own profile` + `profiles_select_own`
- `Users can update own profile` + `profiles_update_own`

### `tournament_roster_players`

Two admin ALL policies plus two public-read generations.

### `player_point_transactions`

Individual admin SELECT/INSERT/UPDATE/DELETE policies exist alongside `Admins manage point transactions` ALL.

These duplicates are not automatically bugs, but they make permissions much harder to reason about and can hide accidental widening because permissive policies are ORed.

Cleanup should happen after the canonical flows are settled.

---

## P2 — Medium: redundant indexes

Examples found in the live schema:

### `tournaments`

- primary-key index on `id`
- separate unique `tournaments_id_unique_idx` on the same `id`
- unique constraint/index on `slug`
- separate `tournaments_slug_unique_idx` on the same `slug`

### `tournament_entries`

- primary-key index plus separate unique id index
- two unique signup-id indexes
- overlapping `(tournament_id, team_id)` unique indexes

These are mostly harmless at current VCL scale, but every redundant index adds write/update work and obscures which constraint is canonical.

Clean them only after dependency verification.

---

## P2 — Medium: duplicate helper/RPC generations

Examples:

- `is_admin()` and `is_vcl_admin()` implement the same admin check.
- `set_updated_at()` and `vcl_set_updated_at()` perform the same class of task.
- signup approval has `admin_approve_team_signup`, `_linked`, `_strict`.
- signup validation has current and pre-flexible-roster variants.

Some of these are intentional fallbacks in the frontend. They should eventually be collapsed after a stable release so future code does not accidentally call an outdated path.

---

## P2 — Medium: `team_invites` contains old and new invitation columns

Legacy fields include:

- `player_id`
- `sent_by_profile_id`

Newer model includes:

- `invited_player_id`
- `invited_profile_id`
- `invited_by_profile_id`
- `invited_by_player_id`

`team_invites_view` uses the newer fields, while an older RLS policy still references `player_id`.

This is currently compatibility debt rather than a confirmed failure, but it explains why previous errors around invitation views/columns have been easy to trigger.

Before cleanup, search all frontend/RPC dependencies and migrate them to one naming model.

---

## P2 — Medium: `claim_invites` also contains multiple invite generations

The table contains both:

- `claim_token_hash` / `created_by_profile_id`
- newer `token` / `invited_by_profile_id` / `invited_by_player_id` / `claimed_by_profile_id`

Current `claim_invites_view` uses the newer flow.

Keep until dependencies are audited, then consolidate.

---

## P3 — Low: legacy history system exists alongside modern tournament settlement

Legacy:

- `events`
- `player_placements`
- `player_history_view`
- `team_achievements`

Modern:

- `tournaments`
- `tournament_team_results`
- `tournament_player_results`
- public tournament result views

The frontend currently combines historical and modern player history, so the legacy system is still useful. It should be documented as historical rather than deleted casually.

---

## P3 — Low: backup tables remain in `public`

Current backups:

- `vcl_points_recovery_backup_20260719`
- `vcl_trophy_recovery_backup_20260719`
- `vcl_test_tournament_cleanup_backups`

They are useful recovery artifacts but should remain isolated from application code.

Longer term they could move to a dedicated non-API schema if desired.

---

## Healthy areas observed

The audit also shows several good backend decisions already in place:

- RLS is enabled on all 29 public tables in the inventory.
- permanent team membership has both trigger and unique-index protection against multiple active teams.
- direct transfers change `players.current_team_id` atomically without a temporary Free Agent state.
- transfer requests use partial unique indexes to prevent duplicate pending requests per destination team/player.
- tournament loan requests enforce a single accepted reservation per player/tournament.
- points use an append/update ledger with an automatic recalculation trigger into `players.points`.
- Storage has separate pending/public avatar buckets with strict WEBP/size rules.
- modern public tournament views use security-invoker patterns in repository migrations.
- Roster Moves snapshots labels/logos so later renames do not rewrite historical feed entries.

---

## Recommended stabilization sequence

### Pass A — before tournament flow is trusted

- reconcile `tournament_roster_players`,
- migrate settlement to the explicit tournament roster,
- remove the old automatic match-insert roster snapshot path,
- validate registration -> loans -> roster lock -> bracket -> final settlement end to end.

### Pass B — quick correctness/security cleanup

- remove `tournaments_public_read`,
- verify security mode of `news_posts_view` and all `admin_*` views,
- audit EXECUTE grants for every SECURITY DEFINER RPC.

### Pass C — compatibility cleanup after VCL 2.1 is stable

- canonicalize leaderboard endpoint,
- remove duplicate RLS policies,
- remove redundant indexes,
- consolidate admin helpers and signup RPC variants,
- consolidate legacy invite columns where safe.

---

## Source-of-truth rule going forward

Every Supabase change should have all three:

1. live SQL applied in Supabase,
2. matching migration committed to the repository,
3. schema map/audit updated when the canonical architecture changes.

This is the best way to prevent the live database and GitHub codebase from drifting apart again.
