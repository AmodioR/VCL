# VCL 2.1 JavaScript architecture audit

Scope: Pass C stabilization audit of the current browser JavaScript. No feature work.

## Current shared bootstrap that belongs in `script.js`

- DOM helpers (`$`, `$$`, `setText`, `escapeHTML`)
- small shared formatting helpers
- initial VCLData/Supabase readiness handling
- global live tournament bar
- active primary navigation state
- mobile navigation toggle
- shared reveal animation bootstrap
- authenticated header button state

## Page-specific behaviour currently living in `script.js`

These sections should eventually move into page-owned modules, preserving current behaviour:

- public tournament hub
- public tournament detail
- teams directory
- leaderboard
- player profile
- permanent team registration submit flow
- account dashboard and avatar/profile handling
- team dashboard
- public team profile
- Roster Market Free Agent rendering/invites
- captain roster controls / claim links
- account claim-invite handling
- signup claim-aware submit flow
- signup claim preview
- login claim-aware submit flow
- admin dashboard, news, team signups, avatars and tournaments
- news listing
- news article

## First concrete cleanup candidates

### 1. Duplicate account claim-invite ownership

The account flow already contains `loadClaimInvite()`, but a later standalone `CLAIM INVITE PAGE HANDLER` also reads the same `?claim=` token, renders the same invite concept and calls `acceptClaimInvite()`.

Target: one account claim-invite owner only. Remove the duplicate path only after confirming which markup/current flow is canonical.

### 2. Team dashboard roster has two render owners

The main `TEAM DASHBOARD` block renders `[data-team-roster-list]`, and the later `CAPTAIN ROSTER CONTROLS` block renders the same container again with action controls.

Target: one roster renderer for the captain dashboard, with swap/remove/claim controls composed by that owner rather than competing renders.

### 3. `script.js` still owns large isolated page applications

Admin, account, tournament, news and profile behaviour are large self-contained applications inside the shared bootstrap. They are not necessarily broken, but they are the main reason `script.js` is difficult to audit safely.

Target: extract one page family at a time with no behavioural changes, then run the static audit after each extraction.

## Do not remove yet

- compatibility property fallbacks in leaderboard/player data until `vclData.js` canonical outputs are checked
- claim flow branches until current signup/account UX is verified
- any VCLData method without a caller search
- shared live/auth/navigation helpers

## Planned extraction order

1. resolve duplicate account claim-invite ownership
2. resolve duplicate team-dashboard roster ownership
3. auth/signup handlers
4. public news + article
5. teams/player/team profile pages
6. tournament hub/detail
7. account dashboard
8. team dashboard
9. admin dashboard
10. leave `script.js` as shared bootstrap only

Every extraction must preserve the existing HTML contract and current Supabase/VCLData calls. No new features during this pass.
