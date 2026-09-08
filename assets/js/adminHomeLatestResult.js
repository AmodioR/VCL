(() => {
  const tournamentsView = document.querySelector('#admin-tournaments');
  if (!tournamentsView) return;

  const GENERIC_TOURNAMENTS = [
    { key: 'academy', name: 'Academy Cup', url: 'academy-cup.html' },
    { key: 'contender', name: 'Contender Series', url: 'contender-series.html' },
    { key: 'championship', name: 'Championship', url: 'championship.html' },
    { key: 'dm', name: 'DM', url: 'turneringer.html' }
  ];

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function getDb() {
    if (window.vclSupabase) return window.vclSupabase;
    if (window.vclSupabaseReady) {
      try {
        return await window.vclSupabaseReady;
      } catch (error) {
        console.error('Supabase blev ikke klar:', error);
      }
    }

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (window.vclSupabase) return window.vclSupabase;
      await wait(100);
    }

    throw new Error('Supabase blev ikke klar.');
  }

  function escapeHTML(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const editor = document.createElement('section');
  editor.className = 'admin-editor-v2 admin-home-result-editor-v1';
  editor.innerHTML = `
    <div class="admin-section-title-v2">
      <span>Forside</span>
      <h2>Seneste resultat</h2>
      <p>Vælg en fast VCL-kategori eller en konkret turnering. Holdnavne, logoer og links hentes automatisk.</p>
    </div>

    <form class="admin-form-v2" data-admin-home-result-form>
      <label>
        <span>Turnering</span>
        <select name="tournament_source" required>
          <option value="">Vælg turnering</option>
        </select>
      </label>

      <div class="admin-form-grid-v2">
        <label>
          <span>Hold A</span>
          <select name="team_a_id" required>
            <option value="">Vælg hold</option>
          </select>
        </label>
        <label>
          <span>Score A</span>
          <input name="team_a_score" type="number" min="0" value="3" required>
        </label>
      </div>

      <div class="admin-form-grid-v2">
        <label>
          <span>Hold B</span>
          <select name="team_b_id" required>
            <option value="">Vælg hold</option>
          </select>
        </label>
        <label>
          <span>Score B</span>
          <input name="team_b_score" type="number" min="0" value="0" required>
        </label>
      </div>

      <label>
        <span>Runde</span>
        <input name="round_label" type="text" value="Grand Final" placeholder="Fx Grand Final">
      </label>

      <label>
        <span>Kort resultattekst <small>valgfrit</small></span>
        <textarea name="summary" rows="3" placeholder="Fx Frontline sikrede titlen efter en 3-1 sejr i Grand Final."></textarea>
      </label>

      <p class="notice" data-admin-home-result-preview></p>

      <div class="admin-form-actions-v2">
        <button type="submit">Vis resultat på forsiden</button>
        <button type="button" data-admin-home-result-clear>Fjern fra forsiden</button>
      </div>
      <p class="notice" data-admin-home-result-status aria-live="polite"></p>
    </form>
  `;

  const tournamentLayout = tournamentsView.querySelector('.admin-tournament-layout');
  if (tournamentLayout) {
    tournamentsView.insertBefore(editor, tournamentLayout);
  } else {
    tournamentsView.appendChild(editor);
  }

  const form = editor.querySelector('[data-admin-home-result-form]');
  const tournamentSelect = form.querySelector('[name="tournament_source"]');
  const teamASelect = form.querySelector('[name="team_a_id"]');
  const teamBSelect = form.querySelector('[name="team_b_id"]');
  const scoreAInput = form.querySelector('[name="team_a_score"]');
  const scoreBInput = form.querySelector('[name="team_b_score"]');
  const roundInput = form.querySelector('[name="round_label"]');
  const summaryInput = form.querySelector('[name="summary"]');
  const status = editor.querySelector('[data-admin-home-result-status]');
  const preview = editor.querySelector('[data-admin-home-result-preview]');
  const clearButton = editor.querySelector('[data-admin-home-result-clear]');

  let tournaments = [];
  let teams = [];

  function setStatus(message, type = 'info') {
    if (!status) return;
    status.textContent = message || '';
    status.dataset.status = type;
  }

  function selectedOptionText(select) {
    return select?.selectedOptions?.[0]?.textContent?.trim() || '';
  }

  function getSelectedTournament() {
    const value = String(tournamentSelect.value || '');
    if (!value) return null;

    if (value.startsWith('generic:')) {
      const key = value.slice('generic:'.length);
      const generic = GENERIC_TOURNAMENTS.find((item) => item.key === key);
      return generic
        ? {
            type: 'generic',
            id: null,
            key: generic.key,
            name: generic.name,
            url: generic.url
          }
        : null;
    }

    if (value.startsWith('db:')) {
      const id = value.slice('db:'.length);
      const tournament = tournaments.find((item) => String(item.id) === id);
      return tournament
        ? {
            type: 'db',
            id: tournament.id,
            key: null,
            name: tournament.name,
            url: `turnering.html?tournament=${encodeURIComponent(tournament.slug || '')}`
          }
        : null;
    }

    return null;
  }

  function updatePreview() {
    const tournament = selectedOptionText(tournamentSelect);
    const teamA = selectedOptionText(teamASelect);
    const teamB = selectedOptionText(teamBSelect);
    const scoreA = scoreAInput.value;
    const scoreB = scoreBInput.value;

    if (!tournamentSelect.value || !teamASelect.value || !teamBSelect.value) {
      preview.textContent = 'Vælg en turnering og to hold for at se resultatet, der bliver vist på forsiden.';
      preview.dataset.status = 'info';
      return;
    }

    preview.textContent = `${tournament} · ${roundInput.value || 'Grand Final'} · ${teamA} ${scoreA || '0'}-${scoreB || '0'} ${teamB}`;
    preview.dataset.status = 'success';
  }

  function populateTournamentSelect() {
    const genericOptions = GENERIC_TOURNAMENTS
      .map(
        (item) =>
          `<option value="generic:${escapeHTML(item.key)}">${escapeHTML(item.name)}</option>`
      )
      .join('');

    const databaseOptions = tournaments
      .map(
        (item) =>
          `<option value="db:${escapeHTML(item.id)}">${escapeHTML(item.name || 'Ukendt turnering')}</option>`
      )
      .join('');

    tournamentSelect.innerHTML = `
      <option value="">Vælg turnering</option>
      <optgroup label="VCL kategorier">
        ${genericOptions}
      </optgroup>
      ${databaseOptions ? `<optgroup label="Konkrete turneringer">${databaseOptions}</optgroup>` : ''}
    `;
  }

  function populateTeamSelect(select, items, placeholder) {
    select.innerHTML = `<option value="">${escapeHTML(placeholder)}</option>` +
      items
        .map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name || 'Ukendt')}</option>`)
        .join('');
  }

  async function loadOptions() {
    const db = await getDb();

    const [tournamentResult, teamResult, currentResult] = await Promise.all([
      db.from('tournaments').select('id, name, slug, status, starts_at').order('starts_at', { ascending: false, nullsFirst: false }),
      db.from('teams').select('id, name, slug, status').order('name', { ascending: true }),
      db.from('public_home_latest_result_view').select('*').maybeSingle()
    ]);

    if (tournamentResult.error) throw tournamentResult.error;
    if (teamResult.error) throw teamResult.error;

    tournaments = tournamentResult.data || [];
    teams = (teamResult.data || []).filter((team) => team.status !== 'inactive');

    populateTournamentSelect();
    populateTeamSelect(teamASelect, teams, 'Vælg hold');
    populateTeamSelect(teamBSelect, teams, 'Vælg hold');

    const current = currentResult.data;
    if (current) {
      if (current.tournament_id) {
        tournamentSelect.value = `db:${current.tournament_id}`;
      } else if (current.tournament_key) {
        tournamentSelect.value = `generic:${current.tournament_key}`;
      }

      teamASelect.value = current.team_a_id || '';
      teamBSelect.value = current.team_b_id || '';
      scoreAInput.value = Number(current.team_a_score ?? 0);
      scoreBInput.value = Number(current.team_b_score ?? 0);
      roundInput.value = current.round_label || 'Grand Final';
      summaryInput.value = current.summary || '';
      setStatus('Det nuværende forside-resultat er indlæst.', 'info');
    }

    updatePreview();
  }

  [tournamentSelect, teamASelect, teamBSelect, scoreAInput, scoreBInput, roundInput].forEach((input) => {
    input.addEventListener('input', updatePreview);
    input.addEventListener('change', updatePreview);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    const selectedTournament = getSelectedTournament();
    if (!selectedTournament) {
      setStatus('Vælg en turnering.', 'error');
      return;
    }

    if (teamASelect.value === teamBSelect.value) {
      setStatus('Vælg to forskellige hold.', 'error');
      return;
    }

    const scoreA = Number(scoreAInput.value);
    const scoreB = Number(scoreBInput.value);
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
      setStatus('Scores skal være hele tal på 0 eller højere.', 'error');
      return;
    }

    try {
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      setStatus('Opdaterer forsidens seneste resultat…', 'info');

      const db = await getDb();
      const { error } = await db.rpc('admin_set_home_latest_result_v2', {
        p_tournament_id: selectedTournament.id,
        p_tournament_key: selectedTournament.key,
        p_tournament_name: selectedTournament.name,
        p_tournament_url: selectedTournament.url,
        p_team_a_id: teamASelect.value,
        p_team_a_score: scoreA,
        p_team_b_id: teamBSelect.value,
        p_team_b_score: scoreB,
        p_round_label: roundInput.value.trim() || 'Grand Final',
        p_summary: summaryInput.value.trim()
      });

      if (error) throw error;

      setStatus('Forsidens seneste resultat er opdateret.', 'success');
      submitButton.disabled = false;
    } catch (error) {
      console.error(error);
      form.querySelector('button[type="submit"]').disabled = false;
      setStatus(error.message || 'Kunne ikke opdatere resultatet.', 'error');
    }
  });

  clearButton.addEventListener('click', async () => {
    if (!window.confirm('Fjern det aktuelle seneste resultat fra forsiden?')) return;

    try {
      clearButton.disabled = true;
      setStatus('Fjerner resultatet fra forsiden…', 'info');
      const db = await getDb();
      const { error } = await db.rpc('admin_clear_home_latest_result');
      if (error) throw error;
      setStatus('Resultatet er fjernet fra forsiden.', 'success');
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Kunne ikke fjerne resultatet.', 'error');
    } finally {
      clearButton.disabled = false;
    }
  });

  loadOptions().catch((error) => {
    console.error(error);
    setStatus('Kunne ikke indlæse forside-resultat. Kør de nye Supabase-migrationer først.', 'error');
  });
})();
