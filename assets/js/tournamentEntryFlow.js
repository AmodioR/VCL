(() => {
  const page = document.querySelector('[data-tournament-page]');
  if (!page) return;

  const button = page.querySelector('[data-tournament-entry-button]');
  const section = page.querySelector('[data-tournament-entry-section]');
  const kicker = page.querySelector('[data-tournament-entry-kicker]');
  const title = page.querySelector('[data-tournament-entry-title]');
  const copy = page.querySelector('[data-tournament-entry-copy]');
  const action = page.querySelector('[data-tournament-entry-action]');
  const rosterBox = page.querySelector('[data-tournament-entry-roster]');
  const status = page.querySelector('[data-tournament-entry-status]');

  let tournament = null;
  let currentUser = null;
  let context = null;
  let captainTeam = null;
  let requests = [];
  let savedRoster = null;
  let selection = new Map();

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const escapeHTML = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  async function waitForDataLayer() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (
        window.VCLData?.getMyActiveTeamContext &&
        window.VCLData?.getMyCaptainTeam &&
        window.VCLData?.getMyTeamTournamentEntries
      ) {
        return window.VCLData;
      }
      await wait(100);
    }
    throw new Error('VCLData blev ikke klar.');
  }

  async function waitForDatabase() {
    if (window.vclSupabase) return window.vclSupabase;

    if (window.vclSupabaseReady) {
      try {
        return await window.vclSupabaseReady;
      } catch (error) {
        console.error('Supabase blev ikke klar:', error);
      }
    }

    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (window.vclSupabase) return window.vclSupabase;
      await wait(100);
    }

    throw new Error('Supabase blev ikke klar.');
  }

  function setStatus(message = '', type = '') {
    if (!status) return;
    status.textContent = message;
    status.dataset.status = type;
  }

  function currentRequest() {
    if (!tournament?.id) return null;
    return requests.find((entry) => String(entry.tournament_id) === String(tournament.id)) || null;
  }

  function requestLabel(entry) {
    const labels = {
      pending: 'Tilmeldingen afventer VCL-godkendelse. Du kan stadig justere lineup, mens tilmeldingen er åben.',
      approved: 'Holdet er godkendt. Lineup kan justeres, indtil VCL låser tournament rosteren.',
      checked_in: 'Holdet er checket ind, og tournament rosteren er låst.',
      rejected: 'Den seneste tilmelding blev afvist. Ret rosteren og send en ny anmodning.',
      withdrawn: 'Holdet er trukket fra turneringen. Du kan sende en ny tilmelding, mens tilmeldingen er åben.',
      disqualified: 'Holdet er diskvalificeret fra turneringen.'
    };
    return labels[entry?.status] || '';
  }

  function requiredStarters() {
    const value = Number(tournament?.required_starters ?? 4);
    return Number.isFinite(value) && value > 0 ? value : 4;
  }

  function maxSubstitutes() {
    const value = Number(tournament?.max_substitutes ?? 2);
    return Number.isFinite(value) && value >= 0 ? value : 2;
  }

  function activeMembers() {
    return Array.isArray(captainTeam?.members)
      ? captainTeam.members.filter((member) => !member.left_at && member.players?.id)
      : [];
  }

  function selectedIds(role) {
    return [...selection.entries()]
      .filter(([, selectedRole]) => selectedRole === role)
      .map(([playerId]) => playerId);
  }

  function selectionCounts() {
    return {
      starters: selectedIds('starter').length,
      substitutes: selectedIds('substitute').length
    };
  }

  function initialiseSelection() {
    selection = new Map();
    const members = activeMembers();

    const savedPlayers = Array.isArray(savedRoster?.players)
      ? savedRoster.players.filter((player) =>
          player?.player_id && player.source === 'team' &&
          members.some((member) => String(member.players.id) === String(player.player_id))
        )
      : [];

    if (savedRoster?.entry) {
      savedPlayers.forEach((player) => {
        if (player.role === 'starter' || player.role === 'substitute') {
          selection.set(String(player.player_id), player.role);
        }
      });
      return;
    }

    const starterLimit = requiredStarters();
    const substituteLimit = maxSubstitutes();
    let starters = 0;
    let substitutes = 0;

    members.forEach((member) => {
      const playerId = String(member.players.id);

      if (member.roster_status === 'active' && starters < starterLimit) {
        selection.set(playerId, 'starter');
        starters += 1;
        return;
      }

      if (member.roster_status === 'bench' && substitutes < substituteLimit) {
        selection.set(playerId, 'substitute');
        substitutes += 1;
      }
    });
  }

  async function loadSavedRoster() {
    if (!tournament?.id) return null;

    try {
      const db = await waitForDatabase();
      const { data, error } = await db.rpc('get_my_tournament_roster_selection', {
        p_tournament_id: tournament.id
      });

      if (error) {
        throw error;
      }

      if (!data || !Array.isArray(data.players)) {
        throw new Error('Den gemte roster kunne ikke valideres.');
      }
      return data;
    } catch (error) {
      console.warn('Kunne ikke hente gemt tournament roster:', error);
      throw error;
    }
  }

  function hideRosterBuilder() {
    if (rosterBox) {
      rosterBox.hidden = true;
      rosterBox.innerHTML = '';
    }
  }

  function renderRosterSummary() {
    if (!rosterBox) return;

    const summary = rosterBox.querySelector('[data-tournament-roster-summary]');
    const submitButton = rosterBox.querySelector('[data-submit-tournament-roster]');
    const { starters, substitutes } = selectionCounts();
    const starterLimit = requiredStarters();
    const substituteLimit = maxSubstitutes();

    if (summary) {
      summary.innerHTML = `
        <strong>${starters} / ${starterLimit}</strong>
        <span>starters</span>
        <i aria-hidden="true"></i>
        <strong>${substitutes} / ${substituteLimit}</strong>
        <span>substitutes</span>
      `;
      summary.dataset.ready = starters === starterLimit ? 'true' : 'false';
    }

    if (submitButton) {
      // Only the loan-aware owner may enable saving after context validation.
      submitButton.disabled = true;
    }
  }

  function bindRosterSelectors(locked) {
    if (!rosterBox || locked) return;

    rosterBox.querySelectorAll('[data-tournament-roster-role]').forEach((select) => {
      select.addEventListener('change', () => {
        const playerId = String(select.dataset.playerId || '');
        const previousRole = selection.get(playerId) || 'none';
        const nextRole = select.value || 'none';

        if (!playerId) return;

        if (nextRole === 'none') {
          selection.delete(playerId);
        } else {
          selection.set(playerId, nextRole);
        }

        const counts = selectionCounts();

        if (counts.starters > requiredStarters()) {
          if (previousRole === 'none') selection.delete(playerId);
          else selection.set(playerId, previousRole);
          select.value = previousRole;
          setStatus(`Der kan kun være ${requiredStarters()} starters. Flyt en anden spiller først.`, 'error');
          return;
        }

        if (counts.substitutes > maxSubstitutes()) {
          if (previousRole === 'none') selection.delete(playerId);
          else selection.set(playerId, previousRole);
          select.value = previousRole;
          setStatus(`Der kan højst være ${maxSubstitutes()} substitutes.`, 'error');
          return;
        }

        const row = select.closest('[data-tournament-roster-player]');
        if (row) row.dataset.role = nextRole;

        setStatus('');
        renderRosterSummary();
      });
    });
  }

  function renderRosterBuilder(existing) {
    if (!rosterBox || !captainTeam?.team) return;

    const members = activeMembers();
    const savedEntry = savedRoster?.entry || null;
    const locked = Boolean(
      savedEntry?.roster_locked_at ||
      existing?.status === 'checked_in' ||
      existing?.status === 'disqualified'
    );

    const starterLimit = requiredStarters();
    const substituteLimit = maxSubstitutes();
    const teamCaptainId = String(
      captainTeam.captain_player?.id || captainTeam.team.captain_player_id || ''
    );

    const submitLabel = existing && ['pending', 'approved'].includes(existing.status)
      ? 'Gem rosterændringer'
      : existing?.status === 'rejected' || existing?.status === 'withdrawn'
        ? 'Bekræft roster og send igen'
        : 'Bekræft roster og send tilmelding';

    rosterBox.hidden = false;
    rosterBox.dataset.rosterLoaded = 'true';
    rosterBox.dataset.rosterLocked = String(locked);
    rosterBox.innerHTML = `
      <div class="tournament-roster-builder-v1__head">
        <div>
          <span class="tournament-roster-builder-v1__step">Tournament roster</span>
          <h3>Vælg jeres lineup</h3>
          <p>
            De normale starters er valgt automatisk. Kontrollér lineup før du sender —
            denne roster bliver gemt specifikt til ${escapeHTML(tournament.name || 'turneringen')}.
          </p>
        </div>

        <div class="tournament-roster-builder-v1__summary" data-tournament-roster-summary aria-live="polite"></div>
      </div>

      <div class="tournament-roster-builder-v1__legend">
        <span>Spiller</span>
        <span>Permanent roster</span>
        <span>Turneringsrolle</span>
      </div>

      <div class="tournament-roster-builder-v1__players">
        ${members.length
          ? members.map((member) => {
              const player = member.players || {};
              const playerId = String(player.id || '');
              const selectedRole = selection.get(playerId) || 'none';
              const isCaptain = playerId === teamCaptainId || member.member_role === 'captain';
              const permanentStatus = member.roster_status === 'bench' ? 'Substitute' : 'Starter';

              return `
                <article
                  class="tournament-roster-player-v1"
                  data-tournament-roster-player
                  data-role="${escapeHTML(selectedRole)}"
                >
                  <div class="tournament-roster-player-v1__identity">
                    <span class="tournament-roster-player-v1__avatar" aria-hidden="true">
                      ${escapeHTML((player.alias || 'V').trim().charAt(0).toUpperCase() || 'V')}
                    </span>
                    <div>
                      <strong>${escapeHTML(player.alias || 'Ukendt spiller')}</strong>
                      <small>${escapeHTML(player.primary_role || 'Player')}${isCaptain ? ' · Captain' : ''}</small>
                    </div>
                  </div>

                  <div class="tournament-roster-player-v1__permanent">
                    <span>${escapeHTML(permanentStatus)}</span>
                  </div>

                  <label class="tournament-roster-player-v1__select">
                    <span class="sr-only">Turneringsrolle for ${escapeHTML(player.alias || 'spilleren')}</span>
                    <select
                      data-tournament-roster-role
                      data-player-id="${escapeHTML(playerId)}"
                      ${locked ? 'disabled' : ''}
                    >
                      <option value="none" ${selectedRole === 'none' ? 'selected' : ''}>Ikke med</option>
                      <option value="starter" ${selectedRole === 'starter' ? 'selected' : ''}>Starter</option>
                      <option value="substitute" ${selectedRole === 'substitute' ? 'selected' : ''}>Substitute</option>
                    </select>
                  </label>
                </article>
              `;
            }).join('')
          : `
            <div class="tournament-roster-builder-v1__empty">
              <strong>Ingen aktive roster-spillere fundet</strong>
              <p>Kontrollér holdets roster i team-dashboardet først.</p>
            </div>
          `}
      </div>

      <div class="tournament-roster-builder-v1__footer">
        <div>
          <strong>Roster-regler</strong>
          <p>
            Vælg præcis ${starterLimit} starters og op til ${substituteLimit} substitutes.
            Spillere, der ikke vælges, forbliver stadig på holdets permanente roster.
          </p>
          <small>
            Stand-ins og lån håndteres separat i turneringsrosteren og ændrer ikke permanent team membership.
          </small>
        </div>

        ${locked
          ? '<span class="tournament-roster-builder-v1__locked">Roster låst</span>'
          : `<button type="button" class="tournament-entry-cta-v2" data-submit-tournament-roster disabled>${escapeHTML(submitLabel)} <span aria-hidden="true">→</span></button>`}
      </div>
    `;

    renderRosterSummary();
    bindRosterSelectors(locked);

    rosterBox
      .querySelector('[data-submit-tournament-roster]')
      ?.addEventListener('click', submitRoster);
  }

  function render() {
    if (!section || !tournament || tournament.status !== 'open') return;

    section.hidden = false;
    hideRosterBuilder();

    if (!currentUser) {
      if (kicker) kicker.textContent = 'Turneringstilmelding';
      if (title) title.textContent = 'Log ind for at fortsætte';
      if (copy) copy.textContent = 'Tilmelding sker med et godkendt VCL-hold. Log ind på captainens account for at kontrollere holdets adgang til denne turnering.';
      if (action) action.innerHTML = '<a class="tournament-entry-cta-v2" href="login.html">Log ind <span>→</span></a>';
      return;
    }

    if (!context) {
      if (kicker) kicker.textContent = 'Kræver VCL-hold';
      if (title) title.textContent = 'Registrer et hold først';
      if (copy) copy.textContent = 'Din account er ikke koblet til et aktivt VCL-hold. Registrer holdet først, så VCL kan gennemgå roster og niveau.';
      if (action) action.innerHTML = '<a class="tournament-entry-cta-v2" href="registrer-hold.html">Registrer hold <span>→</span></a>';
      return;
    }

    const existing = currentRequest();
    const teamName = context.team_name || captainTeam?.team?.name || 'Dit VCL-hold';
    const tier = context.team_tier || context.tier || context.level || captainTeam?.team?.tier || '';

    if (!context.is_captain) {
      if (kicker) kicker.textContent = 'Aktivt VCL-hold';
      if (title) title.textContent = teamName;
      if (copy) copy.textContent = `Du er registreret på ${teamName}, men kun holdets captain kan vælge lineup og sende turneringstilmeldingen.`;
      if (action) action.innerHTML = context.team_slug
        ? `<a class="tournament-entry-link-v2" href="team-profile.html?team=${encodeURIComponent(context.team_slug)}">Se holdprofil →</a>`
        : '';
      return;
    }

    if (kicker) kicker.textContent = tier ? `Godkendt VCL-hold · ${tier}` : 'Godkendt VCL-hold';
    if (title) title.textContent = teamName;
    if (action) action.innerHTML = '';

    if (existing) {
      if (copy) copy.textContent = requestLabel(existing) || 'Kontrollér tournament rosteren herunder.';
    } else if (copy) {
      copy.textContent = 'Før tilmeldingen sendes, skal du bekræfte præcis hvilke spillere der starter, og hvem der er registreret som substitutes.';
    }

    renderRosterBuilder(existing);
  }

  function submitRoster(event) {
    // The loan manager owns all writes, even for a roster with zero loans.
    // If it failed to load, never fall back to a different RPC.
    event?.preventDefault();
    setStatus('Rosteroplysninger er ikke klar. Genindlæs siden og prøv igen.', 'error');
  }

  async function initialise(loadedTournament = null) {
    try {
      const VCLData = await waitForDataLayer();

      if (loadedTournament) tournament = loadedTournament;
      if (!tournament) {
        const slug = new URLSearchParams(window.location.search).get('tournament') || '';
        if (slug) tournament = await VCLData.getTournamentBySlug(slug);
      }

      if (!tournament || tournament.status !== 'open') return;

      currentUser = await VCLData.getCurrentUser?.();

      if (currentUser) {
        context = await VCLData.getMyActiveTeamContext();

        if (context?.team_id) {
          requests = await VCLData.getMyTeamTournamentEntries();
        }

        if (context?.is_captain) {
          captainTeam = await VCLData.getMyCaptainTeam();
          savedRoster = await loadSavedRoster();
          initialiseSelection();
        }
      }

      render();
    } catch (error) {
      console.error('Turneringstilmelding kunne ikke initialiseres:', error);
      if (rosterBox) rosterBox.dataset.rosterLoaded = 'false';
      hideRosterBuilder();

      if (section && tournament?.status === 'open') {
        section.hidden = false;
        if (title) title.textContent = 'Tilmelding kunne ikke indlæses';
        if (copy) copy.textContent = 'Prøv at genindlæse siden om et øjeblik.';
        setStatus(error?.message || '', 'error');
      }
    }
  }

  button?.addEventListener('click', () => {
    if (!section) return;
    section.hidden = false;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  window.addEventListener('vcl:tournament-ready', (event) => {
    tournament = event.detail?.tournament || tournament;
    initialise(tournament);
  }, { once: true });

  // Fallback in case the tournament-ready event fired before this file loaded.
  window.setTimeout(() => {
    if (!tournament) initialise();
  }, 250);
})();
