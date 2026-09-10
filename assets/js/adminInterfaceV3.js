(() => {
  const page = document.querySelector('.admin-v3');
  if (!page) return;

  const tournamentView = page.querySelector('#admin-tournaments');
  const tournamentLayout = tournamentView?.querySelector('.admin-tournament-layout-v2');
  const tournamentEditor = tournamentLayout?.querySelector(':scope > .admin-editor-v2');
  const tournamentIndex = tournamentLayout?.querySelector(':scope > .admin-index-v2');

  const openTournamentEditor = ({ reset = false, scroll = true } = {}) => {
    if (!tournamentEditor) return;
    if (reset) tournamentEditor.querySelector('[data-admin-tournament-reset]')?.click();
    tournamentEditor.hidden = false;
    if (scroll) {
      window.requestAnimationFrame(() => {
        tournamentEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  if (tournamentEditor && tournamentIndex) {
    tournamentEditor.hidden = true;

    const indexTitle = tournamentIndex.querySelector('.admin-section-title-v2');
    if (indexTitle && !indexTitle.querySelector('[data-admin-v3-create-tournament]')) {
      const createButton = document.createElement('button');
      createButton.type = 'button';
      createButton.className = 'admin-v3-create-tournament';
      createButton.dataset.adminV3CreateTournament = '';
      createButton.textContent = 'Opret turnering';
      createButton.addEventListener('click', () => openTournamentEditor({ reset: true }));
      indexTitle.appendChild(createButton);
    }

    const editorTitle = tournamentEditor.querySelector('.admin-section-title-v2');
    if (editorTitle && !editorTitle.querySelector('[data-admin-v3-hide-editor]')) {
      const hideButton = document.createElement('button');
      hideButton.type = 'button';
      hideButton.className = 'admin-v3-hide-editor';
      hideButton.dataset.adminV3HideEditor = '';
      hideButton.textContent = 'Skjul formular';
      hideButton.addEventListener('click', () => { tournamentEditor.hidden = true; });
      editorTitle.appendChild(hideButton);
    }

    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-admin-edit-tournament]')) {
        openTournamentEditor({ scroll: true });
      }
    }, true);
  }

  const resultForm = tournamentView?.querySelector('[data-admin-home-result-form]');
  if (resultForm) {
    const source = resultForm.querySelector('[name="tournament_source"]')?.closest('label');
    const round = resultForm.querySelector('[name="round_label"]')?.closest('label');
    const summary = resultForm.querySelector('[name="summary"]')?.closest('label');
    const teamA = resultForm.querySelector('[name="team_a_id"]')?.closest('.admin-form-grid-v2');
    const teamB = resultForm.querySelector('[name="team_b_id"]')?.closest('.admin-form-grid-v2');
    const preview = resultForm.querySelector('[data-admin-home-result-preview]');
    const actions = resultForm.querySelector('.admin-form-actions-v2');
    const status = resultForm.querySelector('[data-admin-home-result-status]');

    source?.classList.add('admin-v3-result-source');
    round?.classList.add('admin-v3-result-round');
    summary?.classList.add('admin-v3-result-summary');
    teamA?.classList.add('admin-v3-result-team');
    teamB?.classList.add('admin-v3-result-team');
    preview?.classList.add('admin-v3-result-preview');
    actions?.classList.add('admin-v3-result-actions');
    status?.classList.add('admin-v3-result-status');
  }

  const playersView = page.querySelector('#admin-unclaimed-profiles');
  const playerSearch = playersView?.querySelector('[data-admin-unclaimed-search]');
  const playerSearchBar = playersView?.querySelector('.admin-search-v2');
  const playerList = playersView?.querySelector('[data-admin-unclaimed-list]');

  if (playerSearchBar && playerList && !playerSearchBar.querySelector('[data-admin-v3-toggle-players]')) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'admin-v3-toggle-players';
    toggle.dataset.adminV3TogglePlayers = '';
    toggle.textContent = 'Vis profiler';
    playerList.hidden = true;

    const syncToggle = () => {
      toggle.textContent = playerList.hidden ? 'Vis profiler' : 'Skjul profiler';
      toggle.setAttribute('aria-expanded', playerList.hidden ? 'false' : 'true');
    };

    toggle.addEventListener('click', () => {
      playerList.hidden = !playerList.hidden;
      syncToggle();
    });

    playerSearch?.addEventListener('input', () => {
      if (playerSearch.value.trim() && playerList.hidden) {
        playerList.hidden = false;
        syncToggle();
      }
    });

    playerSearchBar.appendChild(toggle);
    syncToggle();
  }
})();
