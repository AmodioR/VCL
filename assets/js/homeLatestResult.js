(() => {
  const section = document.querySelector('[data-home-latest-result]');
  if (!section) return;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function getDb() {
    if (window.vclSupabase) return window.vclSupabase;
    if (window.vclSupabaseReady) {
      try {
        return await window.vclSupabaseReady;
      } catch (error) {
        console.warn('Supabase blev ikke klar til seneste resultat:', error);
      }
    }

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (window.vclSupabase) return window.vclSupabase;
      await wait(100);
    }

    return null;
  }

  function setText(selector, value) {
    const element = section.querySelector(selector);
    if (element) element.textContent = value ?? '';
  }

  function setLink(selector, href) {
    const element = section.querySelector(selector);
    if (element) element.href = href || '#';
  }

  function setLogo(selector, src, teamName) {
    const image = section.querySelector(selector);
    if (!image) return;

    image.src = src || 'assets/teams/default-team.png';
    image.alt = teamName ? `${teamName} logo` : '';
    image.addEventListener(
      'error',
      () => {
        image.src = 'assets/teams/default-team.png';
      },
      { once: true }
    );
  }

  function buildSummary(result) {
    if (String(result.summary || '').trim()) return result.summary.trim();

    const a = Number(result.team_a_score || 0);
    const b = Number(result.team_b_score || 0);
    const winner = a > b ? result.team_a_name : b > a ? result.team_b_name : null;

    if (!winner) {
      return `${result.team_a_name} og ${result.team_b_name} sluttede ${a}-${b} i ${result.round_label || 'kampen'}.`;
    }

    return `${winner} vandt ${a}-${b} i ${result.round_label || 'kampen'}.`;
  }

  async function loadLatestResult() {
    const db = await getDb();
    if (!db) return;

    const { data, error } = await db
      .from('public_home_latest_result_view')
      .select('*')
      .maybeSingle();

    if (error) {
      console.warn('Kunne ikke hente seneste resultat til forsiden:', error);
      return;
    }

    if (!data) return;

    const teamAScore = Number(data.team_a_score || 0);
    const teamBScore = Number(data.team_b_score || 0);
    const winnerName =
      teamAScore > teamBScore
        ? data.team_a_name
        : teamBScore > teamAScore
          ? data.team_b_name
          : 'Uafgjort';

    setText('[data-home-result-tournament]', data.tournament_name || 'VCL Turnering');
    setText('[data-home-result-round]', data.round_label || 'Grand Final');
    setText('[data-home-result-team-a-name]', data.team_a_name || 'Hold A');
    setText('[data-home-result-team-b-name]', data.team_b_name || 'Hold B');
    setText('[data-home-result-score-a]', teamAScore);
    setText('[data-home-result-score-b]', teamBScore);
    setText('[data-home-result-winner]', `Winner · ${winnerName}`);
    setText('[data-home-result-summary]', buildSummary(data));
    setText('[data-home-result-cta-label]', `Se ${data.tournament_name || 'turnering'}`);

    setLogo('[data-home-result-team-a-logo]', data.team_a_logo_url, data.team_a_name);
    setLogo('[data-home-result-team-b-logo]', data.team_b_logo_url, data.team_b_name);

    setLink(
      '[data-home-result-team-a-link]',
      `team-profile.html?team=${encodeURIComponent(data.team_a_slug || '')}`
    );
    setLink(
      '[data-home-result-team-b-link]',
      `team-profile.html?team=${encodeURIComponent(data.team_b_slug || '')}`
    );
    setLink(
      '[data-home-result-tournament-link]',
      data.tournament_url || `turnering.html?tournament=${encodeURIComponent(data.tournament_slug || '')}`
    );

    section.hidden = false;
  }

  loadLatestResult();
})();
