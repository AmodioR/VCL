(() => {
  const form = document.querySelector('[data-signup-page] form, form[data-team-signup-form], main form');

  if (!form || !window.location.pathname.includes('registrer-hold')) {
    return;
  }

  const normalizeAlias = (value = '') =>
    String(value)
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('da-DK');

  const escapeHTML = (value = '') =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForDataLayer() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (window.VCLData) return window.VCLData;
      await wait(100);
    }

    throw new Error('VCLData blev ikke klar.');
  }

  async function waitForDatabase() {
    if (window.vclSupabase) return window.vclSupabase;
    if (window.vclSupabaseReady) return window.vclSupabaseReady;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (window.vclSupabase) return window.vclSupabase;
      await wait(100);
    }

    throw new Error('Supabase blev ikke klar.');
  }

  const playerPickers = Array.from(form.querySelectorAll('[data-player-picker]'));
  const rosterStatus = form.querySelector('[data-roster-linking-status]');
  const addMyPlayerButton = form.querySelector('[data-add-my-player-to-roster]');
  const captainNameInput = form.querySelector('[name="captain_name"]');
  const captainPlayerIdInput = form.querySelector('[name="captain_player_id"]');
  const captainDiscordInput = form.querySelector('[name="captain_discord"]');
  const captainEmailInput = form.querySelector('[name="captain_email"]');
  const linkedCaptainBox = form.querySelector('[data-linked-captain]');
  const linkedCaptainName = form.querySelector('[data-linked-captain-name]');
  const linkedCaptainMeta = form.querySelector('[data-linked-captain-meta]');
  const captainLinkStatus = form.querySelector('[data-captain-link-status]');
  const unlinkCaptainButton = form.querySelector('[data-unlink-captain]');

  let allPlayers = [];
  let currentClaimedPlayer = null;
  let currentProfile = null;
  let captainBlockedByTeam = false;
  let activeCaptainTeam = null;
  let submitOverrideInstalled = false;

  function setRosterMessage(message, type = 'info') {
    if (!rosterStatus) return;
    rosterStatus.textContent = message;
    rosterStatus.dataset.status = type;
  }

  function getTeamName(player) {
    return player.current_team_name || player.team_name || '';
  }

  function playerHasActiveTeam(player) {
    return Boolean(
      player?.has_active_team ||
      player?.active_team_id ||
      player?.current_team_id ||
      getTeamName(player)
    );
  }

  function getPlayerMeta(player) {
    const parts = [player.primary_role || 'Player', player.level || 'VCL'];
    const teamName = getTeamName(player);

    if (teamName) {
      parts.push(`Aktivt hold: ${teamName}`);
    } else if (player.is_free_agent) {
      parts.push('Free Agent');
    } else {
      parts.push('Ingen aktiv roster');
    }

    return parts.join(' · ');
  }

  async function loadPlayerOptions() {
    const db = await waitForDatabase();

    const [
      { data: players, error: playersError },
      { data: teams, error: teamsError },
      { data: memberships, error: membershipsError }
    ] = await Promise.all([
      db
        .from('players')
        .select(
          'id, slug, alias, discord, primary_role, level, current_team_id, is_free_agent, claim_status'
        )
        .order('alias', { ascending: true }),
      db.from('teams').select('id, name, slug, status'),
      db
        .from('team_members')
        .select('player_id, team_id, left_at')
        .is('left_at', null)
    ]);

    if (playersError) {
      throw playersError;
    }

    if (teamsError) {
      console.warn('Kunne ikke hente holdnavne til spiller-søgning:', teamsError);
    }

    if (membershipsError) {
      console.warn('Kunne ikke hente aktive holdmedlemskaber:', membershipsError);
    }

    const teamById = new Map((teams || []).map((team) => [String(team.id), team]));
    const activeMembershipByPlayer = new Map();

    (memberships || []).forEach((membership) => {
      if (!membership?.player_id || !membership?.team_id) return;
      activeMembershipByPlayer.set(String(membership.player_id), membership);
    });

    allPlayers = (players || [])
      .filter((player) => player.claim_status !== 'retired')
      .map((player) => {
        const membership = activeMembershipByPlayer.get(String(player.id)) || null;
        const activeTeamId = membership?.team_id || player.current_team_id || '';
        const team = activeTeamId ? teamById.get(String(activeTeamId)) || null : null;

        return {
          ...player,
          active_team_id: activeTeamId || '',
          has_active_team: Boolean(activeTeamId),
          current_team_name: team?.name || '',
          current_team_slug: team?.slug || ''
        };
      });
  }

  function clearPickerSelection(picker, { keepValue = true } = {}) {
    const input = picker.querySelector('[data-player-search]');
    const idInput = picker.querySelector('[data-player-id]');
    const typeInput = picker.querySelector('[data-player-link-type]');
    const state = picker.querySelector('[data-player-state]');

    if (!keepValue && input) input.value = '';
    if (idInput) idInput.value = '';
    if (typeInput) typeInput.value = '';

    picker.dataset.selection = '';
    picker.classList.remove(
      'registration-player-picker--linked',
      'registration-player-picker--new',
      'registration-player-picker--invalid'
    );

    if (state) {
      state.textContent = 'Søg efter en eksisterende spiller, eller vælg at oprette en ny.';
      state.dataset.state = 'idle';
    }
  }

  function selectExistingPlayer(picker, player) {
    const input = picker.querySelector('[data-player-search]');

    if (playerHasActiveTeam(player)) {
      clearPickerSelection(picker, { keepValue: true });
      picker.classList.add('registration-player-picker--invalid');

      const state = picker.querySelector('[data-player-state]');
      if (state) {
        state.textContent = `${player.alias || 'Spilleren'} er allerede registreret på ${getTeamName(player) || 'et aktivt hold'}.`;
        state.dataset.state = 'warning';
      }

      if (input) input.value = player.alias || input.value;
      setRosterMessage('Spillere på et aktivt hold kan ikke tilføjes til et nyt hold.', 'error');
      return;
    }
    const idInput = picker.querySelector('[data-player-id]');
    const typeInput = picker.querySelector('[data-player-link-type]');
    const state = picker.querySelector('[data-player-state]');
    const suggestions = picker.querySelector('[data-player-suggestions]');

    if (input) input.value = player.alias || '';
    if (idInput) idInput.value = player.id || '';
    if (typeInput) typeInput.value = 'existing';

    picker.dataset.selection = 'existing';
    picker.classList.remove('registration-player-picker--new', 'registration-player-picker--invalid');
    picker.classList.add('registration-player-picker--linked');

    if (state) {
      state.textContent = `Koblet til eksisterende profil · ${getPlayerMeta(player)}`;
      state.dataset.state = 'linked';
    }

    if (suggestions) suggestions.hidden = true;
    input?.setAttribute('aria-expanded', 'false');
  }

  function selectNewPlayer(picker, alias) {
    const cleanAlias = String(alias || '').trim().replace(/\s+/g, ' ');
    const input = picker.querySelector('[data-player-search]');
    const idInput = picker.querySelector('[data-player-id]');
    const typeInput = picker.querySelector('[data-player-link-type]');
    const state = picker.querySelector('[data-player-state]');
    const suggestions = picker.querySelector('[data-player-suggestions]');

    if (input) input.value = cleanAlias;
    if (idInput) idInput.value = '';
    if (typeInput) typeInput.value = 'new';

    picker.dataset.selection = 'new';
    picker.classList.remove('registration-player-picker--linked', 'registration-player-picker--invalid');
    picker.classList.add('registration-player-picker--new');

    if (state) {
      state.textContent = 'Ny spillerprofil oprettes først, når en admin godkender holdet.';
      state.dataset.state = 'new';
    }

    if (suggestions) suggestions.hidden = true;
    input?.setAttribute('aria-expanded', 'false');
  }

  function findExactPlayer(alias) {
    const normalized = normalizeAlias(alias);
    if (!normalized) return null;

    return (
      allPlayers.find((player) => normalizeAlias(player.alias) === normalized) || null
    );
  }

  function renderSuggestions(picker) {
    const input = picker.querySelector('[data-player-search]');
    const suggestions = picker.querySelector('[data-player-suggestions]');
    if (!input || !suggestions) return;

    const query = String(input.value || '').trim();
    const normalizedQuery = normalizeAlias(query);

    if (!normalizedQuery) {
      suggestions.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }

    const matches = allPlayers
      .filter((player) => {
        const alias = normalizeAlias(player.alias);
        const slug = normalizeAlias(player.slug);
        return alias.includes(normalizedQuery) || slug.includes(normalizedQuery);
      })
      .slice(0, 7);

    const exactMatch = matches.find(
      (player) => normalizeAlias(player.alias) === normalizedQuery
    );

    const playerButtons = matches
      .map((player) => {
        const unavailable = playerHasActiveTeam(player);
        const teamName = getTeamName(player) || 'aktivt hold';

        return `
          <button
            type="button"
            class="registration-player-option${unavailable ? ' registration-player-option--unavailable' : ''}"
            ${unavailable ? 'disabled aria-disabled="true"' : `data-select-player-id="${escapeHTML(player.id)}"`}
          >
            <span class="registration-player-option__avatar">${escapeHTML(
              (player.alias || '?').charAt(0).toUpperCase()
            )}</span>
            <span>
              <strong>${escapeHTML(player.alias || 'Ukendt spiller')}</strong>
              <small>${escapeHTML(
                unavailable
                  ? `${getPlayerMeta(player)} · Kan ikke vælges`
                  : getPlayerMeta(player)
              )}</small>
            </span>
            <em>${unavailable ? `På ${escapeHTML(teamName)}` : 'Vælg'}</em>
          </button>
        `;
      })
      .join('');

    const newPlayerButton = !exactMatch
      ? `
        <button type="button" class="registration-player-option registration-player-option--new" data-create-player-alias="${escapeHTML(query)}">
          <span class="registration-player-option__avatar">+</span>
          <span>
            <strong>Opret “${escapeHTML(query)}” som ny spiller</strong>
            <small>Brug kun denne mulighed, hvis profilen ikke allerede findes.</small>
          </span>
          <em>Ny</em>
        </button>
      `
      : '';

    suggestions.innerHTML = `
      ${playerButtons || '<p class="registration-player-options-empty">Ingen eksisterende profiler matcher søgningen.</p>'}
      ${newPlayerButton}
    `;

    suggestions.hidden = false;
    input.setAttribute('aria-expanded', 'true');

    suggestions.querySelectorAll('[data-select-player-id]').forEach((button) => {
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        const player = allPlayers.find(
          (candidate) => candidate.id === button.dataset.selectPlayerId
        );

        if (player) selectExistingPlayer(picker, player);
      });
    });

    const createButton = suggestions.querySelector('[data-create-player-alias]');
    if (createButton) {
      createButton.addEventListener('mousedown', (event) => event.preventDefault());
      createButton.addEventListener('click', () => {
        selectNewPlayer(picker, createButton.dataset.createPlayerAlias || query);
      });
    }
  }

  function bindPlayerPicker(picker) {
    const input = picker.querySelector('[data-player-search]');
    const suggestions = picker.querySelector('[data-player-suggestions]');
    if (!input || !suggestions) return;

    input.addEventListener('input', () => {
      clearPickerSelection(picker, { keepValue: true });
      renderSuggestions(picker);
    });

    input.addEventListener('focus', () => {
      if (input.value.trim()) renderSuggestions(picker);
    });

    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        const exactPlayer = findExactPlayer(input.value);

        if (!picker.dataset.selection && exactPlayer && !playerHasActiveTeam(exactPlayer)) {
          selectExistingPlayer(picker, exactPlayer);
        } else if (!picker.dataset.selection && exactPlayer && playerHasActiveTeam(exactPlayer)) {
          picker.classList.add('registration-player-picker--invalid');
          const state = picker.querySelector('[data-player-state]');
          if (state) {
            state.textContent = `${exactPlayer.alias} er allerede på ${getTeamName(exactPlayer) || 'et aktivt hold'} og kan ikke vælges.`;
            state.dataset.state = 'warning';
          }
        } else if (!picker.dataset.selection && input.value.trim()) {
          picker.classList.add('registration-player-picker--invalid');
          const state = picker.querySelector('[data-player-state]');
          if (state) {
            state.textContent = 'Vælg en eksisterende profil eller klik “Opret som ny spiller”.';
            state.dataset.state = 'warning';
          }
        }

        suggestions.hidden = true;
        input.setAttribute('aria-expanded', 'false');
      }, 140);
    });
  }

  function getPickerByFieldName(fieldName) {
    return playerPickers.find(
      (picker) => picker.querySelector('[data-player-search]')?.name === fieldName
    );
  }

  function addCurrentPlayerToRoster() {
    if (!currentClaimedPlayer) return;

    const linkedPlayer =
      allPlayers.find((candidate) => candidate.id === currentClaimedPlayer.id) ||
      currentClaimedPlayer;

    if (playerHasActiveTeam(linkedPlayer)) {
      setRosterMessage(
        `Du er allerede registreret på ${getTeamName(linkedPlayer) || 'et aktivt hold'} og kan ikke oprette eller tilslutte dig et nyt hold.`,
        'error'
      );
      return;
    }

    const alreadySelected = playerPickers.some(
      (picker) =>
        picker.querySelector('[data-player-id]')?.value === currentClaimedPlayer.id
    );

    if (alreadySelected) {
      setRosterMessage('Din spillerprofil er allerede valgt på rosteret.', 'info');
      return;
    }

    const emptyStarter = ['player_1', 'player_2', 'player_3', 'player_4']
      .map(getPickerByFieldName)
      .find((picker) => !picker?.querySelector('[data-player-search]')?.value.trim());

    if (!emptyStarter) {
      setRosterMessage('Der er ingen ledig starterplads. Fjern en spiller først.', 'error');
      return;
    }

    const player = linkedPlayer;

    selectExistingPlayer(emptyStarter, player);
    emptyStarter.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setRosterMessage(`${player.alias} er tilføjet som starter.`, 'success');
  }

  async function linkCaptainIdentity() {
    const VCLData = await waitForDataLayer();

    const [claimedPlayer, profile, session] = await Promise.all([
      VCLData.getMyClaimedPlayer?.() || null,
      VCLData.getCurrentProfile?.() || null,
      VCLData.getSession?.() || null
    ]);

    currentClaimedPlayer = claimedPlayer || null;
    currentProfile = profile || null;
    captainBlockedByTeam = false;
    activeCaptainTeam = null;

    if (!claimedPlayer) {
      if (linkedCaptainBox) linkedCaptainBox.hidden = true;
      if (captainPlayerIdInput) captainPlayerIdInput.value = '';
      if (captainNameInput) {
        captainNameInput.readOnly = false;
        captainNameInput.dataset.linked = 'false';
      }
      if (unlinkCaptainButton) {
        unlinkCaptainButton.hidden = true;
        unlinkCaptainButton.disabled = true;
      }
      if (addMyPlayerButton) addMyPlayerButton.hidden = true;

      if (captainLinkStatus) {
        captainLinkStatus.textContent = session
          ? 'Du har endnu ingen spillerprofil. Den oprettes ved admin-godkendelse, hvis du starter et nyt hold.'
          : 'Har du allerede en VCL-profil, kan du logge ind og koble den automatisk.';
        captainLinkStatus.dataset.status = 'info';
      }
      return;
    }

    const linkedPlayer =
      allPlayers.find((candidate) => candidate.id === claimedPlayer.id) ||
      claimedPlayer;

    if (playerHasActiveTeam(linkedPlayer)) {
      activeCaptainTeam = getTeamName(linkedPlayer) || 'dit nuværende hold';
      captainBlockedByTeam = true;
      form.dataset.activeTeamDetected = 'true';
      form.dataset.membershipLocked = 'true';
      form.classList.add('registration-form--membership-locked');

      let membershipLock = form.querySelector('[data-registration-membership-lock]');
      if (!membershipLock) {
        membershipLock = document.createElement('div');
        membershipLock.className = 'registration-membership-lock registration-membership-lock-v3';
        membershipLock.setAttribute('data-registration-membership-lock', '');
        const progress = form.querySelector('[data-signup-progress]');
        form.insertBefore(membershipLock, progress || form.firstChild);
      }

      membershipLock.innerHTML = `
        <div>
          <span>Allerede registreret</span>
          <strong>Du er allerede en del af ${escapeHTML(activeCaptainTeam)}</strong>
          <p>En spiller kan ikke registrere et nyt hold, mens profilen er koblet til et aktivt VCL-hold. Turneringsdeltagelse håndteres fra den konkrete turneringsside.</p>
        </div>
        ${linkedPlayer.current_team_slug ? `<a href="team-profile.html?team=${encodeURIComponent(linkedPlayer.current_team_slug)}">Se dit hold</a>` : '<a href="teams.html">Se VCL-hold</a>'}
      `;

      if (captainPlayerIdInput) captainPlayerIdInput.value = claimedPlayer.id || '';
      if (captainNameInput) {
        captainNameInput.value = claimedPlayer.alias || '';
        captainNameInput.readOnly = true;
        captainNameInput.dataset.linked = 'true';
      }

      if (captainDiscordInput && !captainDiscordInput.value.trim()) {
        captainDiscordInput.value = claimedPlayer.discord || profile?.discord || '';
      }

      if (captainEmailInput && !captainEmailInput.value.trim()) {
        captainEmailInput.value = profile?.email || session?.user?.email || '';
      }

      if (linkedCaptainBox) linkedCaptainBox.hidden = false;
      if (linkedCaptainName) linkedCaptainName.textContent = claimedPlayer.alias || 'VCL Player';
      if (linkedCaptainMeta) linkedCaptainMeta.textContent = `Aktivt hold: ${activeCaptainTeam}`;

      if (captainLinkStatus) {
        captainLinkStatus.textContent =
          'Din account er allerede koblet til et aktivt VCL-hold.';
        captainLinkStatus.dataset.status = 'info';
      }

      if (unlinkCaptainButton) {
        unlinkCaptainButton.hidden = true;
        unlinkCaptainButton.disabled = true;
      }

      if (addMyPlayerButton) addMyPlayerButton.hidden = true;
      setRosterMessage(`Du er allerede registreret på ${activeCaptainTeam}.`, 'info');
      return;
    }

    form.dataset.membershipLocked = 'false';
    form.classList.remove('registration-form--membership-locked');

    if (captainPlayerIdInput) captainPlayerIdInput.value = claimedPlayer.id || '';
    if (captainNameInput) {
      captainNameInput.value = claimedPlayer.alias || '';
      captainNameInput.readOnly = true;
      captainNameInput.dataset.linked = 'true';
    }

    if (captainDiscordInput && !captainDiscordInput.value.trim()) {
      captainDiscordInput.value = claimedPlayer.discord || profile?.discord || '';
    }

    if (captainEmailInput && !captainEmailInput.value.trim()) {
      captainEmailInput.value = profile?.email || session?.user?.email || '';
    }

    if (linkedCaptainBox) linkedCaptainBox.hidden = false;
    if (linkedCaptainName) linkedCaptainName.textContent = claimedPlayer.alias || 'VCL Player';
    if (linkedCaptainMeta) {
      linkedCaptainMeta.textContent = `${claimedPlayer.primary_role || 'Player'} · permanent player-ID koblet`;
    }

    if (captainLinkStatus) {
      captainLinkStatus.textContent = 'Captain er koblet til din eksisterende VCL-spillerprofil.';
      captainLinkStatus.dataset.status = 'success';
    }

    if (unlinkCaptainButton) {
      unlinkCaptainButton.hidden = false;
      unlinkCaptainButton.disabled = false;
    }

    if (addMyPlayerButton) addMyPlayerButton.hidden = false;
  }

  function unlinkCaptainIdentity() {
    if (captainBlockedByTeam) {
      setRosterMessage(
        `Du kan ikke omgå holdlåsen. Forlad ${activeCaptainTeam || 'dit nuværende hold'} fra din account først.`,
        'error'
      );
      return;
    }

    if (captainPlayerIdInput) captainPlayerIdInput.value = '';
    if (captainNameInput) {
      captainNameInput.readOnly = false;
      captainNameInput.dataset.linked = 'false';
    }
    if (linkedCaptainBox) linkedCaptainBox.hidden = true;
    if (captainLinkStatus) {
      captainLinkStatus.textContent =
        'Captain er nu manuel. Sørg for ikke at skrive aliaset på en eksisterende profil forkert.';
      captainLinkStatus.dataset.status = 'warning';
    }
  }

  function validateLinkedRoster(event) {
    if (captainBlockedByTeam) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setRosterMessage(
        `Du kan ikke oprette et nyt hold, mens du er registreret på ${activeCaptainTeam || 'et aktivt hold'}.`,
        'error'
      );
      return false;
    }

    const filledPickers = playerPickers.filter((picker) =>
      picker.querySelector('[data-player-search]')?.value.trim()
    );

    for (const picker of filledPickers) {
      const input = picker.querySelector('[data-player-search]');
      const idInput = picker.querySelector('[data-player-id]');
      const typeInput = picker.querySelector('[data-player-link-type]');
      const exactPlayer = findExactPlayer(input?.value || '');

      if (!typeInput?.value && exactPlayer) {
        selectExistingPlayer(picker, exactPlayer);
      }

      if (!typeInput?.value) {
        event.preventDefault();
        event.stopImmediatePropagation();
        picker.classList.add('registration-player-picker--invalid');
        input?.focus();
        setRosterMessage(
          `Vælg om “${input?.value || 'spilleren'}” er en eksisterende eller ny profil.`,
          'error'
        );
        return false;
      }

      if (typeInput.value === 'existing' && !idInput?.value) {
        event.preventDefault();
        event.stopImmediatePropagation();
        input?.focus();
        setRosterMessage('En eksisterende spiller mangler sit player-ID. Vælg profilen igen.', 'error');
        return false;
      }

      if (typeInput.value === 'existing') {
        const selectedPlayer = allPlayers.find((player) => player.id === idInput?.value);

        if (selectedPlayer && playerHasActiveTeam(selectedPlayer)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          picker.classList.add('registration-player-picker--invalid');
          input?.focus();
          setRosterMessage(
            `${selectedPlayer.alias} er allerede på ${getTeamName(selectedPlayer) || 'et aktivt hold'} og kan ikke vælges.`,
            'error'
          );
          return false;
        }
      }
    }

    const seenIds = new Set();
    const seenAliases = new Set();

    for (const picker of filledPickers) {
      const input = picker.querySelector('[data-player-search]');
      const id = picker.querySelector('[data-player-id]')?.value || '';
      const alias = normalizeAlias(input?.value || '');

      if ((id && seenIds.has(id)) || (alias && seenAliases.has(alias))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        picker.classList.add('registration-player-picker--invalid');
        input?.focus();
        setRosterMessage(`${input?.value || 'Spilleren'} er valgt mere end én gang.`, 'error');
        return false;
      }

      if (id) seenIds.add(id);
      if (alias) seenAliases.add(alias);
    }

    const captainAlias = normalizeAlias(captainNameInput?.value || '');
    const captainId = captainPlayerIdInput?.value || '';
    const existingCaptain = findExactPlayer(captainNameInput?.value || '');

    if (existingCaptain && existingCaptain.id !== captainId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      captainNameInput?.focus();
      setRosterMessage(
        `Captain-aliaset “${existingCaptain.alias}” findes allerede. Log ind på den account, der har claimet profilen, så den kan kobles sikkert.`,
        'error'
      );
      return false;
    }

    if (captainAlias && captainId && !seenIds.has(captainId)) {
      setRosterMessage(
        'Captain er koblet korrekt. Husk også at tilføje captain til rosteret, hvis personen skal spille.',
        'info'
      );
    }

    return true;
  }

  function installSubmitPayloadOverride(VCLData) {
    if (submitOverrideInstalled || !VCLData?.submitTeamSignup) return;

    const originalSubmit = VCLData.submitTeamSignup.bind(VCLData);

    VCLData.submitTeamSignup = async (signup) => {
      const attachPlayerLink = (player, prefix) => {
        const picker = getPickerByFieldName(`${prefix}_${player.slot}`);
        const playerId = picker?.querySelector('[data-player-id]')?.value || '';
        const linkType = picker?.querySelector('[data-player-link-type]')?.value || 'new';

        return {
          ...player,
          player_id: playerId || null,
          link_type: linkType
        };
      };

      const linkedSignup = {
        ...signup,
        captain_player_id: captainPlayerIdInput?.value || null,
        roster: (signup.roster || []).map((player) => attachPlayerLink(player, 'player')),
        substitutes: (signup.substitutes || []).map((player) => attachPlayerLink(player, 'sub'))
      };

      return originalSubmit(linkedSignup);
    };

    submitOverrideInstalled = true;
  }

  async function initialise() {
    try {
      const VCLData = await waitForDataLayer();
      installSubmitPayloadOverride(VCLData);

      playerPickers.forEach(bindPlayerPicker);

      await loadPlayerOptions();
      await linkCaptainIdentity();

      if (currentClaimedPlayer && !allPlayers.some((player) => player.id === currentClaimedPlayer.id)) {
        allPlayers.unshift({
          ...currentClaimedPlayer,
          current_team_name: '',
          has_active_team: Boolean(currentClaimedPlayer.current_team_id)
        });
      }
    } catch (error) {
      console.error('Player linking kunne ikke initialiseres:', error);
      setRosterMessage(
        'Spillersøgningen kunne ikke indlæses. Genindlæs siden, før du sender registreringen.',
        'error'
      );
    }
  }

  form.addEventListener('submit', validateLinkedRoster, true);

  form.addEventListener('reset', () => {
    window.setTimeout(() => {
      playerPickers.forEach((picker) => clearPickerSelection(picker, { keepValue: false }));
      if (currentClaimedPlayer) linkCaptainIdentity();
    }, 0);
  });

  addMyPlayerButton?.addEventListener('click', addCurrentPlayerToRoster);
  unlinkCaptainButton?.addEventListener('click', unlinkCaptainIdentity);

  document.addEventListener('click', (event) => {
    playerPickers.forEach((picker) => {
      if (picker.contains(event.target)) return;
      const suggestions = picker.querySelector('[data-player-suggestions]');
      const input = picker.querySelector('[data-player-search]');
      if (suggestions) suggestions.hidden = true;
      input?.setAttribute('aria-expanded', 'false');
    });
  });

  initialise();
})();
