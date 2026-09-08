(() => {
  const page = document.querySelector('[data-account-page]');
  const section = document.querySelector('[data-transfer-invites-section]');
  const list = document.querySelector('[data-transfer-invites-list]');
  if (!page || !section || !list) return;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const escapeHTML = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  let db = null;
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

  function formatExpiry(value) {
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

  function teamLogo(url, name) {
    if (url) {
      return `<span class="direct-transfer-team-logo direct-transfer-team-logo--account"><img src="${escapeHTML(url)}" alt="" loading="lazy"></span>`;
    }
    return `<span class="direct-transfer-team-logo direct-transfer-team-logo--account">${escapeHTML((name || 'V').trim().charAt(0).toUpperCase() || 'V')}</span>`;
  }

  function render(payload) {
    const requests = Array.isArray(payload?.requests) ? payload.requests : [];

    if (!requests.length) {
      section.hidden = true;
      list.innerHTML = '';
      return;
    }

    section.hidden = false;
    list.innerHTML = requests.map((request) => {
      const fromName = request.from_team_name || 'Dit nuværende hold';
      const toName = request.to_team_name || 'Nyt hold';
      const message = String(request.message || '').trim();

      return `
        <article class="account-transfer-invite" data-player-transfer-request="${escapeHTML(request.id)}">
          <div class="account-transfer-invite__route">
            <div>
              ${teamLogo(request.from_team_logo_url, fromName)}
              <span><small>Fra</small><strong>${escapeHTML(fromName)}</strong></span>
            </div>
            <b aria-hidden="true">→</b>
            <div>
              ${teamLogo(request.to_team_logo_url, toName)}
              <span><small>Til</small><strong>${escapeHTML(toName)}</strong></span>
            </div>
          </div>

          <div class="account-transfer-invite__copy">
            <span>Direkte transfer</span>
            <h3>${escapeHTML(toName)} vil hente dig</h3>
            <p>Hvis du accepterer, forlader du <strong>${escapeHTML(fromName)}</strong> og bliver permanent tilføjet til <strong>${escapeHTML(toName)}</strong> som substitute. Din captain på ${escapeHTML(fromName)} skal ikke godkende skiftet.</p>
            ${message ? `<blockquote>${escapeHTML(message)}</blockquote>` : ''}
            ${request.expires_at ? `<small>Request udløber ${escapeHTML(formatExpiry(request.expires_at))}</small>` : ''}
          </div>

          <div class="account-transfer-invite__actions">
            <button type="button" data-accept-player-transfer="${escapeHTML(request.id)}" data-from-team="${escapeHTML(fromName)}" data-to-team="${escapeHTML(toName)}">Accepter transfer</button>
            <button type="button" class="is-secondary" data-decline-player-transfer="${escapeHTML(request.id)}">Afvis</button>
          </div>

          <p class="notice account-transfer-invite__status" data-player-transfer-status="${escapeHTML(request.id)}" aria-live="polite"></p>
        </article>
      `;
    }).join('');

    list.querySelectorAll('[data-accept-player-transfer]').forEach((button) => {
      button.addEventListener('click', () => respond(button, 'accept'));
    });

    list.querySelectorAll('[data-decline-player-transfer]').forEach((button) => {
      button.addEventListener('click', () => respond(button, 'decline'));
    });
  }

  async function load() {
    try {
      const client = await getDb();
      const { data, error } = await client.rpc('get_my_player_transfer_requests');
      if (error) {
        const missing = ['42883', 'PGRST202', 'PGRST204'].includes(error.code);
        if (missing) {
          section.hidden = true;
          return;
        }
        throw error;
      }
      render(data || { requests: [] });
    } catch (error) {
      console.warn('Transferinvitationer kunne ikke indlæses:', error);
      section.hidden = true;
    }
  }

  async function respond(button, decision) {
    if (requestRunning) return;
    const requestId = decision === 'accept'
      ? button.dataset.acceptPlayerTransfer
      : button.dataset.declinePlayerTransfer;
    if (!requestId) return;

    if (decision === 'accept') {
      const fromTeam = button.dataset.fromTeam || 'dit nuværende hold';
      const toTeam = button.dataset.toTeam || 'det nye hold';
      const confirmed = window.confirm(
        `Accepter transfer fra ${fromTeam} til ${toTeam}? Du forlader dit nuværende hold med det samme.`
      );
      if (!confirmed) return;
    }

    const card = button.closest('[data-player-transfer-request]');
    const status = card?.querySelector(`[data-player-transfer-status="${CSS.escape(requestId)}"]`);
    const buttons = card ? [...card.querySelectorAll('button')] : [button];
    requestRunning = true;

    try {
      buttons.forEach((item) => { item.disabled = true; });
      if (status) {
        status.textContent = decision === 'accept' ? 'Gennemfører transfer…' : 'Afviser transfer…';
        status.dataset.status = 'info';
      }

      const client = await getDb();
      const { data, error } = await client.rpc('respond_to_player_transfer_request', {
        p_request_id: requestId,
        p_decision: decision
      });
      if (error) throw error;

      if (data?.status === 'expired') {
        if (status) {
          status.textContent = data.message || 'Transferanmodningen er udløbet.';
          status.dataset.status = 'error';
        }
        window.setTimeout(load, 600);
        return;
      }

      if (status) {
        status.textContent = decision === 'accept'
          ? `Transfer gennemført. Du er nu på ${data?.to_team_name || 'dit nye hold'}.`
          : 'Transferanmodningen er afvist.';
        status.dataset.status = 'success';
      }

      if (decision === 'accept') {
        window.setTimeout(() => window.location.reload(), 1000);
      } else {
        window.setTimeout(load, 650);
      }
    } catch (error) {
      console.error('Kunne ikke svare på transferanmodning:', error);
      buttons.forEach((item) => { item.disabled = false; });
      if (status) {
        status.textContent = error?.message || 'Transferanmodningen kunne ikke behandles.';
        status.dataset.status = 'error';
      }
    } finally {
      requestRunning = false;
    }
  }

  load();
})();
