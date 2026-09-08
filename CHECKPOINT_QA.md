# VCL 2.1 Clean Checkpoint — QA

Validated after the redesign cleanup. This file records the static checks run before packaging the checkpoint.

## Passed checks

- all JavaScript files pass `node --check`
- both active CSS files parse without top-level syntax errors
- no duplicate HTML IDs detected
- no missing local `href`, `src` or CSS `url(...)` targets detected
- no active references to deleted legacy stylesheets, old logo assets, Shop or TeamPass
- no active references to the retired `forum.html` or `tilmelding.html` routes; those files only remain as redirects
- all full VCL pages use the V2 blue/silver logo and include Turneringer in the explicit navbar
- cache-busting is unified as `2.1-clean-checkpoint-01`
- no old orange/Black Ops accent candidates detected in active CSS/JS
- no `.bak`, `.old`, `.tmp` or editor backup files are present

## Intentional compatibility redirects

- `forum.html` → `roster-market.html`
- `tilmelding.html` → `registrer-hold.html`
- `contenter-series.html` → `contender-series.html`

## Source of truth

Continue development from this checkpoint only. Older redesign preview ZIPs are historical snapshots.
