(() => {
  'use strict';

  const page = document.querySelector('[data-tournament-page]');
  const rosterBox = document.querySelector('[data-tournament-entry-roster]');
  const statusBox = document.querySelector('[data-tournament-entry-status]');
  if (!page || !rosterBox) return;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const escapeHTML = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  let db = null;
  let tournament = null;
  let loanContext = null;
  let featureAvailable = null;
  let contextLoading = false;
  let actionRunning = false;
  let activeSearch = '';
  let refreshTimer = null;
  let replacementApplied = new Set();

  async function getDb() {
    if (db) return db;
    if (window.vclSupabase) {
      db = window.vclSupabase;
      return db;
    }
    if (window.vclSupabaseReady) {
      db = await window.vclSupabaseReady;
      return db;
    }

    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (window.vclSupabase) {
        db = window.vclSupabase;
        return db;
      }
      await wait(100);
    }

    throw new Error('Supabase blev ikke klar.');
  }

  async function getVCLData() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (window.VCLData?.getTournamentBySlug) return window.VCLData;
      await wait(100);
    }
    throw new Error('VCLData blev ikke klar.');
  }

  async function resolveTournament() {
    if (tournament?.id) return tournament;
    const slug = new URLSearchParams(window.location.search).get('tournament') || '';
    if (!slug) return null;
    const VCLData = await getVCLData();
    tournament = await VCLData.getTournamentBySlug(slug);
    return tournament;
  }

  function setStatus(message = '', type = '') {
    if (!statusBox) return;
    statusBox.textContent = message;
    statusBox.dataset.status = type;
  }

  function missingMigration(error) {
    return ['42883', 'PGRST202', 'PGRST204'].includes(error?.code);
  }

  function isRosterBuilderVisible() {
    return !rosterBox.hidden && Boolean(rosterBox.querySelector('.tournament-roster-builder-v1__head'));
  }

  function activeRequests() {
    return Array.isArray(loanContext?.requests)
      ? loanContext.requests.filter((request) => ['pending', 'accepted'].includes(request.status))
      : [];
  }

  function acceptedRequests() {
    return activeRequests().filter((request) => request.status === 'accepted');
  }

  function permanentSelects() {
    return [...rosterBox.querySelectorAll('[data-tournament-roster-role][data-player-id]')];
  }

  function selectForPlayer(playerId) {
    return permanentSelects().find((select) => String(select.dataset.playerId) === String(playerId)) || null;
  }

  function permanentCounts() {
    return permanentSelects().reduce((counts, select) => {
      if (select.value === 'starter') counts.starters += 1;
      if (select.value === 'substitute') counts.substitutes += 1;
      return counts;
    }, { starters: 0, substitutes: 0 });
  }

  function combinedCounts() {
    const counts = permanentCounts();
    acceptedRequests().forEach((request) => {
      if (request.requested_role === 'starter') counts.starters += 1;
      if (request.requested_role === 'substitute') counts.substitutes += 1;
    });
    return counts;
  }

  function requiredStarters() {
    return Number(loanContext?.tournament?.required_starters ?? tournament?.required_starters ?? 4) || 4;
  }

  function maxSubstitutes() {
    const value = Number(loanContext?.tournament?.max_substitutes ?? tournament?.max_substitutes ?? 2);
    return Number.isFinite(value) && value >= 0 ? value : 2;
  }

  function maxLoans() {
    const value = Number(loanContext?.tournament?.max_loans ?? tournament?.max_loans ?? 2);
    return Number.isFinite(value) && value >= 0 ? value : 2;
  }

  function updateCombinedSummary() {
    if (!loanContext || !isRosterBuilderVisible()) return;

    const summary = rosterBox.querySelector('[data-tournament-roster-summary]');
    const submitButton = rosterBox.querySelector('[data-submit-tournament-roster]');
    const counts = combinedCounts();
    const startersRequired = requiredStarters();
    const substituteLimit = maxSubstitutes();
    const ready = counts.starters === startersRequired && counts.substitutes <= substituteLimit;

    if (summary) {
      summary.innerHTML = `
        <strong>${counts.starters} / ${startersRequired}</strong>
        <span>starters</span>
        <i aria-hidden="true"></i>
        <strong>${counts.substitutes} / ${substituteLimit}</strong>
        <span>substitutes</span>
      `;
      summary.dataset.ready = ready ? 'true' : 'false';
    }

    if (submitButton && !submitButton.closest('[data-roster-locked]')) {
      submitButton.disabled = !ready;
    }
  }

  function applyAcceptedReplacements() {
    acceptedRequests().forEach((request) => {
      if (
        request.requested_role !== 'starter' ||
        !request.replaces_player_id ||
        replacementApplied.has(String(request.id))
      ) return;

      const select = selectForPlayer(request.replaces_player_id);
      if (select && select.value === 'starter' && !select.disabled) {
        select.value = 'none';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }

      replacementApplied.add(String(request.id));
    });
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('da-DK', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function sourceLabel(requestOrCandidate) {
    return requestOrCandidate?.home_team_name || 'Free Agent';
  }

  function avatarMarkup(item) {
    const alias = String(item?.player_alias || item?.alias || 'V');
    const url = item?.player_avatar_url || item?.avatar_url || '';
    const initial = escapeHTML(alias.trim().charAt(0).toUpperCase() || 'V');
    return url
      ? `<span class="tournament-loan-avatar"><img src="${escapeHTML(url)}" alt="" loading="lazy"></span>`
      : `<span class="tournament-loan-avatar">${initial}</span>`;
  }

  function requestStatusLabel(request) {
    if (request.status === 'accepted') return request.entry_id ? 'Accepteret · gemt i roster' : 'Accepteret · reserveret';
    if (request.status === 'pending') return 'Afventer spiller';
    return request.status || 'Ukendt';
  }

  function activeRequestMarkup(request) {
    const canCancel = request.status === 'pending' || (request.status === 'accepted' && !request.entry_id);
    const roleLabel = request.requested_role === 'starter' ? 'Starter' : 'Substitute';
    const replaceCopy = request.replaces_player_alias
      ? ` · erstatter ${escapeHTML(request.replaces_player_alias)}`
      : '';

    return `
      <article class="tournament-loan-request" data-loan-request-id="${escapeHTML(request.id)}" data-status="${escapeHTML(request.status)}">
        <div class="tournament-loan-request__identity">
          ${avatarMarkup(request)}
          <div>
            <strong>${escapeHTML(request.player_alias || 'Ukendt spiller')}</strong>
            <span>${escapeHTML(sourceLabel(request))}</span>
          </div>
        </div>
        <div class="tournament-loan-request__role">
          <small>Turneringsrolle</small>
          <strong>${roleLabel}${replaceCopy}</strong>
        </div>
        <div class="tournament-loan-request__state">
          <span data-state="${escapeHTML(request.status)}">${escapeHTML(requestStatusLabel(request))}</span>
          ${request.status === 'pending' && request.expires_at ? `<small>Udløber ${escapeHTML(formatDate(request.expires_at))}</small>` : ''}
        </div>
        ${canCancel ? `<button type="button" class="tournament-loan-request__cancel" data-cancel-loan-request="${escapeHTML(request.id)}">Annuller</button>` : ''}
      </article>
    `;
  }

  function candidateMarkup(candidate) {
    const alreadyPending = Boolean(candidate.pending_request_id);
    return `
      <article class="tournament-loan-candidate">
        <div class="tournament-loan-candidate__identity">
          ${avatarMarkup(candidate)}
          <div>
            <strong>${escapeHTML(candidate.alias || 'Ukendt spiller')}</strong>
            <span>${escapeHTML(candidate.primary_role || 'Player')} · ${escapeHTML(sourceLabel(candidate))}</span>
          </div>
        </div>
        <div class="tournament-loan-candidate__meta">
          <span>${candidate.home_team_id ? 'Team loan' : 'Free Agent stand-in'}</span>
          ${candidate.level ? `<small>${escapeHTML(candidate.level)}</small>` : ''}
        </div>
        <button
          type="button"
          data-open-loan-request
          data-player-id="${escapeHTML(candidate.player_id)}"
          ${alreadyPending ? 'disabled' : ''}
        >${alreadyPending ? 'Request sendt' : 'Anmod om stand-in'}</button>
      </article>
    `;
  }

  function renderPanel() {
    if (!loanContext || !isRosterBuilderVisible()) return;

    rosterBox.querySelector('[data-tournament-loan-panel]')?.remove();

    if (loanContext.tournament?.allows_loans === false || maxLoans() <= 0) {
      updateCombinedSummary();
      return;
    }

    const active = activeRequests();
    const candidates = Array.isArray(loanContext.candidates) ? loanContext.candidates : [];
    const activeCount = active.length;
    const canRequestMore = activeCount < maxLoans();
    const footer = rosterBox.querySelector('.tournament-roster-builder-v1__footer');
    if (!footer) return;

    const panel = document.createElement('section');
    panel.className = 'tournament-loan-panel';
    panel.setAttribute('data-tournament-loan-panel', '');
    panel.innerHTML = `
      <div class="tournament-loan-panel__head">
        <div>
          <span>Stand-ins / loans</span>
          <h3>Lån en spiller til turneringen</h3>
          <p>Hent en spiller fra et andet VCL-hold eller en Free Agent uden at ændre spillerens permanente holdstatus.</p>
        </div>
        <div class="tournament-loan-panel__count">
          <strong>${activeCount} / ${maxLoans()}</strong>
          <span>aktive requests</span>
        </div>
      </div>

      ${active.length ? `
        <div class="tournament-loan-panel__requests">
          <div class="tournament-loan-panel__subhead">
            <strong>Jeres stand-ins</strong>
            <span>Accepterede spillere tæller automatisk med i tournament rosteren.</span>
          </div>
          ${active.map(activeRequestMarkup).join('')}
        </div>
      ` : ''}

      <div class="tournament-loan-panel__finder" ${canRequestMore ? '' : 'hidden'}>
        <div class="tournament-loan-panel__subhead">
          <strong>Find stand-in</strong>
          <span>Kun claimed og ledige spillere vises.</span>
        </div>
        <label class="tournament-loan-search">
          <span class="sr-only">Søg spiller eller hold</span>
          <input type="search" value="${escapeHTML(activeSearch)}" placeholder="Søg alias, rolle eller hold…" data-loan-search>
          <button type="button" data-loan-search-button>Søg</button>
        </label>
        <div class="tournament-loan-candidates" data-loan-candidates>
          ${candidates.length
            ? candidates.map(candidateMarkup).join('')
            : `<div class="tournament-loan-empty"><strong>Ingen ledige spillere fundet</strong><p>Prøv en anden søgning, eller kontrollér om spillerne allerede er registreret i turneringen.</p></div>`}
        </div>
      </div>

      ${!canRequestMore ? `<p class="tournament-loan-limit">I har nået grænsen på ${maxLoans()} aktive stand-in requests. Annuller en ubrugt request for at sende en ny.</p>` : ''}
    `;

    footer.insertAdjacentElement('beforebegin', panel);

    applyAcceptedReplacements();
    bindPanel(panel);
    bindPermanentSelectors();
    updateCombinedSummary();
  }

  function bindPermanentSelectors() {
    permanentSelects().forEach((select) => {
      if (select.dataset.loanSummaryBound === 'true') return;
      select.dataset.loanSummaryBound = 'true';
      select.addEventListener('change', () => {
        window.setTimeout(updateCombinedSummary, 0);
      });
    });
  }

  function bindPanel(panel) {
    const searchInput = panel.querySelector('[data-loan-search]');
    const searchButton = panel.querySelector('[data-loan-search-button]');
    let debounceTimer = null;

    const runSearch = () => {
      activeSearch = String(searchInput?.value || '').trim();
      refreshContext(activeSearch);
    };

    searchButton?.addEventListener('click', runSearch);
    searchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runSearch();
      }
    });
    searchInput?.addEventListener('input', () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(runSearch, 350);
    });

    panel.querySelectorAll('[data-open-loan-request]').forEach((button) => {
      button.addEventListener('click', () => {
        const candidate = (loanContext.candidates || []).find(
          (item) => String(item.player_id) === String(button.dataset.playerId)
        );
        if (candidate) openRequestDialog(candidate);
      });
    });

    panel.querySelectorAll('[data-cancel-loan-request]').forEach((button) => {
      button.addEventListener('click', () => cancelRequest(button.dataset.cancelLoanRequest, button));
    });
  }

  function starterReplacementOptions() {
    return permanentSelects()
      .filter((select) => select.value === 'starter')
      .map((select) => {
        const row = select.closest('[data-tournament-roster-player]');
        const alias = row?.querySelector('.tournament-roster-player-v1__identity strong')?.textContent?.trim() || 'Spiller';
        return { playerId: String(select.dataset.playerId || ''), alias };
      })
      .filter((item) => item.playerId);
  }

  function ensureDialog() {
    let dialog = document.querySelector('[data-tournament-loan-dialog]');
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.className = 'tournament-loan-dialog';
    dialog.setAttribute('data-tournament-loan-dialog', '');
    dialog.innerHTML = `
      <form class="tournament-loan-dialog__panel" data-loan-dialog-form>
        <button class="tournament-loan-dialog__close" type="button" data-close-loan-dialog aria-label="Luk">×</button>
        <span class="tournament-loan-dialog__eyebrow">Tournament stand-in</span>
        <h2 data-loan-dialog-title>Anmod om spiller</h2>
        <p data-loan-dialog-copy></p>

        <label>
          <span>Turneringsrolle</span>
          <select name="requested_role" data-loan-dialog-role>
            <option value="starter">Starter</option>
            <option value="substitute">Substitute</option>
          </select>
        </label>

        <label data-loan-replacement-field>
          <span>Hvem erstatter stand-in spilleren?</span>
          <select name="replaces_player_id" data-loan-dialog-replacement>
            <option value="">Ingen specifik spiller</option>
          </select>
          <small data-loan-replacement-help></small>
        </label>

        <label>
          <span>Besked til spilleren <small>(valgfri)</small></span>
          <textarea name="message" rows="3" maxlength="280" placeholder="Fx Vi mangler en SMG til denne turnering."></textarea>
        </label>

        <p class="notice" data-loan-dialog-status aria-live="polite"></p>
        <div class="tournament-loan-dialog__actions">
          <button type="button" class="is-secondary" data-close-loan-dialog>Annuller</button>
          <button type="submit" data-send-loan-request>Send stand-in request</button>
        </div>
      </form>
    `;

    document.body.appendChild(dialog);
    dialog.querySelectorAll('[data-close-loan-dialog]').forEach((button) => {
      button.addEventListener('click', () => dialog.close());
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });

    return dialog;
  }

  function openRequestDialog(candidate) {
    const dialog = ensureDialog();
    const form = dialog.querySelector('[data-loan-dialog-form]');
    const role = dialog.querySelector('[data-loan-dialog-role]');
    const replacement = dialog.querySelector('[data-loan-dialog-replacement]');
    const replacementField = dialog.querySelector('[data-loan-replacement-field]');
    const replacementHelp = dialog.querySelector('[data-loan-replacement-help]');
    const status = dialog.querySelector('[data-loan-dialog-status]');
    const replacements = starterReplacementOptions();

    dialog.querySelector('[data-loan-dialog-title]').textContent = `Anmod om ${candidate.alias || 'spiller'}`;
    dialog.querySelector('[data-loan-dialog-copy]').textContent = candidate.home_team_name
      ? `${candidate.alias} spiller permanent for ${candidate.home_team_name}. En accepteret request gælder kun ${loanContext.tournament?.name || 'denne turnering'}.`
      : `${candidate.alias} er Free Agent. En accepteret request gør ikke spilleren til permanent medlem af jeres hold.`;

    form.reset();
    form.dataset.playerId = candidate.player_id;
    role.value = 'starter';
    replacement.innerHTML = `
      <option value="">Ingen specifik spiller</option>
      ${replacements.map((item) => `<option value="${escapeHTML(item.playerId)}">${escapeHTML(item.alias)}</option>`).join('')}
    `;
    if (status) {
      status.textContent = '';
      status.dataset.status = '';
    }

    const updateReplacementRequirement = () => {
      const counts = combinedCounts();
      const needsReplacement = role.value === 'starter' && counts.starters >= requiredStarters();
      replacement.required = needsReplacement;
      replacementField.dataset.required = needsReplacement ? 'true' : 'false';
      replacementHelp.textContent = role.value !== 'starter'
        ? 'Substitutes erstatter ikke en starter automatisk.'
        : needsReplacement
          ? 'Jeres starter-slots er fyldt. Vælg den starter, som stand-in spilleren overtager pladsen fra.'
          : 'Valgfrit, hvis stand-in spilleren blot udfylder en ledig starter-plads.';
    };

    role.onchange = updateReplacementRequirement;
    updateReplacementRequirement();

    form.onsubmit = async (event) => {
      event.preventDefault();
      if (actionRunning) return;

      const requestedRole = role.value;
      const replacesPlayerId = replacement.value || null;
      if (replacement.required && !replacesPlayerId) {
        if (status) {
          status.textContent = 'Vælg hvilken starter stand-in spilleren erstatter.';
          status.dataset.status = 'error';
        }
        return;
      }

      actionRunning = true;
      const sendButton = form.querySelector('[data-send-loan-request]');
      try {
        sendButton.disabled = true;
        sendButton.textContent = 'Sender request…';
        if (status) {
          status.textContent = 'Sender tournament-specifik stand-in request…';
          status.dataset.status = 'info';
        }

        const client = await getDb();
        const { error } = await client.rpc('create_tournament_loan_request', {
          p_tournament_id: tournament.id,
          p_player_id: candidate.player_id,
          p_requested_role: requestedRole,
          p_replaces_player_id: replacesPlayerId,
          p_message: form.elements.message.value || ''
        });
        if (error) throw error;

        if (status) {
          status.textContent = 'Request sendt. Spilleren skal nu acceptere den på sin VCL Account.';
          status.dataset.status = 'success';
        }
        window.setTimeout(async () => {
          dialog.close();
          await refreshContext(activeSearch);
        }, 550);
      } catch (error) {
        console.error('Stand-in request kunne ikke sendes:', error);
        if (status) {
          status.textContent = error?.message || 'Requesten kunne ikke sendes.';
          status.dataset.status = 'error';
        }
      } finally {
        actionRunning = false;
        sendButton.disabled = false;
        sendButton.textContent = 'Send stand-in request';
      }
    };

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  async function cancelRequest(requestId, button) {
    if (!requestId || actionRunning) return;
    if (!window.confirm('Annuller denne stand-in request?')) return;

    actionRunning = true;
    try {
      button.disabled = true;
      const client = await getDb();
      const { error } = await client.rpc('cancel_my_tournament_loan_request', {
        p_request_id: requestId
      });
      if (error) throw error;
      await refreshContext(activeSearch);
      setStatus('Stand-in requesten er annulleret.', 'success');
    } catch (error) {
      console.error('Stand-in request kunne ikke annulleres:', error);
      button.disabled = false;
      setStatus(error?.message || 'Requesten kunne ikke annulleres.', 'error');
    } finally {
      actionRunning = false;
    }
  }

  async function loadContext(search = '', { quiet = false } = {}) {
    if (contextLoading || !tournament?.id) return loanContext;
    contextLoading = true;
    try {
      const client = await getDb();
      const { data, error } = await client.rpc('get_my_tournament_loan_context', {
        p_tournament_id: tournament.id,
        p_search: search || null
      });

      if (error) {
        if (missingMigration(error)) {
          featureAvailable = false;
          return null;
        }
        throw error;
      }

      featureAvailable = true;
      loanContext = data || null;
      return loanContext;
    } catch (error) {
      if (!quiet) console.warn('Tournament stand-ins kunne ikke indlæses:', error);
      return null;
    } finally {
      contextLoading = false;
    }
  }

  async function refreshContext(search = '', options = {}) {
    await loadContext(search, options);
    if (featureAvailable && loanContext) renderPanel();
  }

  async function ensureContext() {
    if (!isRosterBuilderVisible()) return;
    if (!tournament?.id) await resolveTournament();
    if (!tournament?.id) return;

    if (featureAvailable === false) return;
    if (!loanContext) await loadContext(activeSearch);
    if (featureAvailable && loanContext) renderPanel();
  }

  async function submitRosterV2(button) {
    if (actionRunning || !loanContext || !tournament?.id) return;

    const teamStarterIds = permanentSelects()
      .filter((select) => select.value === 'starter')
      .map((select) => select.dataset.playerId)
      .filter(Boolean);
    const teamSubstituteIds = permanentSelects()
      .filter((select) => select.value === 'substitute')
      .map((select) => select.dataset.playerId)
      .filter(Boolean);
    const loanRequestIds = acceptedRequests().map((request) => request.id);
    const counts = combinedCounts();

    if (counts.starters !== requiredStarters()) {
      setStatus(`Vælg præcis ${requiredStarters()} starters inklusive accepterede stand-ins.`, 'error');
      return;
    }
    if (counts.substitutes > maxSubstitutes()) {
      setStatus(`Du kan højst vælge ${maxSubstitutes()} substitutes inklusive stand-ins.`, 'error');
      return;
    }

    actionRunning = true;
    const originalHTML = button.innerHTML;
    try {
      button.disabled = true;
      button.textContent = 'Gemmer roster…';
      setStatus('Gemmer permanent lineup og accepterede stand-ins som én tournament roster…', 'info');

      const client = await getDb();
      const { error } = await client.rpc('submit_my_team_tournament_roster_v2', {
        p_tournament_id: tournament.id,
        p_starter_ids: teamStarterIds,
        p_substitute_ids: teamSubstituteIds,
        p_loan_request_ids: loanRequestIds
      });
      if (error) throw error;

      setStatus(
        loanRequestIds.length
          ? `Tournament roster gemt med ${loanRequestIds.length} stand-in${loanRequestIds.length === 1 ? '' : 's'}.`
          : 'Tournament roster gemt.',
        'success'
      );
      window.setTimeout(() => window.location.reload(), 750);
    } catch (error) {
      console.error('Tournament roster med stand-ins kunne ikke gemmes:', error);
      button.disabled = false;
      button.innerHTML = originalHTML;
      setStatus(error?.message || 'Tournament rosteren kunne ikke gemmes.', 'error');
      await refreshContext(activeSearch, { quiet: true });
    } finally {
      actionRunning = false;
    }
  }

  // Capture the roster submit before the legacy foundation handler. Once the
  // loan migration exists, v2 is the canonical submit path even with zero loans.
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-submit-tournament-roster]');
    if (!button || !rosterBox.contains(button) || featureAvailable !== true || !loanContext) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    submitRosterV2(button);
  }, true);

  const observer = new MutationObserver(() => {
    if (!isRosterBuilderVisible()) return;
    if (!rosterBox.querySelector('[data-tournament-loan-panel]')) {
      replacementApplied = new Set();
      ensureContext();
    } else {
      bindPermanentSelectors();
      updateCombinedSummary();
    }
  });

  observer.observe(rosterBox, { childList: true, subtree: true });

  window.addEventListener('vcl:tournament-ready', (event) => {
    tournament = event.detail?.tournament || tournament;
    ensureContext();
  });

  window.addEventListener('focus', () => {
    if (featureAvailable && tournament?.id && isRosterBuilderVisible()) {
      refreshContext(activeSearch, { quiet: true });
    }
  });

  refreshTimer = window.setInterval(() => {
    if (!document.hidden && featureAvailable && tournament?.id && isRosterBuilderVisible()) {
      refreshContext(activeSearch, { quiet: true });
    }
  }, 30_000);

  window.addEventListener('beforeunload', () => {
    observer.disconnect();
    if (refreshTimer) window.clearInterval(refreshTimer);
  });

  window.setTimeout(async () => {
    await resolveTournament().catch(() => null);
    ensureContext();
  }, 350);
})();
