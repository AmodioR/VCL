(() => {
  const page = document.querySelector('[data-team-dashboard-page]');
  const section = document.querySelector('[data-direct-transfer-section]');
  if (!page || !section) return;

  const searchInput = section.querySelector('[data-transfer-search]');
  const messageInput = section.querySelector('[data-transfer-message]');
  const candidatesRoot = section.querySelector('[data-transfer-candidates]');
  const historyRoot = section.querySelector('[data-transfer-history]');
  const status = section.querySelector('[data-transfer-workspace-status]');
  const teamLabel = section.querySelector('[data-transfer-team-label]');

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const escapeHTML = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  let db = null;
  let candidatePayload = null;
  let historyPayload = null;
  let searchTimer = null;
  let requestRunning = false;

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

  function setStatus(message = '', type = '') {
    if (!status) return;
    status.textContent = message;
    status.dataset.status = type;
  }

  function formatRelativeTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const diff = Date.now() - date.getTime();
    const minutes = Math.max(0, Math.floor(diff / 60000));
    if (minutes < 1) return 'Lige nu';
    if (minutes < 60) return `${minutes} min siden`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} t siden`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'I går';
    if (days < 7) return `${days} dage siden`;
    return date.toLocaleDateString('da-DK', { day: '2-digit', month: 'short' });
  }

  function avatarMarkup(player) {
    const alias = player.alias || player.player_alias || 'V';
    const image = player.avatar_url || player.player_avatar_url || '';
    if (image) {
      return `<span class="direct-transfer-avatar"><img src="${escapeHTML(image)}" alt="" loading="lazy"></span>`;
    }
    return `<span class="direct-transfer-avatar">${escapeHTML(alias.trim().charAt(0).toUpperCase() || 'V')}</span>`;
  }

  function teamLogoMarkup(url, name) {
    if (url) {
      return `<span class="direct-transfer-team-logo"><img src="${escapeHTML(url)}" alt="" loading="lazy"></span>`;
    }
    return `<span class="direct-transfer-team-logo">${escapeHTML((name || 'V').trim().charAt(0).toUpperCase() || 'V')}</span>`;
  }

  function renderCandidates() {
    if (!candidatesRoot) return;
    const candidates = Array.isArray(candidatePayload?.candidates)
      ? candidatePayload.candidates
      : [];

    if (!candidates.length) {
      candidatesRoot.innerHTML = `
        <div class="direct-transfer-empty">
          <strong>Ingen spillere matcher søgningen</strong>
          <p>Kun claimed spillere, der allerede tilhører et andet VCL-hold, kan modtage en direkte transferanmodning.</p>
        </div>
      `;
      return;
    }

    candidatesRoot.innerHTML = candidates.map((player) => {
      const pending = Boolean(player.pending_request_id);
      const teamName = player.current_team_name || 'Ukendt hold';
      const meta = [player.primary_role, player.level].filter(Boolean).join(' · ') || 'VCL Player';
      const profileHref = player.slug
        ? `player-profile.html?player=${encodeURIComponent(player.slug)}`
        : '#';

      return `
        <article class="direct-transfer-candidate" data-transfer-player-id="${escapeHTML(player.player_id)}">
          <div class="direct-transfer-candidate__player">
            ${avatarMarkup(player)}
            <div>
              <a href="${profileHref}">${escapeHTML(player.alias || 'Ukendt spiller')}</a>
              <span>${escapeHTML(meta)}</span>
            </div>
          </div>

          <div class="direct-transfer-candidate__team">
            ${teamLogoMarkup(player.current_team_logo_url, teamName)}
            <div>
              <small>Nuværende hold</small>
              <strong>${escapeHTML(teamName)}</strong>
            </div>
          </div>

          <div class="direct-transfer-candidate__action">
            <button
              type="button"
              data-send-direct-transfer
              data-player-id="${escapeHTML(player.player_id)}"
              data-player-alias="${escapeHTML(player.alias || 'spilleren')}"
              ${pending ? 'disabled' : ''}
            >${pending ? 'Afventer svar' : 'Send transfer request'}</button>
            ${pending ? `<small>${escapeHTML(formatRelativeTime(player.pending_requested_at))}</small>` : ''}
          </div>
        </article>
      `;
    }).join('');

    candidatesRoot.querySelectorAll('[data-send-direct-transfer]').forEach((button) => {
      button.addEventListener('click', () => sendRequest(button));
    });
  }

  const statusLabel = (value) => ({
    pending: 'Afventer spiller',
    accepted: 'Accepteret',
    declined: 'Afvist',
    cancelled: 'Annulleret',
    invalidated: 'Ugyldig',
    expired: 'Udløbet'
  }[value] || value || 'Ukendt');

  function renderHistory() {
    if (!historyRoot) return;
    const rows = Array.isArray(historyPayload?.requests) ? historyPayload.requests : [];

    if (!rows.length) {
      historyRoot.innerHTML = `
        <div class="direct-transfer-empty direct-transfer-empty--compact">
          <strong>Ingen transferaktivitet endnu</strong>
          <p>Sendte requests og gennemførte transfers bliver samlet her.</p>
        </div>
      `;
      return;
    }

    historyRoot.innerHTML = rows.slice(0, 20).map((row) => {
      const isPending = row.status === 'pending' && row.direction === 'in';
      const isOutboundMove = row.status === 'accepted' && row.direction === 'out';
      const routeFrom = row.from_team_name || 'Team A';
      const routeTo = row.to_team_name || 'Team B';
      let copy = `${row.player_alias || 'Spilleren'}: ${routeFrom} → ${routeTo}`;

      if (isOutboundMove) {
        copy = `${row.player_alias || 'Spilleren'} forlod ${routeFrom} og skiftede til ${routeTo}.`;
      } else if (row.status === 'accepted') {
        copy = `${row.player_alias || 'Spilleren'} accepterede transferen til ${routeTo}.`;
      } else if (row.status === 'declined') {
        copy = `${row.player_alias || 'Spilleren'} afviste transferen til ${routeTo}.`;
      } else if (row.status === 'pending') {
        copy = `${row.player_alias || 'Spilleren'} har en aktiv transferanmodning fra ${routeTo}.`;
      }

      return `
        <article class="direct-transfer-history-row direct-transfer-history-row--${escapeHTML(row.status || 'unknown')}">
          <div class="direct-transfer-history-row__identity">
            ${avatarMarkup(row)}
            <div>
              <strong>${escapeHTML(row.player_alias || 'Ukendt spiller')}</strong>
              <p>${escapeHTML(copy)}</p>
            </div>
          </div>

          <div class="direct-transfer-history-row__route" aria-label="Transfer route">
            ${teamLogoMarkup(row.from_team_logo_url, routeFrom)}
            <span>→</span>
            ${teamLogoMarkup(row.to_team_logo_url, routeTo)}
          </div>

          <div class="direct-transfer-history-row__state">
            <span data-transfer-state="${escapeHTML(row.status || '')}">${escapeHTML(statusLabel(row.status))}</span>
            <small>${escapeHTML(formatRelativeTime(row.responded_at || row.created_at))}</small>
            ${isPending ? `<button type="button" data-cancel-direct-transfer="${escapeHTML(row.id)}">Annuller</button>` : ''}
          </div>
        </article>
      `;
    }).join('');

    historyRoot.querySelectorAll('[data-cancel-direct-transfer]').forEach((button) => {
      button.addEventListener('click', () => cancelRequest(button));
    });
  }

  async function loadCandidates(search = '') {
    const client = await getDb();
    const { data, error } = await client.rpc('get_my_team_transfer_candidates', {
      p_search: search || null
    });
    if (error) throw error;
    candidatePayload = data || { candidates: [] };
    if (teamLabel && candidatePayload?.team?.name) {
      teamLabel.textContent = candidatePayload.team.name;
    }
    renderCandidates();
  }

  async function loadHistory() {
    const client = await getDb();
    const { data, error } = await client.rpc('get_my_captain_transfer_requests');
    if (error) throw error;
    historyPayload = data || { requests: [] };
    renderHistory();
  }

  async function refresh() {
    try {
      await Promise.all([
        loadCandidates(searchInput?.value?.trim() || ''),
        loadHistory()
      ]);
      setStatus('');
    } catch (error) {
      const missing = ['42883', 'PGRST202', 'PGRST204'].includes(error?.code);
      console.error('Direct transfers kunne ikke indlæses:', error);
      if (candidatesRoot) {
        candidatesRoot.innerHTML = `
          <div class="direct-transfer-empty is-error">
            <strong>${missing ? 'Direct transfer-backenden mangler' : 'Transfers kunne ikke indlæses'}</strong>
            <p>${missing ? 'Kør 20260908_direct_team_transfers.sql i Supabase og genindlæs siden.' : 'Prøv at genindlæse siden om et øjeblik.'}</p>
          </div>
        `;
      }
      setStatus(error?.message || 'Direct transfers kunne ikke indlæses.', 'error');
    }
  }

  async function sendRequest(button) {
    if (requestRunning) return;
    const playerId = button.dataset.playerId;
    const alias = button.dataset.playerAlias || 'spilleren';
    if (!playerId) return;

    if (!window.confirm(`Send en direkte transferanmodning til ${alias}? Spilleren skifter først hold, hvis de selv accepterer.`)) {
      return;
    }

    requestRunning = true;
    const originalText = button.textContent;

    try {
      button.disabled = true;
      button.textContent = 'Sender…';
      setStatus(`Sender transferanmodning til ${alias}…`, 'info');

      const client = await getDb();
      const { error } = await client.rpc('create_player_transfer_request', {
        p_player_id: playerId,
        p_message: messageInput?.value?.trim() || ''
      });
      if (error) throw error;

      if (messageInput) messageInput.value = '';
      setStatus(`Transferanmodningen er sendt til ${alias}.`, 'success');
      await Promise.all([
        loadCandidates(searchInput?.value?.trim() || ''),
        loadHistory()
      ]);
    } catch (error) {
      console.error('Kunne ikke sende transferanmodning:', error);
      button.disabled = false;
      button.textContent = originalText;
      setStatus(error?.message || 'Transferanmodningen kunne ikke sendes.', 'error');
    } finally {
      requestRunning = false;
    }
  }

  async function cancelRequest(button) {
    const requestId = button.dataset.cancelDirectTransfer;
    if (!requestId) return;
    if (!window.confirm('Annuller denne transferanmodning?')) return;

    try {
      button.disabled = true;
      button.textContent = 'Annullerer…';
      const client = await getDb();
      const { error } = await client.rpc('cancel_my_player_transfer_request', {
        p_request_id: requestId
      });
      if (error) throw error;
      setStatus('Transferanmodningen er annulleret.', 'success');
      await Promise.all([
        loadCandidates(searchInput?.value?.trim() || ''),
        loadHistory()
      ]);
    } catch (error) {
      console.error('Kunne ikke annullere transferanmodning:', error);
      button.disabled = false;
      button.textContent = 'Annuller';
      setStatus(error?.message || 'Transferanmodningen kunne ikke annulleres.', 'error');
    }
  }

  searchInput?.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      try {
        await loadCandidates(searchInput.value.trim());
      } catch (error) {
        console.error('Transfersøgning fejlede:', error);
        setStatus(error?.message || 'Søgningen kunne ikke gennemføres.', 'error');
      }
    }, 250);
  });

  refresh();
})();
