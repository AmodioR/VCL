from pathlib import Path

path = Path('script.js')
text = path.read_text(encoding='utf-8')

player_old = '''    const params = new URLSearchParams(window.location.search);
    const playerSlug = params.get("player") || "amodio";

    async function loadPlayerProfile() {'''
player_new = '''    const params = new URLSearchParams(window.location.search);
    const playerSlug = params.get("player") || "";

    function renderMissingPlayerProfile() {
      setText("[data-player-roster-status]", "Ikke fundet");
      setText("[data-player-name]", "Spillerprofil ikke fundet");
      setText("[data-player-bio]", "Kontrollér linket, eller gå tilbage til leaderboardet.");
      setText("[data-player-rank]", "—");
      setText("[data-player-rank-tier]", "UNRANKED");
      setText("[data-player-points]", "—");
      setText("[data-player-championship-wins]", "—");
      setText("[data-player-contender-wins]", "—");
      setText("[data-player-academy-wins]", "—");
      setText("[data-player-info-primary]", "—");
      setText("[data-player-info-level]", "—");
      setText("[data-player-info-status]", "Ikke fundet");
      setText("[data-player-info-discord]", "—");

      const tags = $("[data-player-tags]");
      if (tags) tags.innerHTML = "";

      const teamPill = $("[data-player-team-pill]");
      if (teamPill) teamPill.hidden = true;

      const teamFallback = $("[data-player-team-fallback]");
      if (teamFallback) teamFallback.hidden = false;
      setText("[data-player-team-fallback-title]", "Ingen spiller valgt");
      setText("[data-player-team-fallback-copy]", "Åbn en spiller fra leaderboardet eller holdoversigten.");

      const rosterAction = $("[data-player-roster-action]");
      if (rosterAction) rosterAction.hidden = true;

      const historyList = $("[data-player-history-list]");
      if (historyList) {
        historyList.innerHTML = `
          <article class="player-history-v3__item player-history-v3__item--empty">
            <span class="player-history-v3__placement">—</span>
            <div>
              <strong>Ingen spillerprofil valgt</strong>
              <p>Gå tilbage til leaderboardet og vælg en spiller.</p>
            </div>
          </article>
        `;
      }

      document.title = "Spillerprofil ikke fundet — VCL";
    }

    async function loadPlayerProfile() {
      if (!playerSlug) {
        renderMissingPlayerProfile();
        return;
      }'''
if text.count(player_old) != 1:
    raise SystemExit(f'Expected player demo fallback block once, found {text.count(player_old)}')
text = text.replace(player_old, player_new, 1)

player_missing_old = '''      if (!player) {
        console.warn("Ingen spiller fundet:", playerSlug);
        return;
      }'''
player_missing_new = '''      if (!player) {
        console.warn("Ingen spiller fundet:", playerSlug);
        renderMissingPlayerProfile();
        return;
      }'''
if text.count(player_missing_old) != 1:
    raise SystemExit(f'Expected player not-found branch once, found {text.count(player_missing_old)}')
text = text.replace(player_missing_old, player_missing_new, 1)

team_old = '''    const params = new URLSearchParams(window.location.search);
    const teamSlug = params.get("team") || "frontline";'''
team_new = '''    const params = new URLSearchParams(window.location.search);
    const teamSlug = params.get("team") || "";'''
if text.count(team_old) != 1:
    raise SystemExit(f'Expected team demo fallback block once, found {text.count(team_old)}')
text = text.replace(team_old, team_new, 1)

team_load_old = '''    async function loadPublicTeamProfile() {
      const teamData = await window.VCLData.getTeamProfile(teamSlug);

      if (!teamData) {'''
team_load_new = '''    async function loadPublicTeamProfile() {
      const teamData = teamSlug
        ? await window.VCLData.getTeamProfile(teamSlug)
        : null;

      if (!teamData) {'''
if text.count(team_load_old) != 1:
    raise SystemExit(f'Expected team profile loader once, found {text.count(team_load_old)}')
text = text.replace(team_load_old, team_load_new, 1)

for stale in ['|| "amodio"', '|| "frontline"']:
    if stale in text:
        raise SystemExit(f'Hardcoded profile fallback still remains: {stale}')

path.write_text(text, encoding='utf-8')
