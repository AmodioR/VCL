# VCL Product Roadmap

Central planning note for product decisions, ideas and features that should not get lost between chats or commits.

Use this document for high-level roadmap items and link to deeper technical notes when a feature becomes large enough to deserve its own plan.

## Current homepage hierarchy

Decision: the homepage should prioritize live/important VCL information before explanatory content.

Current intended order:

1. Hero
2. Latest result
3. Featured news
4. Championship information
5. Din vej gennem VCL
6. Roster Market
7. Final CTA

### Featured news behaviour

The homepage featured-news section should use the same highlighted story as the News page:

- Prefer the published post marked `is_pinned`.
- If no published post is pinned, use the latest published post.
- The homepage card links to the full article.
- The section is hidden if there are no published news posts or news cannot be loaded.

This ensures important announcements are visible to first-time visitors without requiring them to discover the News page first.

Status: implemented 2026-09-08.

---

## Roster, transfer and tournament roster system

A larger redesign covers permanent transfers, Free Agency, tournament-specific rosters, substitutes, stand-ins/loans and the Roster Market activity feed.

Detailed plan:

- [`ROSTER_SYSTEM_PLAN.md`](./ROSTER_SYSTEM_PLAN.md)

Key decisions include:

- permanent team membership and tournament rosters are separate concepts,
- captains can send direct transfer invitations to players already on another team,
- teams can loan players from other teams for a specific tournament,
- teams can also loan Free Agents from the Roster Market without signing them permanently,
- tournament registration explicitly confirms starters and substitutes,
- loan players must never represent two teams in the same tournament,
- historical tournament rosters are stored as snapshots,
- roster movement automatically creates a compact transfer/activity feed.

### Roster Market activity feed

Status: implemented 2026-09-08.

The Roster Market has a public transfer-history / roster-moves section backed by `roster_activity` and an automatic trigger on player roster state.

The live feed records:

- team -> team transfers,
- Free Agent -> team signings,
- team -> Free Agent moves,
- existing unrostered players entering the Roster Market,
- brand-new Free Agent profiles entering the Roster Market,
- team-loan events,
- Free Agent stand-in events.

Important direct-transfer implementation rule:

- a direct transfer updates `players.current_team_id` straight from the old team to the new team in one transaction,
- it never temporarily sets the player to no team / Free Agent,
- this lets the activity trigger create one clean `transfer` event rather than two misleading events.

The transfer feed records new events from the point the Supabase migration is installed; it does not invent historical transfers that were never recorded.

### Tournament roster foundation

Status: implemented 2026-09-08; awaiting first natural full captain registration validation.

Current behaviour:

- captain must confirm a tournament-specific lineup before sending registration,
- the permanent starters are pre-selected automatically,
- captain can change starters and select substitutes,
- default tournament rule is exactly 4 starters and up to 2 substitutes,
- lineup is stored in `tournament_roster_players`, separate from permanent team membership,
- player alias / slug / avatar / role are snapshotted for historical accuracy,
- captains can edit the lineup while registration is open and the roster is not locked,
- rosters lock when the tournament leaves `open` status,
- admin tournament entries show the submitted starters and substitutes,
- the data model supports `team`, `loan_team` and `loan_free_agent` roster sources.

The production migration has been installed and the feature is merged to `main`. No full real captain registration has been completed during development, so the first real tournament registration still acts as end-to-end validation.

### Direct permanent transfers

Status: implemented 2026-09-08 and merged to `main`; initial live behaviour appears to work.

Current behaviour:

- captain gets a dedicated Direct Transfers workspace in Team Dashboard,
- captain can search claimed players who currently belong to another VCL team,
- team captains are excluded until they hand over their captain role,
- captain can attach an optional message and send a 7-day transfer request,
- captain can cancel a pending request,
- player sees incoming direct-transfer requests on Account,
- player personally accepts or declines,
- accepted transfer closes the old active membership and joins the receiving permanent roster as `bench`,
- `players.current_team_id` changes directly Team A -> Team B atomically,
- the existing Roster Moves trigger therefore records one clean team-to-team transfer,
- every other pending direct-transfer request for the player is invalidated after acceptance,
- old-team captain sees the accepted outbound move in the transfer activity on Team Dashboard,
- transfers are blocked while the player is part of a locked `checkin` / `live` tournament roster.

PR #6 (`Add direct permanent team transfers`) was merged to `main` on 2026-09-08. Treat any later issues as stabilization bugs rather than unfinished feature work.

### Tournament loans / stand-ins

Status: implemented 2026-09-09 and merged to `main`; live captain-side UI is loading and received a visual polish pass.

Current behaviour:

- loans are initiated directly from the tournament roster setup,
- captain can search claimed eligible players from another VCL team or active Free Agents,
- the captain chooses whether the stand-in is requested as starter or substitute,
- if all starter slots are occupied, captain must choose which starter the stand-in replaces,
- the player receives a tournament-specific request on Account and personally accepts or declines,
- accepting never changes the player's permanent team or Free Agent status,
- accepted requests reserve the player for one receiving team in that tournament,
- one player cannot be represented or reserved for two teams in the same tournament,
- tournament settings control `allows_loans` and `max_loans` (default 2),
- pending requests expire automatically and are invalidated when the tournament leaves `open`,
- accepted stand-ins are saved in `tournament_roster_players` as `loan_team` or `loan_free_agent`,
- permanent players + accepted stand-ins are validated together against starter/substitute limits,
- locked check-in/live tournament participation blocks permanent team changes at database level,
- admin roster preview distinguishes Loan / Stand-in sources,
- saving an accepted loan creates one distinct Roster Moves event with tournament context,
- the public roster snapshot exposes the stand-in's home team and replacement context where applicable,
- the captain-side tournament roster / stand-in UI has been visually aligned with the dark VCL tournament panel and the candidate list is capped with its own scroll area.

PR #7 (`Add tournament loans and stand-ins`) was merged to `main` on 2026-09-08. Treat remaining issues as QA / stabilization rather than unfinished feature work.

---

## Supabase backend map / audit

Status: live schema inventory completed 2026-09-09.

Reference docs:

- [`SUPABASE_SCHEMA_MAP.md`](./SUPABASE_SCHEMA_MAP.md)
- [`SUPABASE_AUDIT_2026-09-09.md`](./SUPABASE_AUDIT_2026-09-09.md)

Reusable read-only audit scripts:

- `supabase/tools/schema_inventory.sql`
- `supabase/tools/schema_security_inventory.sql`

The first live audit found a **P0 tournament-roster split-brain issue**: the live `tournament_roster_players` table contains both an older automatic snapshot schema and the newer explicit entry-based roster schema. New roster-submit RPCs and old settlement/snapshot functions currently target opposite halves of the table.

Before the next tournament relies on bracket generation / final settlement, QA must reconcile this so:

- the captain-confirmed `entry_id` roster is canonical,
- stand-ins are included in settlement,
- unselected permanent players are not auto-added later,
- the old round-one match snapshot path no longer rebuilds the roster from `team_members`,
- tournament points/wins are awarded from the actual submitted tournament roster.

The audit also found:

- an obsolete `tournaments_public_read` RLS policy currently makes draft tournaments readable despite the newer published-only policy,
- the old `leaderboard_view` reads `player_stats`, while the current points ledger only maintains `players.points`,
- several duplicate policies/indexes/helper RPC generations should be cleaned after functional stabilization,
- admin/news compatibility views need a dedicated `security_invoker` / RPC-grant verification pass.

---

### Remaining VCL 2.1 work

1. **VCL 2.1 QA / stabilization**
   - reconcile the tournament roster + settlement backend before a real tournament depends on it,
   - remove the obsolete public-all tournament RLS policy,
   - verify admin/news view security and SECURITY DEFINER RPC execute grants,
   - make the modern leaderboard source canonical,
   - run the complete user journey on desktop and mobile,
   - validate a real captain tournament registration from start to finish,
   - validate stand-in request -> player accept / decline -> roster submission,
   - verify one player cannot represent two teams in the same tournament,
   - verify Roster Moves creates the expected Loan / Stand-in event,
   - validate bracket generation -> results -> settlement -> VCL Points using the actual submitted roster,
   - fix real bugs and edge cases only,
   - defer non-essential new ideas to a later roadmap version.

---

## How to use this roadmap

When a new VCL idea comes up:

1. Add the product decision or idea here.
2. Mark whether it is planned, in progress or implemented.
3. If it grows into a larger system, create a separate detailed document in `docs/` and link it from here.
4. Keep implementation details close to the feature plan so future work does not depend on remembering an old chat.
