# VCL Supabase Schema Map

Live-database reference for the VCL backend.

Snapshot basis: Supabase schema inventory exported 2026-09-09 with `supabase/tools/schema_inventory.sql`.

The live Supabase database is the source of truth. Older parts of VCL were created or changed directly in Supabase, so repository migrations do not yet describe every live object.

## Snapshot summary

- 29 public tables
- 742 table/view columns
- 190 constraints
- 80 indexes
- 63 RLS policies across `public` and `storage`
- 31 public triggers
- 89 public functions / RPCs
- 22 public views
- 3 Storage buckets

PostgreSQL row estimates in the inventory are informational only and may be stale until statistics are refreshed.

---

## Core relationship map

```text
auth.users
   |
   | handle_new_user()
   v
profiles
   |
   | players.claimed_by_profile_id
   v
players -------------------------> player_point_transactions
   |                                  |
   | current_team_id                  | sync/recalculate
   v                                  v
teams <---------- team_members     players.points
   |                 |
   |                 +---- permanent membership history
   |
   +---- team_invites
   +---- player_transfer_requests
   |
   +---- team_signups ---> tournament_entries ---> tournament_roster_players
                                  |                       |
                                  |                       +---- tournament-specific starters/subs/loans
                                  |
                                  +---- tournament_matches
                                  +---- tournament_team_results
                                  +---- tournament_player_results

tournament_loan_requests --------------------------> tournament_roster_players

players/team changes ------------------------------> roster_activity
```

The important product distinction is:

- `team_members` / `players.current_team_id` = permanent team relationship.
- `tournament_roster_players` = participation in one specific tournament.

---

## 1. Identity, accounts and player profiles

### `profiles`

Account-level VCL record keyed by the Supabase Auth user UUID.

Important fields:

- `id` -> Supabase Auth user id
- `display_name`
- `discord`
- `email`
- `role` -> player/admin authorization flag

Important backend behaviour:

- `handle_new_user()` creates/updates a profile after account creation.
- `is_admin()` and `is_vcl_admin()` both currently check `profiles.role = 'admin'`.
- own-profile RLS controls normal account access.

### `players`

Public competitive identity.

Important fields:

- `id`
- `alias`, `slug`
- `claimed_by_profile_id`
- `claim_status`
- `current_team_id`
- `primary_role`, `level`, `bio`
- `is_free_agent`
- `points`
- `academy_wins`, `contender_wins`, `championship_wins`
- approved avatar fields

Important backend behaviour:

- one claimed player per profile is enforced by unique constraint.
- `current_team_id` is the fast permanent-team reference.
- roster changes create `roster_activity` through `vcl_capture_roster_activity()`.
- locked active tournament participation is guarded by `vcl_guard_locked_tournament_membership()`.
- avatar changes are guarded by `guard_player_avatar_moderation()`.

### `claim_invites`

Links an unclaimed VCL player to an account.

The table contains both older and newer invite columns. Current views/RPCs primarily use the newer `token`, `invited_by_*` and `claimed_by_profile_id` fields.

### `player_avatar_submissions`

Moderation queue for player profile pictures.

Used together with:

- `player-avatar-pending` Storage bucket
- `player-avatars` Storage bucket
- `submit_my_player_avatar()`
- `admin_review_player_avatar()`
- `remove_my_player_avatar()`

---

## 2. Permanent teams and roster membership

### `teams`

Permanent VCL team identity.

Important fields:

- `id`, `name`, `slug`, `logo_url`
- `tier`, `status`
- `captain_player_id`
- `tagline`, `description`

`captain_player_id` is the canonical captain pointer used by captain-only RPCs.

### `team_members`

Historical permanent roster membership.

Important fields:

- `team_id`
- `player_id`
- `member_role`
- `roster_status`
- `joined_at`
- `left_at`

Important invariants:

- one active permanent team per player is protected by a partial unique index and trigger.
- current membership rows normally have `left_at is null`.
- `active` / `bench` represent active permanent roster slots.

This table is the permanent membership history; do not use it as the tournament-lineup snapshot.

### `team_invites`

Permanent invitation flow for Free Agents.

Current schema contains both legacy fields (`player_id`, `sent_by_profile_id`) and newer fields (`invited_player_id`, `invited_profile_id`, `invited_by_profile_id`, `invited_by_player_id`).

Current UI should prefer the newer invite model and `team_invites_view`.

### `player_transfer_requests`

Direct permanent Team A -> Team B transfer requests.

Flow:

1. destination captain creates request,
2. player accepts/declines,
3. accepted request closes old `team_members` row,
4. creates/reactivates membership on destination,
5. changes `players.current_team_id` directly,
6. roster activity trigger records one transfer event.

### `roster_posts`

Older/simple Roster Market post model. Keep separate from the newer automatic `roster_activity` movement feed.

### `roster_activity`

Append-style public history of meaningful roster moves.

Current event family includes permanent moves and tournament loan/stand-in activity.

Snapshot fields preserve historical player/team labels after later renames.

---

## 3. Team registration

### `team_signups`

Initial registration/submission layer used before or alongside a canonical `teams` record.

Contains:

- organisation/team form data
- captain contact information
- roster/substitute JSON
- review status
- approved team link
- optional tournament link

Important flow:

`team_signups` -> admin validation/approval -> `approved_team_id` -> `tournament_entries` when associated with a tournament.

Several historical approval/validation RPC variants still exist for compatibility.

---

## 4. Tournament system

### `tournaments`

Canonical tournament record.

Important fields:

- `slug`, `name`
- `series_slug`
- `status`
- scheduling/check-in dates
- `max_teams`
- `points_schema`
- `winner_team_id`, settlement fields
- `stream_url`
- `required_starters`
- `max_substitutes`
- `allows_loans`
- `max_loans`

The older nullable `series` field is still present for compatibility and is synchronized from `series_slug` by trigger.

### `tournament_entries`

One participating team in one tournament.

Stores a team snapshot plus registration/review/roster-lock state.

Important fields:

- `tournament_id`
- `team_id`
- `team_name_snapshot`, `team_slug_snapshot`, `logo_url_snapshot`
- `status`
- `seed`
- `roster_confirmed_at`
- `roster_locked_at`
- `roster_version`

### `tournament_roster_players`

Tournament-specific player lineup.

Target/canonical model introduced by the newer roster flow:

- `entry_id`
- `player_id`
- `role` -> starter/substitute
- `source` -> team/loan_team/loan_free_agent
- `home_team_id`
- `replaces_player_id`
- player snapshot fields

**Important:** the live table currently also contains a legacy snapshot model (`tournament_id`, `team_id`, `alias_snapshot`, `member_role`, `roster_status`). This split schema is documented as a critical audit issue in `SUPABASE_AUDIT_2026-09-09.md` and must be reconciled.

### `tournament_loan_requests`

Tournament-only stand-in reservation/request.

Key principle: accepting this request does not change permanent membership.

Tracks:

- tournament
- requesting team
- player
- home team (nullable for Free Agent)
- requested starter/substitute role
- replaced player
- snapshots
- pending/accepted/declined/cancelled/invalidated/expired status

A partial unique index prevents the same player from having two accepted loan reservations in the same tournament.

### `tournament_matches`

Bracket/match progression.

Includes round/match number, teams, scores, winner, scheduling/stream fields and next-match routing.

### `tournament_team_results`

Settled result per team.

### `tournament_player_results`

Settled result/points per participating player.

---

## 5. Points, trophies and leaderboard

### `player_point_transactions`

Canonical VCL Points ledger.

Every point change should be represented as a transaction.

`sync_player_points_from_ledger()` -> `recalculate_player_points()` -> updates `players.points`.

### `players.points`

Current fast leaderboard balance derived from the ledger.

### `player_stats`

Legacy leaderboard/stat table.

The live audit found no function that updates this table from the current points ledger. Treat it as legacy until deliberately reconciled or removed.

### `player_trophy_opening_balances`

Opening/import source for historical trophy counts.

### Current leaderboard endpoint

`public_vcl_leaderboard_view` reads the modern `players.points` and win counters.

`leaderboard_view` reads the older `player_stats` model and should be treated as compatibility-only.

---

## 6. Historical events and achievements

### `events`

Legacy/general event table separate from the newer `tournaments` system.

### `player_placements`

Historical player placement records linked to `events`.

### `team_achievements`

Historical team achievements/trophies linked to teams and optionally `events`.

These objects still support historical profile/team data but should not be confused with the newer tournament settlement tables.

---

## 7. Content / homepage

### `news_posts`

CMS table for VCL news.

Public website should use `public_news_posts_view`, which exposes published posts only.

Admin tools use `news_posts` / `news_posts_view`.

### `home_featured_results`

Admin-controlled latest/featured homepage result.

`public_home_latest_result_view` resolves team/tournament display information for the public homepage.

---

## 8. Storage

### `team-logos`

- public: yes
- max file size: 2 MB
- PNG/JPEG/WEBP

### `player-avatar-pending`

- public: no
- max file size: 600 KB
- WEBP only

### `player-avatars`

- public: yes
- max file size: 600 KB
- WEBP only

Storage access is additionally controlled by `storage.objects` RLS policies.

---

## 9. Public/read views

Preferred modern public views:

- `public_home_latest_result_view`
- `public_news_posts_view`
- `public_player_point_history_view`
- `public_player_profiles_view`
- `public_roster_activity_view`
- `public_tournament_entries_view`
- `public_tournament_matches_view`
- `public_tournament_player_results_view`
- `public_tournament_roster_view`
- `public_tournament_team_results_view`
- `public_tournaments_view`
- `public_vcl_leaderboard_view`

Compatibility / older views still present:

- `leaderboard_view`
- `news_posts_view`
- `player_history_view`
- `team_achievements_view`
- `team_invites_view`
- `claim_invites_view`

Admin/diagnostic views:

- `admin_roster_limit_audit_view`
- `admin_signup_claim_targets_view`
- `admin_team_signups_view`
- `admin_unclaimed_profiles_view`

---

## 10. Important RPC families

### Admin

Examples:

- tournament create/review/bracket/result/finalization helpers
- point adjustment and tournament settlement
- news and signup management
- claim/avatar moderation

### Captain / team management

Examples:

- `get_my_active_team_context()`
- `captain_set_roster_status()`
- `captain_swap_roster_members()`
- `captain_remove_roster_member()`
- `transfer_my_team_captain()`
- `update_my_captain_team()`
- `send_team_invite_to_free_agent()`

### Permanent transfers

- `create_player_transfer_request()`
- `get_my_captain_transfer_requests()`
- `get_my_player_transfer_requests()`
- `respond_to_player_transfer_request()`
- `cancel_my_player_transfer_request()`

### Tournament registration / rosters

- `request_my_team_tournament_entry()`
- `get_my_team_tournament_entries()`
- `get_my_tournament_roster_selection()`
- `submit_my_team_tournament_roster()`
- `submit_my_team_tournament_roster_v2()`

### Tournament loans

- `get_my_tournament_loan_context()`
- `create_tournament_loan_request()`
- `get_my_tournament_loan_requests()`
- `respond_to_tournament_loan_request()`
- `cancel_my_tournament_loan_request()`

---

## 11. Legacy / cleanup candidates

Do not delete these without a dedicated migration and dependency check.

Current candidates include:

- `player_stats` versus modern `players.points`
- `leaderboard_view` versus `public_vcl_leaderboard_view`
- duplicated helper functions `is_admin()` / `is_vcl_admin()`
- duplicated timestamp helpers `set_updated_at()` / `vcl_set_updated_at()`
- old/new columns inside `team_invites`
- old/new columns inside `claim_invites`
- old/new tournament roster snapshot model
- redundant unique indexes on `tournaments` and `tournament_entries`
- old signup approval/validation function variants
- backup tables in `public`

The goal is not to delete compatibility objects quickly. First establish the canonical flow, migrate dependencies, then remove dead objects in small audited migrations.

---

## 12. Backup tables

Current live backup/recovery tables:

- `vcl_points_recovery_backup_20260719`
- `vcl_trophy_recovery_backup_20260719`
- `vcl_test_tournament_cleanup_backups`

They should remain clearly marked as recovery data and not become application dependencies.

---

## Working rule for future backend changes

Before changing a VCL backend feature:

1. Check this schema map.
2. Run/update `supabase/tools/schema_inventory.sql` if the live DB may have changed.
3. Identify the canonical table + RPC + triggers + views for the feature.
4. Prefer one atomic RPC for multi-table writes.
5. Add the database change to a repository migration before or at the same time as the live SQL change.
6. Update this map when ownership of a domain changes.

This keeps Supabase understandable and prevents future changes from accidentally targeting an older compatibility layer.
