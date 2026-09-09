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

### 1. Duplicate account claim-invite ownership — resolved

The account dashboard's `loadClaimInvite()` is the canonical owner.

Why:

- `account.html` already contains the intended claim-invite section via `data-claim-invite-section` and `data-claim-invite-box` inside the account attention area.
- the account flow already loads the claim invite together with the rest of the account state.
- the later standalone `CLAIM INVITE PAGE HANDLER` duplicated the same `?claim=` lookup/render/accept flow and contained fallback DOM injection that is no longer needed by the current account markup.

Resolved: the standalone `CLAIM INVITE PAGE HANDLER` was removed from `script.js`; `loadClaimInvite()` is now the only account claim-invite runtime owner.

### 2. Team dashboard roster ownership — resolved

The duplicate `CAPTAIN ROSTER CONTROLS` renderer has been folded into the canonical `TEAM DASHBOARD` roster renderer. The dashboard now has one owner for `[data-team-roster-list]`, including remove-player and claim-link actions, and lineup swaps refresh that same owner.

### 3. `script.js` still owns large isolated page applications

Admin, account, tournament, news and profile behaviour are large self-contained applications inside the shared bootstrap. They are not necessarily broken, but they are the main reason `script.js` is difficult to audit safely.

Target: extract one page family at a time with no behavioural changes, then run the static audit after each extraction.

## Do not remove yet

- compatibility property fallbacks in leaderboard/player data until `vclData.js` canonical outputs are checked
- claim flow branches outside the now-confirmed duplicate account handler until current signup/account UX is verified
- any VCLData method without a caller search
- shared live/auth/navigation helpers

## Planned extraction order

1. remove duplicate standalone account claim-invite handler
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
