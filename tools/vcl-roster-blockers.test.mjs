import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Execute the real browser modules with a small DOM/RPC boundary. No network,
// database, timers, or application writes. Hooks exist only in the VM copy.
function harness(module) {
  const calls = [];
  const events = new Map();
  const button = { disabled: true, innerHTML: 'Gem', textContent: 'Gem' };
  const summary = { dataset: {}, innerHTML: '' };
  const status = { dataset: {}, textContent: '' };
  const selectors = Array.from({ length: 4 }, (_, i) => ({
    value: 'starter', dataset: { playerId: `p${i}` },
    addEventListener(name, callback) { this[name] = callback; }
  }));
  const roster = {
    hidden: false, dataset: { rosterLoaded: 'true', rosterLocked: 'false' },
    contains: (target) => target === button,
    querySelector(selector) {
      if (selector === '.tournament-roster-builder-v1__head') return {};
      if (selector === '[data-tournament-roster-summary]') return summary;
      if (selector === '[data-submit-tournament-roster]') return button;
      return null;
    },
    querySelectorAll: () => selectors
  };
  const page = { querySelector: (selector) => {
    if (selector === '[data-tournament-entry-roster]') return roster;
    if (selector === '[data-tournament-entry-status]') return status;
    return null;
  } };
  const tournament = { id: 't1', status: 'open', required_starters: 4, max_substitutes: 2 };
  const data = {
    roster_integrity_version: 1, tournament: { ...tournament },
    entry: { id: 'e1', status: 'approved', roster_locked_at: null }, requests: [], candidates: []
  };
  let rpc = async () => ({ data });
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    return rpc(name, args);
  } };
  const sandbox = {
    console: { warn() {}, error() {} }, URLSearchParams, Date,
    document: {
      querySelector(selector) {
        if (selector === '[data-tournament-page]') return page;
        if (selector === '[data-tournament-entry-roster]') return roster;
        if (selector === '[data-tournament-entry-status]') return status;
        return null;
      },
      addEventListener: (name, callback) => events.set(name, callback)
    },
    window: {
      vclSupabase: client, location: { search: '?tournament=test', reload() {} },
      setTimeout() {}, clearTimeout() {}, setInterval() {},
      addEventListener() {}, confirm: () => true
    },
    MutationObserver: class { observe() {} disconnect() {} }
  };
  let source = fs.readFileSync(new URL(`../assets/js/${module}.js`, import.meta.url), 'utf8');
  const hooks = module === 'tournamentLoanManager' ? `
    globalThis.api = {
      loadContext, submitRosterV2, cancelRequest, activeRequestMarkup, renderPanel,
      updateCombinedSummary, rosterEditable,
      setTournament(value) { tournament = value; }
    };` : `
    globalThis.api = {
      submitRoster, initialiseSelection, selectedIds, loadSavedRoster, renderRosterSummary,
      setState(t, team, saved) { tournament = t; captainTeam = team; savedRoster = saved; }
    };`;
  const end = source.lastIndexOf('})();');
  source = source.slice(0, end) + hooks + source.slice(end);
  vm.runInNewContext(source, sandbox, { filename: `${module}.js` });
  sandbox.api.setTournament?.(tournament);
  return {
    api: sandbox.api, calls, events, button, selectors, roster, status, data, tournament,
    setRpc(value) { rpc = value; }
  };
}

test('missing loan context intercepts save and never calls a write RPC', async () => {
  const h = harness('tournamentLoanManager');
  let stopped = false;
  h.events.get('click')({
    target: { closest: () => h.button }, preventDefault() {},
    stopImmediatePropagation() { stopped = true; }
  });
  assert.equal(stopped, true);
  assert.equal(h.button.disabled, true);
  assert.equal(h.calls.length, 0);
});

test('old-server context fails closed; successful refresh enables only v2', async () => {
  const h = harness('tournamentLoanManager');
  h.setRpc(async () => ({ data: { ...h.data, roster_integrity_version: undefined } }));
  assert.equal(await h.api.loadContext(), null);
  await h.api.submitRosterV2(h.button);
  assert.equal(h.button.disabled, true);
  assert.ok(h.calls.every((call) => call.name === 'get_my_tournament_loan_context'));
  h.setRpc(async () => ({ data: h.data }));
  await h.api.loadContext();
  assert.equal(h.button.disabled, false);
  await h.api.submitRosterV2(h.button);
  const write = h.calls.at(-1);
  assert.equal(write.name, 'submit_my_team_tournament_roster_v2');
  assert.deepEqual(Array.from(write.args.p_starter_ids), ['p0', 'p1', 'p2', 'p3']);
  assert.deepEqual(Array.from(write.args.p_loan_request_ids), []);
});

test('failed refresh discards previously valid context and blocks saving', async () => {
  const h = harness('tournamentLoanManager');
  await h.api.loadContext();
  h.setRpc(async () => ({ error: new Error('offline') }));
  assert.equal(await h.api.loadContext(), null);
  await h.api.submitRosterV2(h.button);
  assert.equal(h.button.disabled, true);
  assert.ok(h.calls.every((call) => call.name === 'get_my_tournament_loan_context'));
});

test('save stays disabled while a shared context refresh is pending', async () => {
  const h = harness('tournamentLoanManager');
  await h.api.loadContext();
  let resolve;
  h.setRpc(() => new Promise((done) => { resolve = done; }));
  const first = h.api.loadContext();
  const second = h.api.loadContext();
  await Promise.resolve();
  await h.api.submitRosterV2(h.button);
  assert.equal(h.button.disabled, true);
  resolve({ data: h.data });
  await Promise.all([first, second]);
  assert.equal(h.calls.length, 2); // initial load + one shared refresh
});

test('saved stand-in removal frees a slot and normal replacement can be saved', async () => {
  const h = harness('tournamentLoanManager');
  h.selectors[3].value = 'none';
  const loan = { id: 'l1', entry_id: 'e1', player_id: 'loan', status: 'accepted', requested_role: 'starter' };
  h.data.requests = [loan];
  await h.api.loadContext();
  assert.match(h.api.activeRequestMarkup(loan), /Fjern fra roster/);
  assert.equal(h.button.disabled, false);
  h.setRpc(async (name) => {
    if (name === 'cancel_my_tournament_loan_request') {
      h.data.requests = [{ ...loan, status: 'cancelled', entry_id: null }];
      return { data: { roster_requires_confirmation: true } };
    }
    return { data: h.data };
  });
  await h.api.cancelRequest('l1', { disabled: false });
  assert.equal(h.button.disabled, true); // only three starters remain
  h.selectors[3].value = 'starter';
  h.api.updateCombinedSummary();
  assert.equal(h.button.disabled, false);
  await h.api.submitRosterV2(h.button);
  assert.equal(h.calls.at(-1).name, 'submit_my_team_tournament_roster_v2');
  assert.deepEqual(Array.from(h.calls.at(-1).args.p_loan_request_ids), []);
});

test('locked, checked-in, closed, expired or unloaded rosters cannot save/remove', async () => {
  for (const state of ['locked', 'checked_in', 'closed', 'deadline', 'unloaded']) {
    const h = harness('tournamentLoanManager');
    if (state === 'locked') h.data.entry.roster_locked_at = '2026-01-01';
    if (state === 'checked_in') h.data.entry.status = 'checked_in';
    if (state === 'closed') h.data.tournament.status = 'live';
    if (state === 'deadline') h.data.tournament.signup_closes_at = '2000-01-01';
    if (state === 'unloaded') h.roster.dataset.rosterLoaded = 'false';
    await h.api.loadContext();
    const loan = { id: 'l1', entry_id: 'e1', status: 'accepted' };
    assert.doesNotMatch(h.api.activeRequestMarkup(loan), /data-cancel-loan-request/);
    await h.api.cancelRequest('l1', {});
    await h.api.submitRosterV2(h.button);
    assert.equal(h.button.disabled, true, state);
    assert.ok(h.calls.every((call) => call.name === 'get_my_tournament_loan_context'), state);
  }
});

test('loans-disabled tournaments still bind permanent selector changes', async () => {
  const h = harness('tournamentLoanManager');
  h.data.tournament.allows_loans = false;
  await h.api.loadContext();
  h.api.renderPanel();
  assert.ok(h.selectors.every((select) => typeof select.change === 'function'));
});

test('foundation alone never writes or enables the save button', () => {
  const h = harness('tournamentEntryFlow');
  h.api.submitRoster({ preventDefault() {} });
  h.api.renderRosterSummary();
  assert.equal(h.calls.length, 0);
  assert.equal(h.button.disabled, true);
});

test('foundation reload excludes saved loans from permanent selection counts', () => {
  const h = harness('tournamentEntryFlow');
  const team = { members: [{ players: { id: 'p0' }, roster_status: 'active' }] };
  h.api.setState(h.tournament, team, {
    entry: { id: 'e1' }, players: [
      { player_id: 'p0', source: 'team', role: 'starter' },
      { player_id: 'loan', source: 'loan_team', role: 'starter' }
    ]
  });
  h.api.initialiseSelection();
  assert.deepEqual(Array.from(h.api.selectedIds('starter')), ['p0']);
  h.api.setState(h.tournament, team, { entry: { id: 'e1' }, players: [] });
  h.api.initialiseSelection();
  assert.deepEqual(Array.from(h.api.selectedIds('starter')), []);
});

test('saved roster errors cannot turn into a default lineup', async () => {
  const h = harness('tournamentEntryFlow');
  h.api.setState(h.tournament, {}, null);
  h.setRpc(async () => ({ error: new Error('permission denied') }));
  await assert.rejects(h.api.loadSavedRoster(), /permission denied/);
  h.setRpc(async () => ({ data: null }));
  await assert.rejects(h.api.loadSavedRoster(), /valideres/);
});
