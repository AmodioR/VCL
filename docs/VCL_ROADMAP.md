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

A larger redesign is planned for permanent transfers, Free Agency, tournament-specific rosters, substitutes, stand-ins/loans and the Roster Market activity feed.

Detailed plan:

- [`ROSTER_SYSTEM_PLAN.md`](./ROSTER_SYSTEM_PLAN.md)

Key decisions include:

- permanent team membership and tournament rosters are separate concepts,
- captains can send direct transfer invitations to players already on another team,
- teams can loan players from other teams for a specific tournament,
- teams can also loan Free Agents from the Roster Market without signing them permanently,
- tournament registration should explicitly confirm starters and substitutes,
- loan players must never represent two teams in the same tournament,
- historical tournament rosters must be stored as snapshots,
- roster movement should automatically create a compact transfer/activity feed.

### Roster Market activity feed

Status: implemented 2026-09-08.

The Roster Market now has a public transfer-history / roster-moves section backed by `roster_activity` and an automatic trigger on player roster state.

The feed currently records:

- team -> team transfers,
- Free Agent -> team signings,
- team -> Free Agent moves,
- existing unrostered players entering the Roster Market,
- brand-new Free Agent profiles entering the Roster Market.

Important implementation rule for the future direct-transfer feature:

- a direct transfer must update `players.current_team_id` straight from the old team to the new team in one transaction,
- it must not temporarily set the player to no team / Free Agent,
- this lets the activity trigger create one clean `transfer` event rather than two misleading events.

The transfer feed records new events from the point the Supabase migration is installed; it does not invent historical transfers that were never recorded.

Loan/stand-in events will be added to the same feed when the tournament loan system exists.

### Remaining roster-system work

1. **Tournament roster foundation**
   - captain confirms the tournament lineup during registration,
   - primary starters are pre-selected,
   - starters can be changed,
   - substitutes are selected explicitly,
   - tournament roster is stored separately from permanent team membership,
   - historical roster snapshots are preserved,
   - registration validates roster size and eligibility.

2. **Direct permanent transfers**
   - captain can invite a player who already belongs to another team,
   - player personally accepts or declines,
   - accepted transfer switches directly from Team A -> Team B atomically,
   - old team is notified,
   - incompatible pending invitations are invalidated,
   - transfer automatically appears in the existing Roster Moves feed.

3. **Tournament loans / stand-ins**
   - captain requests a stand-in from a specific tournament roster setup,
   - player may come from another VCL team or from the Roster Market,
   - Free Agents can be loaned without being signed permanently,
   - player accepts or declines the tournament-specific request,
   - one player cannot represent two teams in the same tournament,
   - roster lock / eligibility / suspension / roster-size checks are enforced,
   - if a full starting roster exists, captain must choose who the stand-in replaces,
   - accepted loans are reserved for that tournament entry,
   - loan activity is added to the existing Roster Moves feed.

---

## How to use this roadmap

When a new VCL idea comes up:

1. Add the product decision or idea here.
2. Mark whether it is planned, in progress or implemented.
3. If it grows into a larger system, create a separate detailed document in `docs/` and link it from here.
4. Keep implementation details close to the feature plan so future work does not depend on remembering an old chat.
