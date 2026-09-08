(() => {
  const entriesRoot = document.querySelector('[data-admin-tournament-entries]');
  if (!entriesRoot) return;

  const escapeHTML = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let refreshTimer = null;
  let refreshRunning = false;

  async function getDb() {
    if (window.vclSupabase) return window.vclSupabase;
    if (window.vclSupabaseReady) return window.vclSupabaseReady;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (window.vclSupabase) return window.vclSupabase;
      await wait(100);
    }

    throw new Error('Supabase blev ikke klar.');
  }

  function renderPlayer(player) {
    const sourceLabels = {
      team: '',
      loan_team: ' · Loan',
      loan_free_agent: ' · Stand-in'
    };

    return `
      <span class="admin-tournament-roster-preview__player">
        <strong>${escapeHTML(player.player_alias_snapshot || 'Ukendt spiller')}</strong>
        <small>${escapeHTML(player.primary_role_snapshot || 'Player')}${escapeHTML(sourceLabels[player.source] || '')}</small>
      </span>
    `;
  }

  function injectPreview(card, rows = []) {
    card.querySelector('[data-admin-tournament-roster-preview]')?.remove();

    const preview = document.createElement('div');
    preview.className = 'admin-tournament-roster-preview';
    preview.setAttribute('data-admin-tournament-roster-preview', '');

    const starters = rows.filter((row) => row.role === 'starter');
    const substitutes = rows.filter((row) => row.role === 'substitute');

    if (!rows.length) {
      preview.classList.add('is-missing');
      preview.innerHTML = `
        <div class="admin-tournament-roster-preview__head">
          <strong>Tournament roster mangler</strong>
          <span>Captain har endnu ikke bekræftet lineup.</span>
        </div>
      `;
    } else {
      preview.innerHTML = `
        <div class="admin-tournament-roster-preview__head">
          <strong>Tournament roster</strong>
          <span>${starters.length} starters · ${substitutes.length} substitutes</span>
        </div>

        <div class="admin-tournament-roster-preview__group">
          <span>Starters</span>
          <div>${starters.map(renderPlayer).join('') || '<small>Ingen starters</small>'}</div>
        </div>

        <div class="admin-tournament-roster-preview__group">
          <span>Substitutes</span>
          <div>${substitutes.map(renderPlayer).join('') || '<small>Ingen substitutes</small>'}</div>
        </div>
      `;
    }

    const actions = card.querySelector('.admin-tournament-entry-card__actions');
    if (actions) actions.insertAdjacentElement('beforebegin', preview);
    else card.appendChild(preview);
  }

  async function refreshPreviews() {
    if (refreshRunning) return;

    const cards = [...entriesRoot.querySelectorAll('[data-entry-id]')];
    if (!cards.length) return;

    refreshRunning = true;

    try {
      const db = await getDb();
      const ids = cards.map((card) => card.dataset.entryId).filter(Boolean);

      const { data, error } = await db
        .from('tournament_roster_players')
        .select('entry_id, player_id, role, source, player_alias_snapshot, primary_role_snapshot, created_at')
        .in('entry_id', ids)
        .order('created_at', { ascending: true });

      if (error) {
        const migrationMissing = ['42P01', 'PGRST205'].includes(error.code);
        if (!migrationMissing) {
          console.warn('Kunne ikke hente tournament rosters i admin:', error);
        }
        return;
      }

      const grouped = new Map();
      (data || []).forEach((row) => {
        const key = String(row.entry_id || '');
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
      });

      cards.forEach((card) => {
        const rows = grouped.get(String(card.dataset.entryId || '')) || [];
        injectPreview(card, rows);
      });
    } catch (error) {
      console.warn('Tournament roster preview kunne ikke initialiseres:', error);
    } finally {
      refreshRunning = false;
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshPreviews, 100);
  }

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(entriesRoot, { childList: true, subtree: true });

  scheduleRefresh();
})();
