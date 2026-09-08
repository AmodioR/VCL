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

The feed currently records:

- team -> team transfers,
- Free Agent -> team signings,
- team -> Free Agent moves,
- existing unrostered players entering the Roster Market,
- brand-new Free Agent profiles entering the Roster Market.

Important direct-transfer implementation rule:

- a direct transfer updates `players.current_team_id` straight from the old team to the new team in one transaction,
- it never temporarily sets the player to no team / Free Agent,
- this lets the activity trigger create one clean `transfer` event rather than two misleading events.

The transfer feed records new events from the point the Supabase migration is installed; it does not invent historical transfers that were never recorded.

Loan/stand-in events will be added to the same feed when the tournament loan system exists.

### Tournament roster foundation

Status: implemented 2026-09-08; awaiting first natural captain validation.

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
- the data model is already prepared for future `loan_team` and `loan_free_agent` rows.

The production migration has been installed and the feature is merged to `main`. No real captain account was available during implementation, so the first real tournament registration doubles as the live flow validation.

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

### Remaining roster-system work

1. **Tournament loans / stand-ins**
   - captain requests a stand-in from a specific tournament roster setup,
   - player may come from another VCL team or from the Roster Market,
   - Free Agents can be loaned without being signed permanently,
   - player accepts or declines the tournament-specific request,
   - one player cannot represent two teams in the same tournament,
   - roster lock / eligibility / suspension / roster-size checks are enforced,
   - if a full starting roster exists, captain must choose who the stand-in replaces,
   - accepted loans are reserved for that tournament entry,
   - loan activity is added to the existing Roster Moves feed.

2. **VCL 2.1 QA / stabilization**
   - run the complete user journey on desktop and mobile,
   - fix real bugs and edge cases only,
   - defer non-essential new ideas to a later roadmap version.

---

## How to use this roadmap

When a new VCL idea comes up:

1. Add the product decision or idea here.
2. Mark whether it is planned, in progress or implemented.
3. If it grows into a larger system, create a separate detailed document in `docs/` and link it from here.
4. Keep implementation details close to the feature plan so future work does not depend on remembering an old chat.
