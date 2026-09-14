# VCL 2.1 A1/A2 verification

Scope: authoritative roster validation and removing/replacing saved stand-ins.
Migration: `supabase/migrations/20260914120000_release_roster_integrity.sql`.

## Implementation and deployment contract

- Apply the new forward migration only after the foundation, loans/stand-ins,
  and `20260909_canonical_tournament_roster_settlement.sql` definitions exist.
  This is not a repair of the repository's older migration replay issues (A3).
- V2 remains the sole roster writer. The old three-argument RPC delegates with
  an empty loan-request array: ordinary no-loan clients remain compatible, but
  a client omitting accepted loans is rejected rather than silently overwriting.
- Submission, acceptance, cancellation and the mutating loan-context reader
  acquire the tournament row lock before modifying request/roster state.
  Submission and cancellation also lock existing entries against admin check-in.
- Uniqueness includes permanent starters, permanent substitutes and loan players
  across `pending`, `approved` and `checked_in` entries for other teams.
- Settlement preview returns `ready: false` for duplicate active representation.
  The existing canonical finalizer locks the tournament, calls that preview,
  and aborts before result deletion or points/trophy writes. Verify this exact
  finalizer body is installed; do not use an older live finalizer.
- Cancellation removes only the selected entry/player's loan-source row,
  cancels the request, clears its entry reference and clears roster confirmation
  in one transaction. A reduced roster is an explicit draft, not a valid lineup.
  The captain must refill any vacancy and save, even after removing a substitute.
- Existing loan activity is historical: its entry reference still points to the
  same real tournament entry, not an active reservation. Removal emits no event.
  Saving again keeps the existing one-event-per-request unique-index behavior.
  A newly requested replacement is a distinct request and may have its own event.
- The context RPC returns `roster_integrity_version: 1`. The frontend fails closed
  if this marker, matching tournament identity or request array is missing, or if
  saved-roster/context loading fails. Deploy SQL before the versioned frontend.
- Only `turnering.html`'s two affected JS asset versions change; no redesign.

## Executable local checks (no database/network)

```text
node --test --test-isolation=none tools/vcl-roster-blockers.test.mjs
node --check assets/js/tournamentEntryFlow.js
node --check assets/js/tournamentLoanManager.js
node tools/vcl-static-audit.mjs
git diff --check
```

The Node tests execute the actual frontend modules inside a VM with controlled
DOM/RPC boundaries. They exercise failed/missing/stale context, concurrent context
loads, old-server refusal, the single v2 save path, saved-loan removal/replacement,
lock/deadline states, loans-disabled events, and saved-roster errors/counts.
They do **not** execute SQL or prove live RLS, transaction or trigger behavior.

## Database fixture requirements

Run the following scenarios only on an authorized disposable PostgreSQL/Supabase
test database containing the verified VCL baseline and new migration. Do not use
production. PostgreSQL execution was not performed during implementation.

Use two captains A/B, a non-captain, an unrelated account, teams A/B, enough
permanent players for four starters plus substitutes, a claimed Free Agent and a
claimed player on a third team. Create an open tournament T with a future closing
time, two allowed loans, and entries for A/B. Capture row counts/values for requests,
rosters, entries, activity, results, ledger, players.points and trophy counters.
Run ordinary client tests with authenticated JWT identity and default READ COMMITTED
transactions, not an unrestricted database-owner identity.

For each rejected operation, verify that *all* relevant rows remain unchanged,
not merely that the frontend displays an error.

## A1 scenarios

| ID | Action | Expected result |
|---|---|---|
| A1-01 | Save four permanent starters and zero loans through v2 and then the old RPC. | Both use the same validation; successful saves contain the exact selected players. |
| A1-02 | Accept a loan for A, then call the old RPC with four permanent starters. | Reject omitted accepted loan; saved roster, request, activity and confirmation remain unchanged. |
| A1-03 | Reserve A's permanent player as B's accepted loan; call A's old RPC and v2 selecting that player. | Both reject the competing reservation. |
| A1-04 | Save player P for A while T is open, transfer P to B, then save P for B as starter; repeat as substitute. | Both RPC signatures reject duplicate active representation. A's stored row is not silently deleted. |
| A1-05 | Attempt each mix of permanent/loan player already in another active roster. | Reject for other pending/approved/checked-in entries; rejected/withdrawn/disqualified historical entries do not reserve the player. |
| A1-06 | Supply duplicate IDs within a role, across roles, and across a permanent slot and loan; include null or invalid IDs. | Reject atomically; no duplicate or null roster rows. |
| A1-07 | In test-only setup seed valid-size, confirmed rosters containing P for A and B, with a completed final. | Preview has `ready: false` and a duplicate-player issue. Finalization fails before changing results, ledger, points, trophies or settled_at. Include a pending duplicate entry. |
| A1-08 | Repair duplicate representation and finalize a valid tournament. | Exactly selected starters/substitutes/loans receive results under existing VCL rules. Unselected permanent players do not. A second finalization fails without changing totals. |
| A1-09 | Block/fail loan-context loading, omit the loan script, return old context without version marker, or fail saved-roster loading. | No submission RPC is sent; no default lineup is written. Retry/reload after recovery can save through v2 only. |
| A1-10 | Load saved roster with loans, then change a permanent selection. | Saved loans do not occupy invisible permanent-selection slots; combined totals count each player once. |

## A2 scenarios

| ID | Action | Expected result |
|---|---|---|
| A2-01 | Cancel a pending request and an accepted but unsaved request. | Status cancelled; entry_id null; no permanent membership changes or new activity. |
| A2-02 | Save an accepted starter loan, then click "Fjern fra roster". | One loan row removed; request cancelled/entry_id null; roster_confirmed_at null; version increments once; three starters remain; save disabled until replacement is selected. |
| A2-03 | Repeat A2-02 for a saved substitute, team loan and Free Agent loan. | Only that loan row is removed. Other loans/permanent rows stay unchanged. Re-save is required to reconfirm even if starter count remains valid. |
| A2-04 | Replace the removed starter with a permanent player and save; separately replace it by requesting/accepting another stand-in. | Full lineup saves and reloads correctly through v2, confirmation restored, old request remains cancelled with no entry_id. |
| A2-05 | Retry the same cancellation after a simulated lost successful response. | Successful idempotent response while still editable; no second version increment, row deletion or activity event. |
| A2-06 | Save the replacement roster repeatedly. | At most one activity event per loan_request_id. Prior activity remains historical; cancelled request does not appear as an active reservation. |
| A2-07 | Change a saved stand-in's permanent membership while tournament remains open, then remove the now-invalid saved loan. | Removal remains possible; no dependency on the old source team being current. Normal replacement restores a valid roster. |
| A2-08 | Attempt removal/save when entry is locked, checked-in or disqualified; tournament closed/settled; deadline passed. | Backend rejects with no changes, including direct RPC calls. Frontend hides removal/disables save for returned lock/deadline states. |
| A2-09 | Attempt removal as non-captain, opposing captain, unrelated account or anon. | Permission/ownership rejection; no disclosure or mutation of another team's request. |
| A2-10 | Remove after loans are disabled by admin but registration/entry remains editable. | Existing saved loan can still be removed; new loan requests remain unavailable. |
| A2-11 | Fail context refresh after successful removal. | Save stays disabled rather than resubmitting stale accepted IDs. Reload shows the reduced, unconfirmed roster. |
| A2-12 | Inject a failure between roster deletion and request update in a test-only copy. | Transaction rolls back both changes and entry confirmation/version; no partial removal. |

## Two-session concurrency tests

Use two database connections and keep the first transaction open long enough to
observe the second waiting. Do not use two calls on one connection.

1. **Two roster saves:** start save A, retain T's lock, start conflicting save B.
   B must wait. Commit A; B must re-read active representation and reject. Repeat
   with B winning, and with the first transaction rolling back.
2. **Acceptance versus save:** hold T's lock with a save, start acceptance of a
   request for a conflicting player. The second operation must wait, then reject
   if the first committed a conflicting representation/reservation. Reverse order.
3. **Removal versus stale save:** remove a saved loan while another tab submits
   the old accepted request ID. After removal commits, the stale save must fail;
   it must not resurrect the request or loan row. Reverse order: removal must
   delete the committed saved row and invalidate confirmation.
4. **Acceptance versus cancellation:** both target one pending request. One waits;
   final state is consistent, with no accepted reservation after cancellation wins.
5. **Deadline/check-in:** block the operation on T or its entry, cross the deadline
   or commit an admin check-in, then release it. Save/removal must reject.
6. **Settlement versus edit:** finalizer and captain edit serialize on T. If
   removal commits first, preview rejects the unconfirmed roster. If finalization
   commits first, subsequent removal/save rejects the completed/settled tournament.

These SQL/concurrency cases remain release gates until run against the authorized
test baseline. Static audit and frontend mocks cannot replace them.
