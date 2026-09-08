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

Status: planned / not yet implemented.

---

## How to use this roadmap

When a new VCL idea comes up:

1. Add the product decision or idea here.
2. Mark whether it is planned, in progress or implemented.
3. If it grows into a larger system, create a separate detailed document in `docs/` and link it from here.
4. Keep implementation details close to the feature plan so future work does not depend on remembering an old chat.
