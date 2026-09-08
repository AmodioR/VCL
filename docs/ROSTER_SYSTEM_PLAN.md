# VCL Roster System Plan

Planning note for the next major roster-system upgrade in VCL.

This document describes the intended behaviour for permanent transfers, free agents, tournament rosters, stand-ins/loans, and the Roster Market activity feed. It is a product/technical plan only; implementation can be split into smaller commits later.

## Goals

VCL should distinguish clearly between a player's permanent team membership and the roster a team registers for a specific tournament.

The system should support:

- permanent transfers directly between teams,
- players becoming Free Agents,
- new players entering the Roster Market as Free Agents,
- teams signing Free Agents permanently,
- tournament-specific stand-ins / loan players,
- loaning players from another team without permanently transferring them,
- loaning Free Agents from the Roster Market without signing them permanently,
- explicit starting rosters and substitutes when registering for tournaments,
- immutable / historical tournament roster snapshots,
- an automatic Roster Market transfer/activity feed.

---

## 1. Permanent team roster vs tournament roster

These are separate concepts.

### Permanent team roster

Represents which team a player normally belongs to.

Examples:

- Player A belongs to Stålstyrken.
- Player B is a Free Agent.

### Tournament roster

Represents exactly who is registered to play for a team in one specific tournament.

A tournament roster may contain:

- regular team members,
- substitutes,
- loan/stand-in players from other teams,
- loan/stand-in players from the Roster Market / Free Agency.

A player's permanent team membership must not change merely because the player is used as a stand-in.

---

## 2. Direct transfers between teams

Currently a player would effectively need to leave their team, become a Free Agent, then be invited by another team.

VCL should support a direct transfer request instead.

### Intended flow

1. Captain of Team B invites a player who currently belongs to Team A.
2. The player receives a transfer invitation.
3. The UI clearly explains that accepting will remove the player from Team A and join Team B.
4. If the player accepts, the transfer happens atomically.
5. Team A is notified.
6. Transfer activity is written to the Roster Market feed.

Example feed event:

> AmodioR transferred from Dyseria to Stålstyrken.

### Rules

- The player must personally accept the transfer.
- The old captain should not normally need to approve a permanent transfer.
- A transfer must not leave the database in a temporary Free Agent state.
- Pending incompatible invitations should be invalidated when the transfer completes.
- Tournament roster locks may prevent a player from changing team for an already locked tournament, depending on tournament rules.

---

## 3. Free Agency

The system should distinguish between several Free Agent events.

### Existing player becomes Free Agent

A player leaves or is removed from their permanent team.

Feed example:

> PlayerX became a Free Agent.

### New player enters VCL without a team

A newly created/claimed player with no team enters the Roster Market.

Feed example:

> PlayerY joined the VCL Roster Market.

### Free Agent permanently signs for a team

Feed example:

> Stålstyrken signed PlayerY from Free Agency.

---

## 4. Tournament registration should include roster setup

Registering a team for a tournament should no longer be only a simple "register team" action.

The captain should explicitly confirm the tournament roster.

### Proposed registration flow

1. Captain clicks **Tilmeld hold**.
2. VCL creates a roster setup step.
3. The team's primary / expected starting players are pre-selected automatically.
4. Captain confirms or changes the starting lineup.
5. Captain can select substitutes.
6. Captain can request a stand-in / loan player if tournament rules allow it.
7. Registration is only completed once roster validation passes.

For a 4v4 tournament there must be exactly four starting players.

Example:

### Starting roster

- AmodioR
- Benji
- Dyser
- Player4

### Substitutes

- Player5

Other permanent team members may remain on the team without being registered for that tournament.

---

## 5. Tournament roster snapshots

A tournament registration must preserve the roster as it existed for that tournament.

Do not make historical tournament pages depend only on a team's current roster.

Otherwise a later permanent transfer would incorrectly rewrite historical tournament lineups.

The registered tournament roster should therefore be stored separately and remain available as historical data.

This makes it possible to show:

- current team roster on the team page,
- tournament-specific lineup on a tournament page,
- historical player participation,
- stand-ins and substitutes accurately after the tournament has ended.

---

## 6. Stand-ins / player loans

Loans are tournament-specific and must NOT alter permanent team membership.

A loan player can come from either:

1. another VCL team, or
2. the Roster Market / Free Agency.

This second case is important: a team must be able to use a Free Agent as a stand-in for a tournament without permanently signing that player.

### Example: player from another team

Benji permanently belongs to Dyseria.

Stålstyrken loans Benji for one tournament.

Benji remains a Dyseria player outside that tournament.

### Example: Free Agent stand-in

PlayerX is listed on the Roster Market and has no permanent team.

Stålstyrken loans PlayerX for Championship #12.

PlayerX remains a Free Agent after the tournament unless a separate permanent signing occurs.

---

## 7. Loan request flow

Loans should be initiated from a specific tournament registration / roster setup.

### Proposed flow

1. Captain opens the tournament roster setup.
2. Captain clicks **Anmod om stand-in**.
3. Captain searches eligible players.
4. Eligible players can include:
   - players from another team,
   - Free Agents from the Roster Market.
5. Captain selects a player.
6. VCL validates availability.
7. Player receives a tournament-specific loan request.
8. Player accepts or declines.
9. On acceptance, the player is reserved for that team's entry in that tournament.

A loan is not a permanent transfer.

---

## 8. Loan eligibility and safety rules

A player must not be able to represent two teams in the same tournament.

Before allowing a loan, VCL should check at minimum:

- player exists and is eligible,
- tournament allows loan players,
- roster lock has not passed,
- player is not suspended/banned for that tournament,
- player is not already registered for another team in the same tournament,
- player is not already loaned/reserved by another team in the same tournament,
- loan does not cause roster-size limits to be exceeded.

A player should become reserved for the receiving team when the loan is accepted, rather than waiting until the tournament begins.

This prevents two teams from planning around the same player.

---

## 9. Replacing a starter with a loan player

If a team already has a full starting roster and adds a stand-in, the captain must explicitly state who is being replaced.

Example 4v4 roster:

- AmodioR
- Benji
- Dyser
- Player4

If PlayerX is loaned in as a starter, the UI should ask:

> Who does PlayerX replace?

If Player4 is selected:

- PlayerX becomes starter.
- Player4 may become substitute if allowed by tournament rules.
- The registration stores that PlayerX replaced Player4.

If the team only had three available starters, the loan player may simply fill the empty fourth slot without replacing someone.

---

## 10. Suggested database model

Names can change during implementation, but the model should keep permanent team membership separate from tournament participation.

### `tournament_entries`

Possible fields:

- `id`
- `tournament_id`
- `team_id`
- `status`
- `registered_at`
- `roster_locked_at`

### `tournament_roster_players`

Possible fields:

- `id`
- `entry_id`
- `player_id`
- `role`
- `source`
- `home_team_id`
- `replaces_player_id`
- `created_at`

Possible `role` values:

- `starter`
- `substitute`

Possible `source` values:

- `team`
- `loan_team`
- `loan_free_agent`

`home_team_id` should be nullable because a Free Agent loan has no permanent home team.

### `player_transfer_requests`

For permanent team-to-team transfer invitations.

Possible fields:

- `id`
- `player_id`
- `from_team_id`
- `to_team_id`
- `requested_by`
- `status`
- `created_at`
- `responded_at`

### `tournament_loan_requests`

For tournament-specific stand-in invitations.

Possible fields:

- `id`
- `tournament_id`
- `entry_id`
- `player_id`
- `home_team_id` nullable
- `requested_by`
- `status`
- `requested_role`
- `replaces_player_id` nullable
- `created_at`
- `responded_at`

---

## 11. Roster Market activity / transfer feed

The Roster Market should contain an automatic activity feed showing meaningful roster movement.

This should not require manual admin posts.

### Suggested event types

- `transfer`
- `signed_free_agent`
- `became_free_agent`
- `new_free_agent`
- `loan_from_team`
- `loan_free_agent`

### Example events

> AmodioR transferred from Dyseria to Stålstyrken.

> Stålstyrken signed Benji from Free Agency.

> PlayerX became a Free Agent.

> PlayerY joined the VCL Roster Market.

> Stålstyrken loaned PlayerZ from Dyseria for Championship.

> Stålstyrken added Free Agent PlayerQ as a stand-in for Championship.

Loans should be visually distinguishable from permanent transfers so users never mistake a stand-in for a permanent signing.

### Suggested activity table

`roster_activity`

Possible fields:

- `id`
- `player_id`
- `event_type`
- `from_team_id` nullable
- `to_team_id` nullable
- `tournament_id` nullable
- `entry_id` nullable
- `created_at`

For robust historical display, consider storing snapshot labels/names in addition to foreign keys if team/player renames should not rewrite old feed text.

---

## 12. Automatic activity creation

Roster activity should preferably be created server-side in the same transaction as the roster action.

Examples:

- Team A -> Team B = permanent transfer event.
- Team A -> no team = became Free Agent.
- no team -> Team B = signed from Free Agency.
- new player with no team = joined Roster Market.
- tournament loan from Team A -> Team B = loan event, permanent membership unchanged.
- Free Agent -> tournament roster = Free Agent stand-in event, permanent membership unchanged.

Avoid relying only on frontend JavaScript to create these events, because a failed second request could otherwise make the feed disagree with the actual roster state.

---

## 13. UI ideas

### Roster Market

Keep the feed compact rather than using large cards.

Possible format:

**ROSTER MOVES**

- `2 min ago` · Stålstyrken signed PlayerX
- `1h ago` · Benji became a Free Agent
- `Yesterday` · PlayerY transferred from Team A to Team B
- `Yesterday` · Team C loaned PlayerZ for Championship

Use player avatars and small team logos where useful.

Show perhaps the latest 10-20 events with **Se flere**.

### Player profile

Later this data could support:

- current team,
- transfer history,
- tournament appearances,
- loan appearances.

### Team profile

Keep permanent roster separate from tournament lineups.

### Tournament page

Show the actual registered tournament lineup, including:

- starters,
- substitutes,
- stand-ins,
- home team for loaned players where relevant.

---

## 14. Recommended implementation order

### Phase 1 — Tournament roster foundation

- tournament entries,
- explicit starters,
- substitutes,
- roster snapshot,
- registration validation.

### Phase 2 — Direct permanent transfers

- captain sends transfer invitation,
- player accepts/declines,
- atomic team switch,
- notifications.

### Phase 3 — Tournament loans / stand-ins

- loans from other teams,
- loans from Free Agency / Roster Market,
- availability validation,
- player acceptance,
- replacement player handling,
- roster reservation/lock logic.

### Phase 4 — Roster Market activity feed

- automatic event generation,
- permanent transfer events,
- Free Agency events,
- new-player events,
- loan events.

---

## Key design principle

A permanent roster move and a tournament stand-in are fundamentally different actions.

A permanent transfer changes the player's normal team.

A loan only changes which team the player may represent in one specific tournament.

Keeping these concepts separate in the database and UI is the foundation for making the VCL roster system reliable, understandable, and extensible later.
