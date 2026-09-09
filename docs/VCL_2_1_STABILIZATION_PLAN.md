# VCL 2.1 Stabilization & Cleanup Plan

Purpose: stop adding features temporarily and make the current VCL platform structurally clean from Supabase through HTML/CSS/JS before feature development resumes.

Working branch: `stabilization/vcl-2.1-cleanup`

Draft PR: #8

## Definition of done

VCL 2.1 is considered clean when:

- the live Supabase schema has one canonical model per product concept,
- every frontend table/view/RPC/bucket reference exists in the live schema,
- all backend changes have matching repository migrations,
- no active UI depends on known legacy fallback data when a canonical source exists,
- HTML internal links and local assets resolve,
- scripts load in a deterministic order,
- page-specific JS owns page-specific behaviour instead of growing `script.js`,
- CSS does not rely on permanent polish/override stacks,
- compatibility redirects are explicit and contain no business logic,
- desktop and mobile user journeys have been validated end to end,
- real bugs and edge cases found during QA are fixed before new feature work resumes.

---

## Baseline discovered 2026-09-09

Live Supabase snapshot:

- 29 public tables
- 22 public views
- 89 functions/RPCs
- 31 triggers
- 63 RLS policies
- 80 indexes
- 3 Storage buckets

Frontend repository snapshot:

- 24 HTML files including three compatibility redirects
- 17 runtime JS files
- 9 CSS files
- `script.js` ~241 KB
- `styles.css` ~330 KB

The first automated frontend/backend inventory found frontend references to:

- 25 live tables/views,
- 50 live RPC names,
- all 3 live Storage buckets.

No missing Supabase table/view/RPC/bucket name was found by the manifest cross-check. This does **not** prove each flow is semantically correct; the tournament-roster audit already proves that schema compatibility can still be wrong even when object names exist.

---

## Pass A — Supabase correctness first

### A1. Tournament roster / settlement split-brain — P0

Make the explicit `entry_id`-based tournament roster canonical.

Required outcome:

- captain submission writes one canonical roster model,
- bracket generation does not silently snapshot the whole permanent team,
- settlement reads the exact submitted tournament roster,
- loan/Free Agent stand-ins are included correctly,
- unselected permanent members do not receive tournament participation/points,
- legacy roster columns/functions are either migrated or clearly isolated,
- old NOT NULL constraints cannot break the new submission flow.

### A2. Tournament visibility policy — P1

Remove obsolete `tournaments_public_read` if live verification confirms it still allows all rows. Draft tournaments must not be publicly readable.

### A3. Leaderboard source — P1

Make `public_vcl_leaderboard_view` / `players.points` the canonical runtime source. Remove or redefine the stale `leaderboard_view` fallback that depends on `player_stats`.

### A4. Security verification

Run `supabase/tools/schema_security_inventory.sql` and verify:

- `news_posts_view`,
- every `admin_*` view,
- SECURITY DEFINER RPC execute grants,
- Storage object policies.

### A5. Compatibility cleanup after canonical flows work

Audit before deleting:

- duplicate RLS policies,
- redundant indexes,
- `is_admin()` vs `is_vcl_admin()`,
- `set_updated_at()` vs `vcl_set_updated_at()`,
- old/new `team_invites` columns,
- old/new `claim_invites` columns,
- old signup approval/validation RPC variants,
- backup tables in the API-visible `public` schema.

Never delete a compatibility object until frontend + RPC + trigger + view dependencies have been checked.

---

## Pass B — HTML and dependency integrity

Automated audit tool: `tools/vcl-static-audit.mjs`.

Checks include:

- missing local `href` / `src`,
- duplicate HTML ids,
- image alt attributes,
- unsafe `_blank` links,
- Supabase SDK/client/data-layer load order,
- CSS/JS files with no static or dynamic reference,
- frontend Supabase references against `supabase/live-object-manifest.json`.

Intentional compatibility redirects that remain:

- `tilmelding.html` -> `registrer-hold.html`
- `forum.html` -> `roster-market.html`
- `contenter-series.html` -> `contender-series.html`

They are not dead UI pages; they exist only to keep old links alive and must stay business-logic free.

Manual HTML pass still required for:

- navigation consistency,
- title/meta consistency,
- forms/labels/errors,
- empty/loading/error states,
- keyboard/focus behaviour,
- mobile navigation,
- obsolete buttons/links/copy.

---

## Pass C — JavaScript architecture

### Current problem

`script.js` is ~241 KB and owns behaviour for many unrelated pages. This makes regressions and dead code difficult to identify.

`assets/js/vclData.js` is the shared data adapter and is ~55 KB. It should remain the central browser-facing Supabase adapter, but compatibility methods must be audited.

### Target ownership

Keep shared bootstrap small:

- navigation/menu,
- shared reveal behaviour,
- authentication header state,
- global live tournament bar,
- small shared formatting helpers.

Move page behaviour into explicit page modules, for example:

- tournament hub/detail,
- leaderboard,
- teams/team profile/player profile,
- news/article,
- account,
- team dashboard,
- admin,
- auth/signup.

Already-separated feature modules should remain isolated where appropriate:

- `accountTeamMembership.js`
- `accountTransferInvites.js`
- `accountTournamentLoanInvites.js`
- `teamTransferManager.js`
- `tournamentEntryFlow.js`
- `tournamentLoanManager.js`
- `rosterActivity.js`
- homepage result/news modules
- signup linking modules

### Rules

- no new page-specific feature logic in the shared `script.js`,
- no direct Supabase writes from random page modules when an atomic RPC/data-layer method exists,
- remove fallback branches only after the canonical path is verified live,
- every deleted VCLData method must have a repo-wide caller search first.

---

## Pass D — CSS architecture

### Current problem

`styles.css` is ~330 KB and the old CSS architecture note no longer matches reality. There are now multiple legitimate component stylesheets.

Current component files:

- `signup-player-linking.css`
- `direct-team-transfers.css`
- `roster-activity.css`
- `roster-activity-loans.css`
- `tournament-roster-entry.css`
- `tournament-loans.css`
- `tournament-roster-polish.css`
- `admin-tournament-roster.css`

### Cleanup target

- keep global tokens/layout/shared primitives in `styles.css`,
- keep large feature components isolated,
- merge tiny add-on files into their owning component when safe,
- fold `tournament-roster-polish.css` into the actual roster/loan component styles so the polish layer does not become permanent override debt,
- identify duplicate selectors and superseded design blocks in `styles.css`,
- remove rules only after confirming no active page/data state needs them,
- update `CSS_ARCHITECTURE.md` after the final ownership is established.

Likely early consolidation candidates:

- `roster-activity-loans.css` -> `roster-activity.css`,
- `tournament-roster-polish.css` -> `tournament-roster-entry.css` / `tournament-loans.css`.

---

## Pass E — UI/UX functional review

Review each actual user journey, not only individual pages.

### Public visitor

Homepage -> tournaments -> tournament -> teams -> player profile -> leaderboard -> news -> rules/about.

### New account / player

Signup/login -> account -> claim/create player -> avatar flow -> Free Agency / team state.

### Captain

Team dashboard -> roster management -> invite/sign player -> direct transfer -> tournament registration -> tournament roster -> stand-in request -> roster save.

### Requested player

Account -> permanent transfer request accept/decline -> tournament stand-in accept/decline.

### Admin

Admin access -> news -> signups/claims -> avatars -> tournaments -> entries -> bracket -> live scores -> completion -> settlement -> leaderboard/latest result.

Every journey must be checked at desktop and mobile widths.

---

## Pass F — final regression gate

Before merging PR #8:

1. static audit has no unexplained errors,
2. Supabase cleanup migrations have been run successfully in production,
3. schema inventory has been exported again after cleanup,
4. `SUPABASE_SCHEMA_MAP.md` matches the cleaned live architecture,
5. captain tournament flow works end to end,
6. bracket generation uses submitted roster only,
7. settlement awards the correct participating players,
8. direct transfer and Free Agency still work,
9. public leaderboard/news/tournament pages work logged out,
10. admin-only data is inaccessible to non-admin users,
11. mobile QA is completed,
12. no P0/P1 item remains open.

Only after that should new VCL features resume.
