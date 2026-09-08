(() => {
  const page = document.querySelector('[data-tournament-page]');
  if (!page) return;

  const button = page.querySelector('[data-tournament-entry-button]');
  const section = page.querySelector('[data-tournament-entry-section]');
  const kicker = page.querySelector('[data-tournament-entry-kicker]');
  const title = page.querySelector('[data-tournament-entry-title]');
  const copy = page.querySelector('[data-tournament-entry-copy]');
  const action = page.querySelector('[data-tournament-entry-action]');
  const status = page.querySelector('[data-tournament-entry-status]');
  let tournament = null;
  let currentUser = null;
  let context = null;
  let requests = [];

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const escapeHTML = (value = '') => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  async function waitForDataLayer() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (window.VCLData?.getMyActiveTeamContext && window.VCLData?.requestMyTeamTournamentEntry) {
        return window.VCLData;
      }
      await wait(100);
    }
    throw new Error('VCLData blev ikke klar.');
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
      pending: 'Tilmeldingen afventer VCL-godkendelse.',
      approved: 'Holdet er godkendt til denne turnering.',
      checked_in: 'Holdet er godkendt og checket ind.',
      rejected: 'Den seneste tilmelding blev afvist.',
      withdrawn: 'Holdet er trukket fra turneringen.',
      disqualified: 'Holdet er diskvalificeret fra turneringen.'
    };
    return labels[entry?.status] || '';
  }

  function render() {
    if (!section || !tournament || tournament.status !== 'open') return;
    section.hidden = false;
    setStatus('');

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
    const teamName = context.team_name || 'Dit VCL-hold';
    const tier = context.team_tier || context.tier || context.level || '';

    if (!context.is_captain) {
      if (kicker) kicker.textContent = 'Aktivt VCL-hold';
      if (title) title.textContent = teamName;
      if (copy) copy.textContent = `Du er registreret på ${teamName}, men kun holdets captain kan sende en turneringstilmelding.`;
      if (action) action.innerHTML = context.team_slug
        ? `<a class="tournament-entry-link-v2" href="team-profile.html?team=${encodeURIComponent(context.team_slug)}">Se holdprofil →</a>`
        : '';
      return;
    }

    if (kicker) kicker.textContent = tier ? `Godkendt VCL-hold · ${tier}` : 'Godkendt VCL-hold';
    if (title) title.textContent = teamName;

    if (existing && ['pending', 'approved', 'checked_in'].includes(existing.status)) {
      if (copy) copy.textContent = requestLabel(existing);
      if (action) action.innerHTML = `<button class="tournament-entry-cta-v2" type="button" disabled>${existing.status === 'pending' ? 'Anmodning sendt' : 'Holdet er tilmeldt'}</button>`;
      return;
    }

    if (copy) {
      copy.textContent = 'Din godkendte VCL-roster bliver brugt. Adgang og niveau valideres af VCL som en del af turneringstilmeldingen.';
    }
    if (action) {
      action.innerHTML = `<button class="tournament-entry-cta-v2" type="button" data-send-tournament-entry>${existing?.status === 'rejected' ? 'Send ny anmodning' : 'Tilmeld ' + escapeHTML(teamName)} <span>→</span></button>`;
      action.querySelector('[data-send-tournament-entry]')?.addEventListener('click', submit);
    }
  }

  async function submit(event) {
    const sendButton = event?.currentTarget;
    if (!tournament?.id || !context?.is_captain) return;

    try {
      if (sendButton) {
        sendButton.disabled = true;
        sendButton.textContent = 'Sender…';
      }
      setStatus('Sender turneringstilmeldingen til VCL…', 'info');
      const entry = await window.VCLData.requestMyTeamTournamentEntry(tournament.id);
      requests = requests.filter((item) => String(item.tournament_id) !== String(entry.tournament_id));
      requests.unshift(entry);
      setStatus('Tilmeldingen er sendt og afventer VCL-godkendelse.', 'success');
      render();
      setStatus('Tilmeldingen er sendt og afventer VCL-godkendelse.', 'success');
    } catch (error) {
      console.error('Kunne ikke sende turneringstilmelding:', error);
      if (sendButton) sendButton.disabled = false;
      setStatus(error.message || 'Holdet kan ikke tilmeldes denne turnering.', 'error');
    }
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
        if (context?.team_id) requests = await VCLData.getMyTeamTournamentEntries();
      }
      render();
    } catch (error) {
      console.error('Turneringstilmelding kunne ikke initialiseres:', error);
      if (section && tournament?.status === 'open') {
        section.hidden = false;
        if (title) title.textContent = 'Tilmelding kunne ikke indlæses';
        if (copy) copy.textContent = 'Prøv at genindlæse siden om et øjeblik.';
      }
    }
  }

  button?.addEventListener('click', () => {
    if (!section) return;
    section.hidden = false;
    section.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
