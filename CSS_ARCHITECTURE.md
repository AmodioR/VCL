# VCL 2.1 CSS architecture

## Current design system

`styles.css` is the single shared VCL 2.1 stylesheet for the entire active platform.

The approved visual direction is:

- off-white / silver light canvas for league content
- cobalt + electric blue as the VCL brand accents
- dark transparent glass navigation on every full VCL page
- dark navy broadcast surfaces only where they add hierarchy (hero video, scoreboards, tournament features, operational workspaces)
- restrained gold on Championship and podium/prestige states

There is **no legacy stylesheet** in the checkpoint and no orange/Black Ops fallback theme.

## Active component stylesheet

`assets/css/signup-player-linking.css` is the only additional stylesheet. It is intentionally isolated to the team-registration player picker/linking component on `registrer-hold.html`.

It contains only current light-canvas component states; it is not a legacy fallback.

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

- `tilmelding.html` → `registrer-hold.html`
- `forum.html` → `roster-market.html`
- `contenter-series.html` → `contender-series.html`

Do not put UI or business logic in the redirect files.

## Rules going forward

1. Work only from the current master/checkpoint, never an older page-preview ZIP.
2. Add shared visual primitives to `styles.css`; keep page-specific rules scoped to the page body class.
3. Do not recreate the retired dark/orange VCL identity.
4. Avoid override stacks. When a component is redesigned, replace obsolete rules instead of appending a second design underneath them.
5. Prefer explicit HTML navigation and explicit data flows over JavaScript compatibility injection.
6. Keep team registration and tournament entry separate: permanent team registration lives on `registrer-hold.html`; tournament entry lives on the concrete `turnering.html` event.
