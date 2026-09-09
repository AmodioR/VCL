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

### 5. Runtime Supabase contract sweep — resolved

Runtime relation, RPC and Storage references have been cross-checked against `supabase/live-object-manifest.json`.

- the remaining retired `leaderboard_view` fallback was removed; `public_vcl_leaderboard_view` is now the only leaderboard source
- previously retired `player_stats` and `roster_posts` are not referenced by runtime JavaScript
- retired team-invite identifiers are no longer used by runtime JavaScript
- the static audit now fails if known retired backend identifiers are reintroduced

This closes the known dead-schema compatibility gap between the website runtime and the cleaned live Supabase backend.

### 6. Public news listing + article ownership — audited

The public news list and article page each have one runtime owner in `script.js` and both read published content through `VCLData.getNewsPosts()`.

- homepage featured news remains a separate page-owned module and does not compete with the news page renderer
- the news page owns featured/list rendering, loading, empty and retry states
- the article page owns `?slug=` resolution and article rendering
- no retired relation, duplicate submit handler or competing renderer was found

No runtime code was removed here because the ownership is already clean.

### 7. Admin team-signup runtime compatibility — resolved

The live backend already contains the current linked approval RPC and the canonical `team_signups` relation.

- `VCLData.getAdminTeamSignups()` now reads the canonical `team_signups` query directly instead of silently switching to `admin_team_signups_view` after arbitrary query errors
- `VCLData.adminApproveTeamSignup()` now calls `admin_approve_team_signup_linked` directly instead of probing for the function and falling back to `admin_approve_team_signup_strict`

Historical signup RPC variants can remain in Supabase until a dedicated backend retirement audit proves they have no remaining dependencies; the browser runtime no longer needs to pretend the canonical path may be absent.

### 8. Teams directory / player profile / team profile — audited

The three public identity surfaces now have clear runtime ownership and use the current VCLData contract.

- Teams directory has one renderer and one `getTeams()` + `getPlayers()` load path.
- Player profile now calls canonical `getPlayerProfileContext()` directly instead of probing for it and issuing a second `getPlayerBySlug()` fallback query.
- Team profile now calls canonical `getTeamAchievements()` directly instead of treating the method as optional.
- The synthetic `getTeams()` / `getPlayers()` page-view models are still intentionally retained because the directory currently consumes slugs as its local identifiers; changing that shape is a normalization refactor, not dead-code cleanup.

Static audit passed after the profile fallback cleanup.

## Remaining architecture debt

`script.js` still owns several large isolated page applications. They are not automatically bugs, but each page family must be audited for duplicate ownership, stale compatibility branches and dead calls before Pass C is complete.

Do not extract code merely to reduce file size if doing so adds regression risk. Prefer verified ownership cleanup first; extraction is optional when it clearly improves maintainability without changing behaviour.

## Do not remove yet

- leaderboard/property normalization aliases until the final `vclData.js` output-shape sweep
- any VCLData method without a caller search
- shared live/auth/navigation helpers

## Audit order

1. account claim invite — done
2. team-dashboard roster ownership — done
3. auth/signup handlers — done
4. team invite recipient compatibility — done
5. runtime Supabase contract sweep — done
6. public news + article — done
7. teams / player / team profile — done
8. tournament hub / detail
9. account dashboard
10. team dashboard supporting modules
11. admin dashboard
12. final `vclData.js` compatibility/caller sweep

Every cleanup must preserve the existing HTML contract and current Supabase/VCLData behavior. No new features during this pass.
