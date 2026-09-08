(() => {
  'use strict';

  const page = document.querySelector('[data-account-page]');
  const section = document.querySelector('[data-tournament-loan-invites-section]');
  const list = document.querySelector('[data-tournament-loan-invites-list]');
  if (!page || !section || !list) return;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const escapeHTML = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  let db = null;
  let actionRunning = false;

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

  function teamMark(url, name, fallback = 'V') {
    if (url) {
      return `<span class="account-loan-team-mark"><img src="${escapeHTML(url)}" alt="" loading="lazy"></span>`;
    }
    return `<span class="account-loan-team-mark">${escapeHTML((name || fallback).trim().charAt(0).toUpperCase() || fallback)}</span>`;
  }

  function tournamentLink(request) {
    const name = escapeHTML(request.tournament_name || 'VCL-turnering');
    const slug = String(request.tournament_slug || '').trim();
    return slug
      ? `<a href="turnering.html?tournament=${encodeURIComponent(slug)}">${name}</a>`
      : `<strong>${name}</strong>`;
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
      const sourceName = request.home_team_name || 'Free Agent';
      const teamName = request.requesting_team_name || 'VCL-hold';
      const role = request.requested_role === 'starter' ? 'Starter' : 'Substitute';
      const replacement = request.replaces_player_alias
        ? `Du er tænkt som starter i stedet for ${escapeHTML(request.replaces_player_alias)}.`
        : request.requested_role === 'starter'
          ? 'Du er tænkt som starter i lineupet.'
          : 'Du er tænkt som substitute.';
      const message = String(request.message || '').trim();

      return `
        <article class="account-loan-invite" data-tournament-loan-request="${escapeHTML(request.id)}">
          <div class="account-loan-invite__route">
            <div>
              ${teamMark(request.home_team_logo_url, sourceName, 'FA')}
              <span><small>Permanent status</small><strong>${escapeHTML(sourceName)}</strong></span>
            </div>
            <b aria-hidden="true">→</b>
            <div>
              ${teamMark(request.requesting_team_logo_url, teamName)}
              <span><small>Stand-in for</small><strong>${escapeHTML(teamName)}</strong></span>
            </div>
          </div>

          <div class="account-loan-invite__copy">
            <span>Tournament stand-in · ${role}</span>
            <h3>${escapeHTML(teamName)} vil låne dig</h3>
            <p>${tournamentLink(request)} · ${replacement}</p>
            <p>Accepterer du, ændrer det <strong>ikke</strong> dit permanente hold. Du bliver kun reserveret til ${escapeHTML(teamName)} i denne turnering.</p>
            ${message ? `<blockquote>${escapeHTML(message)}</blockquote>` : ''}
            ${request.expires_at ? `<small>Request udløber ${escapeHTML(formatExpiry(request.expires_at))}</small>` : ''}
          </div>

          <div class="account-loan-invite__actions">
            <button type="button" data-accept-tournament-loan="${escapeHTML(request.id)}" data-team-name="${escapeHTML(teamName)}" data-tournament-name="${escapeHTML(request.tournament_name || 'turneringen')}">Accepter stand-in</button>
            <button type="button" class="is-secondary" data-decline-tournament-loan="${escapeHTML(request.id)}">Afvis</button>
          </div>

          <p class="notice account-loan-invite__status" data-tournament-loan-status="${escapeHTML(request.id)}" aria-live="polite"></p>
        </article>
      `;
    }).join('');

    list.querySelectorAll('[data-accept-tournament-loan]').forEach((button) => {
      button.addEventListener('click', () => respond(button, 'accept'));
    });
    list.querySelectorAll('[data-decline-tournament-loan]').forEach((button) => {
      button.addEventListener('click', () => respond(button, 'decline'));
    });
  }

  async function load() {
    try {
      const client = await getDb();
      const { data, error } = await client.rpc('get_my_tournament_loan_requests');
      if (error) {
        if (['42883', 'PGRST202', 'PGRST204'].includes(error.code)) {
          section.hidden = true;
          return;
        }
        throw error;
      }
      render(data || { requests: [] });
    } catch (error) {
      console.warn('Stand-in requests kunne ikke indlæses:', error);
      section.hidden = true;
    }
  }

  async function respond(button, decision) {
    if (actionRunning) return;
    const requestId = decision === 'accept'
      ? button.dataset.acceptTournamentLoan
      : button.dataset.declineTournamentLoan;
    if (!requestId) return;

    if (decision === 'accept') {
      const teamName = button.dataset.teamName || 'holdet';
      const tournamentName = button.dataset.tournamentName || 'turneringen';
      const confirmed = window.confirm(
        `Accepter at være stand-in for ${teamName} i ${tournamentName}? Dit permanente hold ændres ikke.`
      );
      if (!confirmed) return;
    }

    const card = button.closest('[data-tournament-loan-request]');
    const status = card?.querySelector(`[data-tournament-loan-status="${CSS.escape(requestId)}"]`);
    const buttons = card ? [...card.querySelectorAll('button')] : [button];
    actionRunning = true;

    try {
      buttons.forEach((item) => { item.disabled = true; });
      if (status) {
        status.textContent = decision === 'accept' ? 'Reserverer dig som stand-in…' : 'Afviser request…';
        status.dataset.status = 'info';
      }

      const client = await getDb();
      const { data, error } = await client.rpc('respond_to_tournament_loan_request', {
        p_request_id: requestId,
        p_decision: decision
      });
      if (error) throw error;

      if (data?.status === 'expired') {
        if (status) {
          status.textContent = data.message || 'Requesten er udløbet.';
          status.dataset.status = 'error';
        }
        window.setTimeout(load, 600);
        return;
      }

      if (status) {
        status.textContent = decision === 'accept'
          ? `Accepteret. Du er nu reserveret som stand-in for ${data?.requesting_team_name || 'holdet'} i ${data?.tournament_name || 'turneringen'}.`
          : 'Stand-in requesten er afvist.';
        status.dataset.status = 'success';
      }

      window.setTimeout(load, 900);
    } catch (error) {
      console.error('Stand-in request kunne ikke behandles:', error);
      buttons.forEach((item) => { item.disabled = false; });
      if (status) {
        status.textContent = error?.message || 'Requesten kunne ikke behandles.';
        status.dataset.status = 'error';
      }
    } finally {
      actionRunning = false;
    }
  }

  load();
  window.addEventListener('focus', load);
})();
