(() => {
  const page = document.querySelector('.admin-v2');
  if (!page) return;

  const dashboard = page.querySelector('[data-admin-dashboard]');
  const nav = page.querySelector('[data-admin-workspace-nav]');
  const currentView = page.querySelector('[data-admin-current-view]');
  const content = page.querySelector('[data-admin-workspace-content]');

  if (!dashboard || !nav || !content) return;

  const navLinks = Array.from(nav.querySelectorAll('[data-admin-workspace-link]'));
  const viewLinks = Array.from(page.querySelectorAll('[data-admin-view-link]'));
  const views = Array.from(content.querySelectorAll('[data-admin-view]'));

  const normalizeHash = (hash) => {
    const candidate = hash && hash.startsWith('#') ? hash : '#admin-overview';
    return views.some((view) => `#${view.id}` === candidate)
      ? candidate
      : '#admin-overview';
  };

  const activateView = (hash, updateUrl = true) => {
    const targetHash = normalizeHash(hash);
    const targetId = targetHash.slice(1);
    const targetView = views.find((view) => view.id === targetId);

    views.forEach((view) => {
      view.hidden = view !== targetView;
    });

    navLinks.forEach((link) => {
      const active = link.getAttribute('href') === targetHash;
      link.classList.toggle('is-active', active);
      if (active) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });

    const activeLink = navLinks.find((link) => link.getAttribute('href') === targetHash);
    const label = activeLink?.dataset.label || targetView?.dataset.adminViewLabel || 'Overblik';
    if (currentView) currentView.textContent = label;

    if (updateUrl) {
      window.history.replaceState({}, '', targetHash);
    }

    if (window.matchMedia('(max-width: 760px)').matches) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  [...navLinks, ...viewLinks].forEach((link) => {
    link.addEventListener('click', (event) => {
      const href = link.getAttribute('href');
      if (!href?.startsWith('#')) return;
      event.preventDefault();
      activateView(href);
    });
  });

  window.addEventListener('hashchange', () => {
    activateView(window.location.hash, false);
  });

  activateView(window.location.hash, false);

  const setText = (selector, value) => {
    const element = page.querySelector(selector);
    if (element) element.textContent = String(value);
  };

  const waitForVCLData = async () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (window.VCLData?.getAdminTournaments) return window.VCLData;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return null;
  };

  let tournamentRefreshTimer = null;
  const refreshTournamentStats = async () => {
    const api = await waitForVCLData();
    if (!api) return;

    try {
      const tournaments = await api.getAdminTournaments();
      const active = tournaments.filter((tournament) =>
        ['open', 'checkin', 'live'].includes(String(tournament.status || '').toLowerCase())
      ).length;

      setText('[data-admin-tournament-count]', tournaments.length);
      setText('[data-admin-active-tournament-count]', active);
    } catch (error) {
      console.warn('Kunne ikke opdatere dashboardets turneringsstatus.', error);
    }
  };

  const tournamentList = page.querySelector('[data-admin-tournament-list]');
  if (tournamentList) {
    const observer = new MutationObserver(() => {
      window.clearTimeout(tournamentRefreshTimer);
      tournamentRefreshTimer = window.setTimeout(refreshTournamentStats, 250);
    });
    observer.observe(tournamentList, { childList: true, subtree: true });
  }

  const pendingCount = page.querySelector('[data-admin-team-signups-count]');
  const pendingDisplay = page.querySelector('[data-admin-team-signups-count-display]');
  if (pendingCount && pendingDisplay) {
    const syncPendingDisplay = () => {
      const count = Number(pendingCount.textContent || 0);
      pendingDisplay.textContent = count > 0 ? `${count} venter` : 'Alt klart';
    };
    const observer = new MutationObserver(syncPendingDisplay);
    observer.observe(pendingCount, { childList: true, characterData: true, subtree: true });
    syncPendingDisplay();
  }

  refreshTournamentStats();
})();
