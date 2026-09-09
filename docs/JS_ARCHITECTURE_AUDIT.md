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
- account claim-invite handling
- signup claim-aware submit flow
- signup claim preview
- login claim-aware submit flow
- admin dashboard, news, team signups, avatars and tournaments
- news listing
- news article

## Confirmed cleanup / ownership decisions

### 1. Duplicate account claim-invite ownership — resolved

The account dashboard's `loadClaimInvite()` is the canonical owner.

- `account.html` already contains the intended claim-invite section.
- the account flow already loads the invite together with the rest of the account state.
- the later standalone handler duplicated the same `?claim=` lookup/render/accept flow.

Resolved: the standalone `CLAIM INVITE PAGE HANDLER` was removed from `script.js`; `loadClaimInvite()` is now the only account claim-invite runtime owner.

### 2. Team dashboard roster ownership — resolved

The duplicate `CAPTAIN ROSTER CONTROLS` renderer has been folded into the canonical `TEAM DASHBOARD` roster renderer. The dashboard now has one owner for `[data-team-roster-list]`, including remove-player and claim-link actions, and lineup swaps refresh that same owner.

### 3. Login / signup / claim auth flow — audited

`signup.html` and `login.html` each have one active form owner in `script.js`, and both load Supabase SDK -> `supabaseClient.js` -> `vclData.js` -> `script.js` in the expected order.

- signup has one `signUpAccount()` submit path
- login has one `loginAccount()` submit path
- signup claim preview is presentation-only and does not duplicate account claim acceptance ownership
- the signup claim branch and login claim forwarding intentionally preserve the `?claim=` token

No duplicate auth handler was removed because no competing runtime owner was found.

### 4. Team invite recipient compatibility — resolved

`VCLData.getMyTeamInvites()` previously probed legacy recipient fields (`player_id`, `recipient_player_id`, `target_player_id`) before falling back to the canonical field. The live schema is now normalized, so the method queries `team_invites_view.invited_player_id` directly.

This keeps the website aligned with the cleaned live Supabase contract instead of silently supporting retired schema names.

## Remaining architecture debt

`script.js` still owns several large isolated page applications. They are not automatically bugs, but each page family must be audited for duplicate ownership, stale compatibility branches and dead calls before Pass C is complete.

Do not extract code merely to reduce file size if doing so adds regression risk. Prefer verified ownership cleanup first; extraction is optional when it clearly improves maintainability without changing behaviour.

## Do not remove yet

- compatibility property fallbacks in leaderboard/player data until `vclData.js` canonical outputs are checked
- any VCLData method without a caller search
- shared live/auth/navigation helpers

## Audit order

1. account claim invite — done
2. team-dashboard roster ownership — done
3. auth/signup handlers — done
4. team invite recipient compatibility — done
5. public news + article
6. teams / player / team profile
7. tournament hub / detail
8. account dashboard
9. team dashboard supporting modules
10. admin dashboard
11. final `vclData.js` compatibility/caller sweep

Every cleanup must preserve the existing HTML contract and current Supabase/VCLData behavior. No new features during this pass.
