# VCL 2.1 CSS architecture

This document describes the CSS ownership rules used during the VCL 2.1 stabilization pass.

## Visual direction

The approved VCL design system is:

- off-white / silver light canvas for normal league content,
- cobalt + electric blue as primary VCL brand accents,
- dark transparent glass navigation across full pages,
- dark navy broadcast/operational surfaces only where hierarchy benefits from them,
- restrained gold for Championship, podium and prestige states.

Do not reintroduce the retired orange/Black Ops theme.

## Ownership model

### `styles.css`

Owns shared platform foundations:

- global reset/tokens/typography,
- container/grid primitives,
- site header/navigation/footer,
- shared buttons/notices/states,
- broadly reused page/layout components.

`styles.css` is currently large and is being audited. During stabilization, obsolete blocks should be removed or moved deliberately rather than covered by another override layer.

### Feature component stylesheets

Large isolated features may own their own CSS when that keeps page responsibilities clear.

Current active component files:

- `assets/css/signup-player-linking.css` — team-registration player linking/picker
- `assets/css/direct-team-transfers.css` — transfer UI on Team Dashboard / Account
- `assets/css/roster-activity.css` — Roster Moves including permanent moves and tournament loans
- `assets/css/tournament-roster-entry.css` — captain tournament lineup builder
- `assets/css/tournament-loans.css` — tournament loan/stand-in manager and Account requests
- `assets/css/tournament-roster-polish.css` — temporary stabilization override to be folded into the two owning tournament component files
- `assets/css/admin-tournament-roster.css` — admin tournament-roster preview loaded by `adminWorkspace.js`

The former `roster-activity-loans.css` add-on was folded into `roster-activity.css` during stabilization so one component no longer needs two style sources.

## Rule against permanent override stacks

A short-lived polish file can be useful while validating a new component, but it must not become permanent architecture.

Before VCL 2.1 stabilization is complete:

- `tournament-roster-polish.css` must be merged into the selectors it actually owns,
- redundant old selectors beneath the approved design must be removed,
- a component should not require multiple files merely because later files override earlier mistakes.

## Page groups

### Public league pages

- `index.html`
- `turneringer.html`
- `turnering.html`
- `academy-cup.html`
- `contender-series.html`
- `championship.html`
- `nyheder.html`
- `nyhed.html`
- `roster-market.html`
- `teams.html`
- `team-profile.html`
- `player-profile.html`
- `leaderboard.html`
- `regler.html`
- `about.html`

### Account / owner flows

- `login.html`
- `signup.html`
- `account.html`
- `registrer-hold.html`
- `team-dashboard.html`
- `admin.html`

## Compatibility redirects

These tiny files are intentionally retained so old links keep working:

- `tilmelding.html` -> `registrer-hold.html`
- `forum.html` -> `roster-market.html`
- `contenter-series.html` -> `contender-series.html`

Do not add UI, Supabase calls or business logic to redirect files.

## Rules going forward

1. Shared visual primitives belong in `styles.css`; feature-specific systems may use one clearly owned component stylesheet.
2. Do not solve a finished redesign by appending an endless second/third override block.
3. If a component is redesigned, merge the approved rules into its owner and remove the superseded rules.
4. New CSS files require a clear owner/page purpose; tiny one-off overrides should usually be folded into an existing owner.
5. Test desktop and mobile after every consolidation.
6. Keep permanent team registration and tournament entry visually and technically separate.
7. Do not remove a selector merely because static search looks quiet; account for dynamically rendered class names and states first.
