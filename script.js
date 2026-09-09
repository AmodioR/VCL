(async () => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const setText = (selector, value, root = document) => {
    const element = root.querySelector(selector);
    if (element) element.textContent = value ?? "";
  };

  const escapeHTML = (value = "") => {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  };


  const slugifyVCL = (value = "") => {
    return String(value)
      .toLocaleLowerCase("da-DK")
      .trim()
      .replaceAll("æ", "ae")
      .replaceAll("ø", "oe")
      .replaceAll("å", "aa")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  const formatVCLDateTime = (value, fallback = "Ikke fastlagt") => {
    if (!value) return fallback;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;

    return date.toLocaleString("da-DK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const toDateTimeLocalValue = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
  };

  const toISOStringOrNull = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  const waitForVCLData = (methodName, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const check = () => {
      if (window.VCLData && window.VCLData[methodName]) {
        resolve(window.VCLData);
        return;
      }

      if (Date.now() - startedAt > timeout) {
        reject(new Error(`VCLData.${methodName} blev ikke klar i tide.`));
        return;
      }

      requestAnimationFrame(check);
    };

    check();
  });
};


  async function waitForInitialDataLayer(timeout = 8000) {
    if (window.VCLData || !window.vclSupabaseReady) return;

    let timeoutId = null;

    try {
      await Promise.race([
        window.vclSupabaseReady,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error("Supabase initialisering timed out."));
          }, timeout);
        })
      ]);

      // vclData.js fortsætter i den næste microtask efter Supabase er klar.
      await Promise.resolve();
    } catch (error) {
      console.error("VCL data-layer kunne ikke bootstrappe:", error);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  await waitForInitialDataLayer();

  /* =========================
     GLOBAL LIVE TOURNAMENT BAR
  ========================= */

  const initGlobalLiveTournamentBar = () => {
    const siteHeader = document.querySelector(".site-header");

    // Admin workspace already has its own dense fixed navigation.
    if (!siteHeader || document.querySelector(".admin-v2")) {
      return;
    }

    const bar = document.createElement("aside");
    bar.className = "vcl-global-live-bar";
    bar.hidden = true;
    bar.setAttribute("aria-live", "polite");
    bar.setAttribute("aria-label", "Live turneringskamp");

    siteHeader.insertAdjacentElement("afterend", bar);

    let lastSignature = "";
    let refreshTimer = null;

    const hideBar = () => {
      bar.hidden = true;
      bar.innerHTML = "";
      document.body.classList.remove("vcl-live-tournament-active");
      lastSignature = "";
    };

    const formatScore = (match) => {
      const scoreA = match.team_a_score;
      const scoreB = match.team_b_score;

      if (scoreA === null || scoreA === undefined || scoreB === null || scoreB === undefined) {
        return "vs.";
      }

      return `${Number(scoreA)}–${Number(scoreB)}`;
    };

    const renderBar = (matches) => {
      if (!Array.isArray(matches) || !matches.length) {
        hideBar();
        return;
      }

      const match = matches[0];
      const extraCount = Math.max(0, matches.length - 1);
      const tournamentUrl = match.tournament_slug
        ? `turnering.html?tournament=${encodeURIComponent(match.tournament_slug)}`
        : "turneringer.html";

      const signature = JSON.stringify(
        matches.map((item) => [
          item.id,
          item.updated_at,
          item.status,
          item.team_a_score,
          item.team_b_score,
          item.twitch_url
        ])
      );

      if (signature === lastSignature && !bar.hidden) {
        return;
      }

      lastSignature = signature;

      const teamA = escapeHTML(match.team_a_name || "TBD");
      const teamB = escapeHTML(match.team_b_name || "TBD");
      const tournamentName = escapeHTML(match.tournament_name || "VCL-turnering");
      const roundLabel = escapeHTML(
        match.round_label || `Runde ${Number(match.round_number || 1)}`
      );
      const score = escapeHTML(formatScore(match));
      const isTournamentOnly = Boolean(match.broadcast_only);

      const liveSummary = isTournamentOnly
        ? `
            <span class="vcl-global-live-bar__broadcast">
              <strong>Turneringen er live</strong>
              <span>Følg eventet og de live kampe</span>
            </span>
          `
        : `
            <span class="vcl-global-live-bar__teams">
              <strong>${teamA}</strong>
              <span>${score}</span>
              <strong>${teamB}</strong>
            </span>
          `;

      const liveMeta = isTournamentOnly
        ? "Live event"
        : `${roundLabel} · Kamp ${Number(match.match_number || 1)}`;

      bar.innerHTML = `
        <div class="container vcl-global-live-bar__inner">
          <div class="vcl-global-live-bar__status">
            <span class="vcl-global-live-bar__pulse" aria-hidden="true"></span>
            <strong>Live nu</strong>
          </div>

          <a class="vcl-global-live-bar__match" href="${tournamentUrl}">
            <span class="vcl-global-live-bar__tournament">${tournamentName}</span>
            ${liveSummary}
            <small>${escapeHTML(liveMeta)}</small>
          </a>

          <div class="vcl-global-live-bar__actions">
            ${
              extraCount
                ? `<span class="vcl-global-live-bar__count">+${extraCount} mere live</span>`
                : ""
            }
            <a class="vcl-global-live-bar__details" href="${tournamentUrl}">
              Se turnering
            </a>
            ${
              match.twitch_url
                ? `<a class="vcl-global-live-bar__stream" href="${escapeHTML(match.twitch_url)}" target="_blank" rel="noopener">
                    Se live
                  </a>`
                : ""
            }
          </div>
        </div>
      `;

      bar.hidden = false;
      document.body.classList.add("vcl-live-tournament-active");
    };

    const refreshLiveMatches = async () => {
      try {
        const VCLData = await waitForVCLData("getLiveTournamentMatches", 8000);
        const matches = await VCLData.getLiveTournamentMatches();
        renderBar(matches);
      } catch (error) {
        console.warn("Live-bjælken kunne ikke opdateres:", error);
      }
    };

    refreshLiveMatches();

    refreshTimer = window.setInterval(refreshLiveMatches, 30000);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshLiveMatches();
      }
    });

    window.addEventListener("focus", refreshLiveMatches);

    window.addEventListener("beforeunload", () => {
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
      }
    });
  };

  initGlobalLiveTournamentBar();

  // Active nav
  const current = location.pathname.split("/").pop() || "index.html";

  if (current === "leaderboard.html") {
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  window.addEventListener("load", () => {
    window.scrollTo(0, 0);
  });
}

  $$("[data-nav]").forEach((a) => {
    const href = a.getAttribute("href");

    if (
      href === current ||
      (current === "turnering.html" && href === "turneringer.html") ||
      (["academy-cup.html", "contender-series.html", "contenter-series.html", "championship.html"].includes(current) && href === "turneringer.html") ||
      (current === "team-profile.html" && href === "teams.html") ||
      (current === "team-dashboard.html" && href === "teams.html") ||
      (current === "contenter-series.html" && href === "contender-series.html")
    ) {
      a.classList.add("active");
    }
  });

  // Mobile menu
  const toggle = $("[data-menu-toggle]");
  const nav = $(".nav-links");

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      nav.classList.toggle("open");
      toggle.classList.toggle("open");
    });

    $$("[data-nav]", nav).forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("open");
        toggle.classList.remove("open");
      });
    });
  }

  // Reveal animations
  const revealElements = $$(".reveal");

  if ("IntersectionObserver" in window && revealElements.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12 }
    );

    revealElements.forEach((el) => observer.observe(el));
  } else {
    revealElements.forEach((el) => el.classList.add("visible"));
  }

  /* =========================
     PUBLIC TOURNAMENT HUB
  ========================= */

  const tournamentSeriesLabel = (series = "") => {
    const labels = {
      academy: "Academy Cup",
      contender: "Contender Series",
      championship: "Championship",
      community: "Community"
    };
    return labels[series] || "VCL Tournament";
  };

  const tournamentStatusLabel = (status = "") => {
    const labels = {
      draft: "Draft",
      open: "Åben tilmelding",
      checkin: "Check-in",
      live: "Live nu",
      completed: "Afsluttet",
      archived: "Arkiveret",
      scheduled: "Planlagt",
      ready: "Klar",
      cancelled: "Annulleret"
    };
    return labels[status] || status || "Ukendt status";
  };

  const tournamentsPage = $("[data-tournaments-page]");

  if (tournamentsPage) {
    const tournamentList = $("[data-tournament-list]");
    let cachedTournaments = [];

    const renderTournamentCards = () => {
      if (!tournamentList) return;

      if (!cachedTournaments.length) {
        tournamentList.innerHTML = `
          <div class="tournament-empty-v2">
            <h2>Ingen turneringer lige nu</h2>
            <p>Der er ingen turneringer på programmet på nuværende tidspunkt. Kig forbi igen snart for kommende VCL-events og nye turneringer.</p>
          </div>
        `;
        return;
      }

      tournamentList.innerHTML = cachedTournaments
        .map((tournament) => {
          const teamCount = Number(tournament.approved_team_count || 0);
          const maxTeams = Number(tournament.max_teams || 0);
          const isLive = tournament.status === "live";
          const seriesClass = ["academy", "contender", "championship", "community"].includes(tournament.series_slug)
            ? tournament.series_slug
            : "community";

          return `
            <article class="tournament-event-v2 tournament-event-v2--${escapeHTML(seriesClass)} tournament-event-v2--status-${escapeHTML(tournament.status || "draft")}">
              <div class="tournament-event-v2__identity">
                <div class="tournament-event-v2__meta">
                  <span>${escapeHTML(tournamentSeriesLabel(tournament.series_slug))}</span>
                  <span class="tournament-status-v2${isLive ? " is-live" : ""}">
                    ${isLive ? '<i aria-hidden="true"></i>' : ''}${escapeHTML(tournamentStatusLabel(tournament.status))}
                  </span>
                </div>
                <h2>${escapeHTML(tournament.name || "VCL turnering")}</h2>
                <p>${escapeHTML(tournament.description || "Følg hold, bracket og resultater på turneringssiden.")}</p>
              </div>

              <div class="tournament-event-v2__facts">
                <div>
                  <span>Start</span>
                  <strong>${escapeHTML(formatVCLDateTime(tournament.starts_at))}</strong>
                </div>
                <div>
                  <span>Hold</span>
                  <strong>${teamCount}${maxTeams ? ` / ${maxTeams}` : ""}</strong>
                </div>
                <div>
                  <span>Format</span>
                  <strong>${escapeHTML(tournament.map_order || "HP · SND · OL · HP · SND")}</strong>
                </div>
              </div>

              <a class="tournament-event-v2__link" href="turnering.html?tournament=${encodeURIComponent(tournament.slug || "")}" aria-label="Åbn ${escapeHTML(tournament.name || "VCL turnering")}">
                <span>Se turnering</span><b aria-hidden="true">→</b>
              </a>
            </article>
          `;
        })
        .join("");
    };

    (async () => {
      try {
        const VCLData = await waitForVCLData("getPublicTournaments", 8000);
        cachedTournaments = await VCLData.getPublicTournaments();
        renderTournamentCards();
      } catch (error) {
        console.error(error);
        if (tournamentList) {
          tournamentList.innerHTML = `
            <div class="tournament-empty-v2 tournament-empty-v2--error">
              <h2>Turneringerne kunne ikke hentes</h2>
              <p>Prøv at genindlæse siden om et øjeblik.</p>
            </div>
          `;
        }
      }
    })();
  }

  const tournamentPage = $("[data-tournament-page]");

  if (tournamentPage) {
    const params = new URLSearchParams(window.location.search);
    const tournamentSlug = params.get("tournament") || params.get("id") || "";

    const renderTournamentTeam = (entry) => {
      const teamName = entry.team_name || "Ukendt hold";
      const teamSlug = entry.team_slug || "";
      const content = `
        <span class="tournament-team-logo">
          <img src="${escapeHTML(entry.logo_url || "assets/teams/default-team.png")}" alt="" loading="lazy">
        </span>
        <span>
          <strong>${escapeHTML(teamName)}</strong>
          <small>${entry.status === "checked_in" ? "Checket ind" : entry.seed ? `Seed #${Number(entry.seed)}` : "Godkendt"}</small>
        </span>
      `;

      return teamSlug
        ? `<a class="tournament-team-row" href="team-profile.html?team=${encodeURIComponent(teamSlug)}">${content}</a>`
        : `<div class="tournament-team-row">${content}</div>`;
    };

    const renderMatchTeam = (match, side) => {
      const isA = side === "a";
      const name = isA ? match.team_a_name : match.team_b_name;
      const logo = isA ? match.team_a_logo_url : match.team_b_logo_url;
      const score = isA ? match.team_a_score : match.team_b_score;
      const teamId = isA ? match.team_a_id : match.team_b_id;
      const winner = teamId && String(match.winner_team_id) === String(teamId);

      return `
        <div class="tournament-match-team${winner ? " is-winner" : ""}">
          <span class="tournament-match-team__logo">
            ${name ? `<img src="${escapeHTML(logo || "assets/teams/default-team.png")}" alt="">` : "—"}
          </span>
          <strong>${escapeHTML(name || "TBD")}</strong>
          <b>${score ?? "—"}</b>
        </div>
      `;
    };

    const renderBracket = (matches, tournamentStreamUrl = "") => {
      const bracket = $("[data-tournament-bracket]");
      if (!bracket) return;

      if (!matches.length) {
        bracket.innerHTML = `
          <div class="tournament-empty-state">
            <strong>Bracketen er ikke klar endnu</strong>
            <p>Den bliver vist her, når deltagerlisten er låst af VCL-admin.</p>
          </div>
        `;
        return;
      }

      const rounds = new Map();
      matches.forEach((match) => {
        if (!rounds.has(match.round_number)) rounds.set(match.round_number, []);
        rounds.get(match.round_number).push(match);
      });

      bracket.innerHTML = Array.from(rounds.entries())
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([roundNumber, roundMatches]) => {
          const roundLabel = roundMatches[0]?.round_label || `Runde ${roundNumber}`;
          return `
            <section class="tournament-bracket-round">
              <div class="tournament-bracket-round__head">
                <span>Round ${Number(roundNumber)}</span>
                <strong>${escapeHTML(roundLabel)}</strong>
              </div>
              <div class="tournament-bracket-round__matches">
                ${roundMatches
                  .sort((a, b) => Number(a.match_number) - Number(b.match_number))
                  .map((match) => {
                    const matchStreamUrl = match.twitch_url || tournamentStreamUrl || "";
                    const streamLink =
                      match.status === "live" && matchStreamUrl
                        ? `<a href="${escapeHTML(matchStreamUrl)}" target="_blank" rel="noopener">Se live</a>`
                        : "";
                    return `
                      <article class="tournament-match-card tournament-match-card--${escapeHTML(match.status || "scheduled")}">
                        <div class="tournament-match-card__meta">
                          <span>Kamp ${Number(match.match_number)}</span>
                          <span>${escapeHTML(tournamentStatusLabel(match.status))}</span>
                        </div>
                        ${renderMatchTeam(match, "a")}
                        ${renderMatchTeam(match, "b")}
                        <div class="tournament-match-card__footer">
                          <span>${escapeHTML(formatVCLDateTime(match.scheduled_at, "Tid ikke fastlagt"))}</span>
                          ${streamLink}
                        </div>
                      </article>
                    `;
                  })
                  .join("")}
              </div>
            </section>
          `;
        })
        .join("");
    };

    (async () => {
      if (!tournamentSlug) {
        setText("[data-tournament-name]", "Turneringen kunne ikke findes");
        setText("[data-tournament-description]", "Åbn turneringen fra turneringsoversigten.");
        return;
      }

      try {
        const VCLData = await waitForVCLData("getTournamentBySlug", 8000);
        const tournament = await VCLData.getTournamentBySlug(tournamentSlug);

        if (!tournament) {
          throw new Error("Turneringen findes ikke eller er stadig draft.");
        }

        const [entries, matches, results] = await Promise.all([
          VCLData.getTournamentEntries(tournament.id),
          VCLData.getTournamentMatches(tournament.id),
          VCLData.getTournamentResults ? VCLData.getTournamentResults(tournament.id) : Promise.resolve([])
        ]);

        setText("[data-tournament-series]", tournamentSeriesLabel(tournament.series_slug));
        setText("[data-tournament-status]", tournamentStatusLabel(tournament.status));
        setText("[data-tournament-name]", tournament.name);
        setText(
          "[data-tournament-description]",
          tournament.description || "Følg bracket, live-kampe og resultater her."
        );
        setText("[data-tournament-start]", formatVCLDateTime(tournament.starts_at));
        setText(
          "[data-tournament-deadline]",
          formatVCLDateTime(tournament.signup_closes_at)
        );
        setText(
          "[data-tournament-team-count]",
          `${entries.length}${tournament.max_teams ? ` / ${Number(tournament.max_teams)}` : ""}`
        );
        setText("[data-tournament-format]", "Single elimination");
        setText("[data-tournament-map-order]", tournament.map_order || "HP · SND · OL · HP · SND");
        setText(
          "[data-tournament-checkin]",
          tournament.checkin_closes_at
            ? `Lukker ${formatVCLDateTime(tournament.checkin_closes_at)}`
            : "Tidspunkt kommer"
        );

        const signupButton = $("[data-tournament-entry-button]");
        if (signupButton) {
          signupButton.hidden = tournament.status !== "open";
        }

        window.dispatchEvent(
          new CustomEvent("vcl:tournament-ready", { detail: { tournament } })
        );

        const rulesLink = $("[data-tournament-rules-link]");
        if (rulesLink && tournament.rules_url) {
          rulesLink.href = tournament.rules_url;
          rulesLink.target = "_blank";
          rulesLink.rel = "noopener";
        }

        const teamsList = $("[data-tournament-teams]");
        if (teamsList) {
          teamsList.innerHTML = entries.length
            ? entries.map(renderTournamentTeam).join("")
            : `<div class="tournament-empty-state"><strong>Ingen godkendte hold endnu</strong><p>Godkendte tilmeldinger bliver vist automatisk.</p></div>`;
        }

        renderBracket(matches, tournament.stream_url || "");

        const resultsSection = $("[data-tournament-results-section]");
        const resultsList = $("[data-tournament-results]");
        if (resultsSection && resultsList && results.length) {
          resultsSection.hidden = false;
          resultsList.innerHTML = results
            .map((result) => {
              const placement = Number(result.placement || 0);
              const placementLabel = placement === 1 ? "Champion" : placement === 2 ? "2. plads" : `${placement}. plads`;
              const roster = Array.isArray(result.roster_snapshot) ? result.roster_snapshot : [];
              return `
                <article class="tournament-result-row${placement === 1 ? " is-champion" : ""}">
                  <span class="tournament-result-row__placement">${placement === 1 ? "01" : String(placement).padStart(2, "0")}</span>
                  <span class="tournament-result-row__logo">
                    <img src="${escapeHTML(result.logo_url || "assets/teams/default-team.png")}" alt="">
                  </span>
                  <div class="tournament-result-row__team">
                    <strong>${escapeHTML(result.team_name || "Ukendt hold")}</strong>
                    <span>${escapeHTML(placementLabel)} · ${Number(result.roster_size || roster.length)} spillere</span>
                  </div>
                  <div class="tournament-result-row__points">
                    <span>Pr. spiller</span>
                    <strong>+${Number(result.points_per_player || 0)} VP</strong>
                  </div>
                </article>
              `;
            })
            .join("");
        }

        const liveMatches = matches.filter((match) => match.status === "live");
        const liveSection = $("[data-tournament-live-section]");
        const liveBox = $("[data-tournament-live-match]");
        const liveButton = $("[data-tournament-live-button]");
        const primaryLiveMatch = liveMatches.find((match) => match.twitch_url) || liveMatches[0] || null;
        const primaryStreamUrl = primaryLiveMatch?.twitch_url || tournament.stream_url || "";
        const tournamentIsLive = tournament.status === "live";

        if (liveButton) {
          liveButton.hidden = !(tournamentIsLive && primaryStreamUrl);
          if (tournamentIsLive && primaryStreamUrl) {
            liveButton.href = primaryStreamUrl;
          }
        }

        if (liveSection && liveBox && tournamentIsLive) {
          liveSection.hidden = false;

          if (primaryLiveMatch) {
            liveBox.innerHTML = `
              <div>
                <span class="tournament-live-dot">Live nu</span>
                <strong>${escapeHTML(primaryLiveMatch.team_a_name || "TBD")} vs. ${escapeHTML(primaryLiveMatch.team_b_name || "TBD")}</strong>
                <p>${escapeHTML(primaryLiveMatch.round_label || `Runde ${primaryLiveMatch.round_number}`)} · Kamp ${Number(primaryLiveMatch.match_number)}</p>
              </div>
              ${
                primaryStreamUrl
                  ? `<a href="${escapeHTML(primaryStreamUrl)}" target="_blank" rel="noopener">Se live</a>`
                  : `<span>Streamlink kommer</span>`
              }
            `;
          } else {
            liveBox.innerHTML = `
              <div>
                <span class="tournament-live-dot">Live nu</span>
                <strong>${escapeHTML(tournament.name || "VCL-turneringen")} er live</strong>
                <p>Følg turneringen her, mens bracket og kampstatus bliver opdateret løbende.</p>
              </div>
              ${
                primaryStreamUrl
                  ? `<a href="${escapeHTML(primaryStreamUrl)}" target="_blank" rel="noopener">Se live</a>`
                  : `<span>Streamlink kommer</span>`
              }
            `;
          }
        }

        document.title = `${tournament.name} — VCL`;
      } catch (error) {
        console.error(error);
        setText("[data-tournament-name]", "Turneringen kunne ikke indlæses");
        setText(
          "[data-tournament-description]",
          error.message || "Turneringen kunne ikke indlæses. Prøv igen om et øjeblik."
        );
      }
    })();
  }


  /* =========================
     TEAMS DIRECTORY — SUPABASE
  ========================= */

  const teamsPage = $("[data-teams-page]");

  if (teamsPage) {
    const teamsList = $("[data-teams-list]");
    const teamsStatus = $("[data-teams-status]");
    const teamCount = $("[data-team-count]");

    let allTeams = [];
    let allPlayers = [];

    const normalizeTeamValue = (value = "") => String(value).toLowerCase().trim();

    const getDirectoryPlayer = (playerId) =>
      allPlayers.find((player) => player.id === playerId);

    const getDirectoryPlayerName = (playerId) =>
      getDirectoryPlayer(playerId)?.alias || playerId || "Ikke angivet";

    const tierWeight = (tier = "") => {
      const value = normalizeTeamValue(tier);
      if (value.includes("championship")) return 0;
      if (value.includes("contender")) return 1;
      if (value.includes("academy")) return 2;
      return 3;
    };

    const renderRosterNames = (playerIds = [], max = 4) => {
      const names = playerIds.slice(0, max).map((playerId) => {
        const player = getDirectoryPlayer(playerId);
        const alias = player?.alias || playerId;
        const slug = player?.id || playerId;
        return `<a href="player-profile.html?player=${encodeURIComponent(slug)}">${escapeHTML(alias)}</a>`;
      });

      return names.length
        ? names.join('<span aria-hidden="true">·</span>')
        : '<span class="team-directory-row__empty">Ikke angivet</span>';
    };

    const renderTeams = () => {
      if (!teamsList) return;

      const visibleTeams = [...allTeams]
        .filter((team) => normalizeTeamValue(team.status || "active") !== "rejected")
        .sort(
          (a, b) =>
            tierWeight(a.tier) - tierWeight(b.tier) ||
            String(a.name || "").localeCompare(String(b.name || ""), "da")
        );

      if (teamsStatus) {
        teamsStatus.textContent = visibleTeams.length
          ? ""
          : "Der er endnu ingen godkendte VCL-hold.";
      }

      if (teamCount) teamCount.textContent = String(visibleTeams.length);

      if (!visibleTeams.length) {
        teamsList.innerHTML = `
          <div class="teams-directory-v2__empty">
            <h3>Ingen hold registreret endnu</h3>
            <p>Når VCL-hold bliver godkendt, vil de blive vist her.</p>
          </div>
        `;
        return;
      }

      teamsList.innerHTML = visibleTeams
        .map((team) => {
          const starters = team.roster?.starters || [];
          const achievement = team.achievements?.[0]?.title || "Ingen registrerede meritter endnu";
          const captainName = team.captainId
            ? getDirectoryPlayerName(team.captainId)
            : "Ikke angivet";
          const logo = team.logo || "assets/teams/default-team.png";
          const tier = team.tier || "VCL Team";
          const tierClass = normalizeTeamValue(tier).includes("championship")
            ? "championship"
            : normalizeTeamValue(tier).includes("contender")
              ? "contender"
              : normalizeTeamValue(tier).includes("academy")
                ? "academy"
                : "default";

          return `
            <article class="team-directory-row" data-tier="${tierClass}">
              <a class="team-directory-row__logo" href="team-profile.html?team=${encodeURIComponent(team.id)}" aria-label="Se ${escapeHTML(team.name || "hold")} profil">
                <img src="${escapeHTML(logo)}" alt="${escapeHTML(team.name || "Team")} logo" loading="lazy">
              </a>

              <div class="team-directory-row__identity">
                <span class="team-directory-row__tier">${escapeHTML(tier)}</span>
                <h3><a href="team-profile.html?team=${encodeURIComponent(team.id)}">${escapeHTML(team.name || "Unnamed Team")}</a></h3>
                <p>${escapeHTML(team.tagline || "Godkendt VCL-hold")}</p>
              </div>

              <div class="team-directory-row__detail team-directory-row__detail--captain">
                <span>CAPTAIN</span>
                <strong>${escapeHTML(captainName)}</strong>
              </div>

              <div class="team-directory-row__detail team-directory-row__detail--roster">
                <span>STARTING ROSTER</span>
                <div class="team-directory-row__players">${renderRosterNames(starters, 4)}</div>
              </div>

              <div class="team-directory-row__detail team-directory-row__detail--achievement">
                <span>MERIT</span>
                <strong>${escapeHTML(achievement)}</strong>
              </div>

              <a class="team-directory-row__link" href="team-profile.html?team=${encodeURIComponent(team.id)}">
                <span>SE HOLD</span><span aria-hidden="true">→</span>
              </a>
            </article>
          `;
        })
        .join("");
    };

    const loadTeams = async () => {
      try {
        const dataLayer = await waitForVCLData("getTeams", 8000);
        [allTeams, allPlayers] = await Promise.all([
          dataLayer.getTeams(),
          dataLayer.getPlayers()
        ]);

        if (!Array.isArray(allTeams) || !Array.isArray(allPlayers)) {
          throw new Error("Teamdata kunne ikke læses.");
        }

        renderTeams();
      } catch (error) {
        console.error("Teams kunne ikke hentes fra Supabase:", error);
        if (teamsStatus) teamsStatus.textContent = "Teams kunne ikke indlæses lige nu.";
        if (teamCount) teamCount.textContent = "—";
        if (teamsList) {
          teamsList.innerHTML = `
            <div class="teams-directory-v2__empty">
              <h3>Kunne ikke hente hold</h3>
              <p>Prøv at genindlæse siden om et øjeblik.</p>
            </div>
          `;
        }
      }
    };

    loadTeams();
  }

  /* =========================
     LEADERBOARD — SUPABASE
  ========================= */

  const leaderboardPage = $("[data-leaderboard-page]");

  if (leaderboardPage) {
    const leaderboardList = $("[data-leaderboard-list]");
    const leaderboardSearch = $("[data-leaderboard-search]");
    const topPlayer = $("[data-top-player]");
    const topPlayerMeta = $("[data-top-player-meta]");
    const leaderboardCount = $("[data-leaderboard-count]");

    let leaderboardData = [];
    let activeLeaderboardSearch = "";

    const getWinCount = (player, series) => {
      if (player.wins && player.wins[series] !== undefined) {
        return Number(player.wins[series] || 0);
      }

      const value = player.results?.[series] || player[series];
      if (!value) return 0;
      if (typeof value === "number") return value;
      if (typeof value === "string") return value === "gold" ? 1 : 0;
      return Number(value.gold || value.wins || 0);
    };

    const renderWinCell = (count) => {
      const wins = Number(count || 0);
      return wins
        ? `<strong class="leaderboard-win-count">${wins}</strong>`
        : '<span class="leaderboard-series-empty">—</span>';
    };

    const getLeaderboardPoints = (player) =>
      Number(
        player.points ??
        player.vcl_points ??
        player.vclPoints ??
        player.total_points ??
        player.totalPoints ??
        player.vp ??
        0
      );

    const normalizeTeamLookupKey = (value) =>
      String(value || "").trim().toLocaleLowerCase("da-DK");

    const attachTeamLogos = (players, teams) => {
      const teamsById = new Map();
      const teamsByName = new Map();

      (teams || []).forEach((team) => {
        const teamId = team.id || team.slug || "";
        const teamName = team.name || "";
        if (teamId) teamsById.set(String(teamId), team);
        if (teamName) teamsByName.set(normalizeTeamLookupKey(teamName), team);
      });

      return (players || []).map((player) => {
        const currentTeamId = player.current_team_id || player.currentTeamId || "";
        const currentTeamName = player.current_team_name || player.currentTeamName || "";
        const team =
          (currentTeamId && teamsById.get(String(currentTeamId))) ||
          (currentTeamName && teamsByName.get(normalizeTeamLookupKey(currentTeamName))) ||
          null;

        return {
          ...player,
          teamName: team?.name || currentTeamName || "",
          teamSlug: team?.slug || team?.id || currentTeamId || "",
          teamLogo: team?.logo || team?.logo_url || player.current_team_logo_url || ""
        };
      });
    };

    const renderLeaderboard = () => {
      if (!leaderboardList) return;

      const filtered = leaderboardData.filter((player) => {
        const searchText = `${player.alias || ""} ${player.playerId || ""} ${player.slug || ""} ${player.teamName || ""}`.toLowerCase();
        return searchText.includes(activeLeaderboardSearch);
      });

      if (!filtered.length) {
        leaderboardList.innerHTML = `
          <div class="leaderboard-empty">
            ${activeLeaderboardSearch ? "Ingen spillere matcher din søgning." : "Der er endnu ingen spillere på leaderboardet."}
          </div>
        `;
        return;
      }

      leaderboardList.innerHTML = filtered
        .map((player) => {
          const championshipWins = getWinCount(player, "championship");
          const contenderWins = getWinCount(player, "contender");
          const academyWins = getWinCount(player, "academy");
          const profileSlug = player.player_slug || player.playerId || player.slug || "";
          const rank = Number(player.rank || 0);
          const podiumClass = rank >= 1 && rank <= 3 ? ` leaderboard-row--rank-${rank}` : "";
          const teamName = player.teamName || "Uden hold";

          return `
            <a class="leaderboard-row leaderboard-row--series leaderboard-row--v2${podiumClass}" data-leaderboard-row href="player-profile.html?player=${encodeURIComponent(profileSlug)}" aria-label="Se ${escapeHTML(player.alias || "spiller")} profil">
              <div class="leaderboard-rank"><span>#</span>${escapeHTML(rank)}</div>
              <div class="leaderboard-player leaderboard-player--v2">
                <span class="leaderboard-player-avatar-v1" aria-hidden="true">${escapeHTML((player.alias || "?").charAt(0).toUpperCase())}${player.avatarUrl ? `<img src="${escapeHTML(player.avatarUrl)}" alt="" loading="lazy">` : ""}</span>
                <span class="leaderboard-player__copy">
                  <strong>${escapeHTML(player.alias || "Ukendt spiller")}</strong>
                  <span>Se spillerprofil</span>
                </span>
              </div>
              <div class="leaderboard-team-v2">
                <span class="leaderboard-team-logo${player.teamLogo ? "" : " leaderboard-team-logo--empty"}">
                  ${player.teamLogo ? `<img src="${escapeHTML(player.teamLogo)}" alt="" loading="lazy" data-leaderboard-team-logo>` : '<span aria-hidden="true">—</span>'}
                </span>
                <span>${escapeHTML(teamName)}</span>
              </div>
              <div class="leaderboard-points"><strong>${escapeHTML(getLeaderboardPoints(player))}</strong><span>VP</span></div>
              <div class="leaderboard-series-cell" data-label="Championship">${renderWinCell(championshipWins)}</div>
              <div class="leaderboard-series-cell" data-label="Contender">${renderWinCell(contenderWins)}</div>
              <div class="leaderboard-series-cell" data-label="Academy">${renderWinCell(academyWins)}</div>
            </a>
          `;
        })
        .join("");

      leaderboardList.querySelectorAll("[data-leaderboard-team-logo]").forEach((logo) => {
        logo.addEventListener("error", () => {
          logo.src = "assets/teams/default-team.png";
        }, { once: true });
      });
    };

    const normalizeLeaderboardData = (players, teams = [], avatarMap = {}) =>
      attachTeamLogos(
        Array.isArray(players) ? players : [],
        Array.isArray(teams) ? teams : []
      )
        .map((player) => ({
          ...player,
          avatarUrl:
            avatarMap?.[player.player_slug || player.playerId || player.slug || ""] ||
            player.avatar_url ||
            null
        }))
        .sort((a, b) => {
          const pointsDifference = getLeaderboardPoints(b) - getLeaderboardPoints(a);
          if (pointsDifference !== 0) return pointsDifference;
          return String(a.alias || "").localeCompare(String(b.alias || ""), "da");
        })
        .map((player, index) => ({
          ...player,
          rank: Number(player.rank || player.leaderboard_rank || index + 1)
        }));

    const updateLeaderboardSummary = () => {
      const firstPlayer = leaderboardData[0];
      if (topPlayer) topPlayer.textContent = firstPlayer?.alias || "—";
      if (topPlayerMeta) {
        topPlayerMeta.textContent = firstPlayer
          ? `${firstPlayer.teamName ? `${firstPlayer.teamName} · ` : ""}${getLeaderboardPoints(firstPlayer)} VP`
          : "Ingen spillere på leaderboardet endnu";
      }
      if (leaderboardCount) leaderboardCount.textContent = String(leaderboardData.length);
    };

    const loadLeaderboard = async () => {
      try {
        const dataLayer = await waitForVCLData("getLeaderboard", 8000);

        // Render the core leaderboard as soon as it is available. Team logos and
        // approved avatars are enrichment data and must not hold the list hostage
        // on slower mobile connections.
        const players = await dataLayer.getLeaderboard();
        leaderboardData = normalizeLeaderboardData(players);
        updateLeaderboardSummary();
        renderLeaderboard();

        const enrichment = await Promise.allSettled([
          dataLayer.getTeamIdentities ? dataLayer.getTeamIdentities() : dataLayer.getTeams(),
          dataLayer.getPlayerAvatarMap ? dataLayer.getPlayerAvatarMap() : Promise.resolve({})
        ]);

        const teams = enrichment[0]?.status === "fulfilled" ? enrichment[0].value : [];
        const avatarMap = enrichment[1]?.status === "fulfilled" ? enrichment[1].value : {};

        if ((Array.isArray(teams) && teams.length) || Object.keys(avatarMap || {}).length) {
          leaderboardData = normalizeLeaderboardData(players, teams, avatarMap);
          updateLeaderboardSummary();
          renderLeaderboard();
        }
      } catch (error) {
        console.error("Leaderboard kunne ikke hentes fra Supabase:", error);
        if (leaderboardList) {
          leaderboardList.innerHTML = `
            <div class="leaderboard-empty leaderboard-state-v2">
              <strong>Kunne ikke hente leaderboard</strong>
              <span>Prøv at genindlæse siden om et øjeblik.</span>
            </div>
          `;
        }
      }
    };

    if (leaderboardList) {
      leaderboardList.innerHTML = `
        <div class="leaderboard-loading leaderboard-state-v2">
          <strong>Indlæser leaderboard...</strong>
          <span>Henter VCL-ranglisten</span>
        </div>
      `;
    }

    if (leaderboardSearch) {
      leaderboardSearch.addEventListener("input", () => {
        activeLeaderboardSearch = leaderboardSearch.value.trim().toLowerCase();
        renderLeaderboard();
      });
    }

    loadLeaderboard();
  }

  /* =========================
     PLAYER PROFILE SUPABASE DATA
  ========================= */

const playerProfilePage = $(".player-profile-page:not(.account-page):not(.team-profile-page):not(.team-dashboard-page)");

  if (playerProfilePage && window.VCLData) {
    const params = new URLSearchParams(window.location.search);
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
      }
      const context = window.VCLData.getPlayerProfileContext
        ? await window.VCLData.getPlayerProfileContext(playerSlug)
        : null;
      const player = context?.player || await window.VCLData.getPlayerBySlug(playerSlug);
      const leaderboardEntry = context?.leaderboardEntry || null;
      const team = context?.team || null;

      if (!player) {
        console.warn("Ingen spiller fundet:", playerSlug);
        renderMissingPlayerProfile();
        return;
      }

      const profileName = $("[data-player-name]") || $(".player-profile-main h1");
      const profileBio = $("[data-player-bio]") || $(".player-profile-main p");
      const profileAvatar = $("[data-player-avatar]") || $(".player-profile-avatar span");
      const profileKickerStatus = $("[data-player-roster-status]");
      const profileTeamPill = $("[data-player-team-pill]");
      const profileTeamLogo = $("[data-player-team-logo]");
      const profileTeamName = $("[data-player-team-name]");
      const profileTags = $("[data-player-tags]") || $(".player-profile-tags");
      const profileTeamFallback = $("[data-player-team-fallback]");
      const profileTeamFallbackTitle = $("[data-player-team-fallback-title]");
      const profileTeamFallbackCopy = $("[data-player-team-fallback-copy]");
      const rosterMarketAction = $("[data-player-roster-action]");

      if (profileName) {
        profileName.textContent = player.alias || "Unknown Player";
      }

      if (profileBio) {
        profileBio.textContent =
          player.bio ||
          "Denne spiller har ikke skrevet en profiltekst endnu.";
      }

      if (profileAvatar) {
        const fallbackInitial = (player.alias || "?").charAt(0).toUpperCase();
        profileAvatar.textContent = fallbackInitial;
        const avatarContainer = profileAvatar.closest(".player-avatar-v3") || profileAvatar.parentElement;
        const existingImage = avatarContainer?.querySelector("img[data-player-avatar-image]");
        if (player.avatar_url && avatarContainer) {
          const image = existingImage || document.createElement("img");
          image.setAttribute("data-player-avatar-image", "");
          image.src = player.avatar_url;
          image.alt = `${player.alias || "VCL spiller"} profilbillede`;
          image.loading = "eager";
          if (!existingImage) avatarContainer.appendChild(image);
          profileAvatar.hidden = true;
          image.hidden = false;
          image.addEventListener("error", () => {
            image.hidden = true;
            profileAvatar.hidden = false;
          }, { once: true });
        } else if (existingImage) {
          existingImage.hidden = true;
          profileAvatar.hidden = false;
        }
      }

      const currentTeamName = team?.name || player.current_team_name || "";
      const currentTeamSlug = team?.slug || player.current_team_slug || "";
      const currentTeamLogo =
        team?.logo_url ||
        player.current_team_logo_url ||
        leaderboardEntry?.current_team_logo_url ||
        "assets/teams/default-team.png";
      const hasCurrentTeam = Boolean(currentTeamName);

      if (profileKickerStatus) {
        profileKickerStatus.hidden = false;
        profileKickerStatus.textContent = hasCurrentTeam
          ? "Aktiv roster"
          : player.is_free_agent
            ? "Free Agent"
            : "Uden hold";
      }

      if (profileTeamPill) {
        profileTeamPill.hidden = !hasCurrentTeam;
        profileTeamPill.href = currentTeamSlug
          ? `team-profile.html?team=${encodeURIComponent(currentTeamSlug)}`
          : "teams.html";
      }

      if (profileTeamFallback) {
        profileTeamFallback.hidden = hasCurrentTeam;
      }

      if (!hasCurrentTeam && profileTeamFallbackTitle) {
        profileTeamFallbackTitle.textContent = player.is_free_agent ? "Free Agent" : "Uden hold";
      }

      if (!hasCurrentTeam && profileTeamFallbackCopy) {
        profileTeamFallbackCopy.textContent = player.is_free_agent
          ? "Spilleren er tilgængelig via Roster Market."
          : "Spilleren er ikke på en aktiv VCL-roster.";
      }

      if (rosterMarketAction) {
        rosterMarketAction.hidden = hasCurrentTeam || !player.is_free_agent;
      }

      if (profileTeamName) {
        profileTeamName.textContent = currentTeamName || "VCL Team";
      }

      if (profileTeamLogo) {
        profileTeamLogo.src = currentTeamLogo;
        profileTeamLogo.alt = currentTeamName ? `${currentTeamName} logo` : "";
        profileTeamLogo.addEventListener("error", () => {
          profileTeamLogo.src = "assets/teams/default-team.png";
        }, { once: true });
      }

      if (profileTags) {
        const tags = [
          player.primary_role,
          player.level
        ].filter(Boolean);

        profileTags.innerHTML = tags
          .map((tag) => `<span>${escapeHTML(tag)}</span>`)
          .join("");
      }

      const points = leaderboardEntry?.points ?? player.points ?? 0;
      const rank = leaderboardEntry?.rank ?? leaderboardEntry?.leaderboard_rank ?? null;
      const tier = leaderboardEntry?.tier || leaderboardEntry?.level || player.level || "Unranked";

      setText("[data-player-points]", points);
      setText("[data-player-rank]", rank ? `#${rank}` : "—");
      setText("[data-player-rank-tier]", rank ? String(tier).toUpperCase() : "UNRANKED");
      setText("[data-player-stat-team-name]", hasCurrentTeam ? currentTeamName : "Free Agent");
      setText("[data-player-championship-wins]", player.championship_wins ?? leaderboardEntry?.championship_wins ?? 0);
      setText("[data-player-contender-wins]", player.contender_wins ?? leaderboardEntry?.contender_wins ?? 0);
      setText("[data-player-academy-wins]", player.academy_wins ?? leaderboardEntry?.academy_wins ?? 0);

      const statTeamLink = $("[data-player-stat-team-link]");
      const statTeamLogo = $("[data-player-stat-team-logo]");

      if (statTeamLink) {
        statTeamLink.href = hasCurrentTeam && currentTeamSlug
          ? `team-profile.html?team=${encodeURIComponent(currentTeamSlug)}`
          : "teams.html";
      }

      if (statTeamLogo) {
        statTeamLogo.hidden = !hasCurrentTeam;
        statTeamLogo.src = currentTeamLogo;
        statTeamLogo.alt = currentTeamName ? `${currentTeamName} logo` : "";
        statTeamLogo.addEventListener("error", () => {
          statTeamLogo.src = "assets/teams/default-team.png";
        }, { once: true });
      }

      setText(
        "[data-player-info-primary]",
        player.primary_role || "Ikke valgt"
      );
      setText(
        "[data-player-info-level]",
        player.level || "Ikke valgt"
      );
      setText(
        "[data-player-info-status]",
        hasCurrentTeam
          ? "Aktiv roster"
          : player.is_free_agent
            ? "Søger hold"
            : "Uden hold"
      );
      setText(
        "[data-player-info-discord]",
        player.discord ? player.discord : "Ikke tilknyttet"
      );
            const historyList = $("[data-player-history-list]");

      if (historyList && window.VCLData.getPlayerHistory) {
        const history = await window.VCLData.getPlayerHistory(playerSlug);

        function formatSeries(series) {
          if (series === "championship") return "Championship";
          if (series === "contender") return "Contender";
          if (series === "academy") return "Academy";
          return series || "VCL";
        }

        function formatPlacement(placement) {
          const numericPlacement = Number(placement);
          return Number.isFinite(numericPlacement) && numericPlacement > 0
            ? `${numericPlacement}. plads`
            : "Placering";
        }

        if (!history.length) {
          historyList.innerHTML = `
            <article class="player-history-v3__item player-history-v3__item--empty">
              <span class="player-history-v3__placement">—</span>
              <div>
                <strong>Ingen registreret historik endnu</strong>
                <p>Denne spiller har endnu ingen officielle VCL-placeringer.</p>
              </div>
            </article>
          `;
        } else {
          historyList.innerHTML = history
            .map((item) => {
              const seriesName = formatSeries(item.series);
              const placementText = formatPlacement(item.placement);
              const placement = Number(item.placement) || 0;
              const teamText = item.team_name
                ? ` · ${escapeHTML(item.team_name)}`
                : "";

              return `
                <article class="player-history-v3__item" data-placement="${placement}">
                  <span class="player-history-v3__placement">${escapeHTML(placementText)}</span>
                  <div>
                    <strong>${escapeHTML(item.event_name || "VCL Event")}</strong>
                    <p>${escapeHTML(seriesName)}${teamText}</p>
                  </div>
                </article>
              `;
            })
            .join("");
        }
      }


      document.title = `${player.alias} — VCL Player Profile`;
    }

    loadPlayerProfile();
  }
  /* =========================
     TEAM SIGNUP → SUPABASE
  ========================= */

  const isTeamSignupPage = window.location.pathname.includes("registrer-hold");
  const teamSignupForm = isTeamSignupPage ? document.querySelector("form") : null;

  if (teamSignupForm) {
    let signupStatus = $("[data-signup-status]") || teamSignupForm.querySelector(".notice");

    if (!signupStatus) {
      signupStatus = document.createElement("p");
      signupStatus.className = "notice";
      teamSignupForm.appendChild(signupStatus);
    }

    const setSignupStatus = (message, type = "info") => {
      signupStatus.textContent = message;
      signupStatus.dataset.status = type;
    };

    const getField = (formData, name) => {
      return String(formData.get(name) || "").trim();
    };

    const getRulesAccepted = () => {
      const rulesInput =
        teamSignupForm.querySelector('[name="rules_acceptance"]') ||
        teamSignupForm.querySelector('[name="rules_accepted"]') ||
        teamSignupForm.querySelector('[type="checkbox"]');

      return Boolean(rulesInput?.checked);
    };

    teamSignupForm.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();

        const formData = new FormData(teamSignupForm);

        // Permanent team registration is separate from tournament entry, but the legacy
        // team_signups schema still requires a valid series_slug. Mirror the selected
        // VCL level as a compatibility slug until team registrations get their own table.
        const teamLevel = getField(formData, "team_level");
        const seriesSlug = teamLevel.toLowerCase();
        const validSeriesSlugs = new Set(["academy", "contender", "championship"]);

        const roster = [1, 2, 3, 4]
          .map((number) => ({
            slot: number,
            alias: getField(formData, `player_${number}`)
          }))
          .filter((player) => player.alias);

        const substitutes = [1, 2]
          .map((number) => ({
            slot: number,
            alias: getField(formData, `sub_${number}`)
          }))
          .filter((player) => player.alias);
        const logoInput = teamSignupForm.querySelector('[name="team_logo"]');
        const logoFile = logoInput?.files?.[0] || null;
        const signup = {
          series_slug: seriesSlug,
          tournament_id: null,
          tournament_slug: "",
          tournament_label: "Holdregistrering",

          team_name: getField(formData, "team_name"),
          team_level: teamLevel,
          logo_url: "",
          captain_name: getField(formData, "captain_name"),
          captain_discord: getField(formData, "captain_discord"),
          captain_email: getField(formData, "captain_email"),
          captain_phone: getField(formData, "captain_phone"),

          roster,
          substitutes,

          message: getField(formData, "message"),
          discord_confirmed: Boolean(
            teamSignupForm.querySelector('[name="discord_confirmed"]')?.checked
          ),
          checkin_confirmed: false,
          rules_accepted: getRulesAccepted(),

          status: "pending",
          source: "team_registration"
        };

        if (!signup.team_name || !signup.team_level || !signup.captain_name || !signup.captain_discord || !signup.captain_email) {
          setSignupStatus("Udfyld holdnavn, niveau, captain-navn, Discord og email.", "error");
          return;
        }

        if (!validSeriesSlugs.has(signup.series_slug)) {
          setSignupStatus("Vælg et gyldigt VCL-niveau: Academy, Contender eller Championship.", "error");
          return;
        }

        if (signup.roster.length < 2) {
          setSignupStatus("Tilføj mindst 2 spillere til startopstillingen.", "error");
          return;
        }

        if (signup.roster.length > 4 || signup.substitutes.length > 2) {
          setSignupStatus("Et VCL-hold kan have maks. 4 starters og 2 substitutes.", "error");
          return;
        }

        if (!signup.discord_confirmed) {
          setSignupStatus(
            "Du skal bekræfte, at alle spillere er på VCL Discord.",
            "error"
          );
          return;
        }

        if (!signup.rules_accepted) {
          setSignupStatus("Du skal acceptere VCL-reglerne før registrering.", "error");
          return;
        }

       try {
  setSignupStatus("Sender holdregistrering til VCL...", "info");

  const VCLData = await waitForVCLData("submitTeamSignup");

  if (logoFile) {
    if (!VCLData.uploadTeamLogo) {
      throw new Error("Logo-upload er ikke klar endnu.");
    }

    setSignupStatus("Uploader team logo...", "info");
    signup.logo_url = await VCLData.uploadTeamLogo(
      logoFile,
      signup.team_name
    );
  }

  setSignupStatus("Gemmer holdregistreringen i VCL...", "info");

  await VCLData.submitTeamSignup(signup);
          setSignupStatus(
            "Holdet er sendt til godkendelse. VCL gennemgår nu rosteren og holdets niveau.",
            "success"
          );

          const submittedButton = teamSignupForm.querySelector('button[type="submit"]');
          if (submittedButton) {
            submittedButton.disabled = true;
            submittedButton.innerHTML = 'Registrering sendt <span aria-hidden="true">✓</span>';
          }
          teamSignupForm.dataset.registrationSubmitted = "true";
        } catch (error) {
          console.error(error);
          setSignupStatus(
            "Kunne ikke sende holdregistreringen. Tjek console eller Supabase policies.",
            "error"
          );
        }
      },
      true
    );
  }
    /* =========================
     ACCOUNT DASHBOARD
  ========================= */

  const accountPage = $("[data-account-page]");

  if (accountPage && window.VCLData) {
    const accountForm = $("[data-account-form]");
    const logoutButton = $("[data-logout-button]");
    const statusMessage = $("[data-account-status-message]");
    const playerProfileForm = $("[data-player-profile-form]");
const noClaimedPlayerBox = $("[data-no-claimed-player]");
const claimedPlayerSummary = $("[data-claimed-player-summary]");
const freeAgentForm = $("[data-free-agent-form]");
const freeAgentStatus = $("[data-free-agent-status]");
const teamInvitesSection = $("[data-team-invites-section]");
const teamInvitesList = $("[data-team-invites-list]");
const claimInviteSection = $("[data-claim-invite-section]");
const claimInviteBox = $("[data-claim-invite-box]");
const playerProfileStatus = $("[data-player-profile-status]");
const playerAvatarManager = $("[data-player-avatar-manager]");
const playerAvatarInput = $("[data-player-avatar-input]");
const playerAvatarPreview = $("[data-player-avatar-preview]");
const playerAvatarImage = $("[data-player-avatar-image]");
const playerAvatarFallback = $("[data-player-avatar-fallback]");
const playerAvatarSubmit = $("[data-player-avatar-submit]");
const playerAvatarRemove = $("[data-player-avatar-remove]");
const playerAvatarStatusLabel = $("[data-player-avatar-status-label]");
const playerAvatarStatusCopy = $("[data-player-avatar-status-copy]");
const playerAvatarFileInfo = $("[data-player-avatar-file-info]");
const playerAvatarMessage = $("[data-player-avatar-message]");
let preparedPlayerAvatarBlob = null;
let preparedPlayerAvatarUrl = null;
let currentPlayerAvatarStatus = null;
const overviewPlayerStatus = $("[data-overview-player-status]");
const overviewPlayerMeta = $("[data-overview-player-meta]");
const overviewTeamStatus = $("[data-overview-team-status]");
const overviewTeamMeta = $("[data-overview-team-meta]");
const overviewTeamLink = $("[data-overview-team-link]");
const overviewAccessStatus = $("[data-overview-access-status]");
const overviewAccessMeta = $("[data-overview-access-meta]");
const overviewToolsLink = $("[data-overview-tools-link]");
let myClaimedPlayer = null;
let myCaptainData = null;

function setPlayerAvatarMessage(message, status = "info") {
  if (!playerAvatarMessage) return;
  playerAvatarMessage.textContent = message || "";
  playerAvatarMessage.dataset.status = status;
}

function revokePreparedPlayerAvatarUrl() {
  if (preparedPlayerAvatarUrl) {
    URL.revokeObjectURL(preparedPlayerAvatarUrl);
    preparedPlayerAvatarUrl = null;
  }
}

function renderPlayerAvatarPreview(url, fallbackAlias = "V") {
  if (playerAvatarFallback) {
    playerAvatarFallback.textContent = String(fallbackAlias || "V").charAt(0).toUpperCase();
  }
  if (!playerAvatarImage) return;
  if (url) {
    playerAvatarImage.src = url;
    playerAvatarImage.hidden = false;
    if (playerAvatarFallback) playerAvatarFallback.hidden = true;
  } else {
    playerAvatarImage.removeAttribute("src");
    playerAvatarImage.hidden = true;
    if (playerAvatarFallback) playerAvatarFallback.hidden = false;
  }
}

async function preparePlayerAvatar(file) {
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!file || !allowedTypes.has(file.type)) {
    throw new Error("Vælg et PNG-, JPG- eller WEBP-billede.");
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("Originalbilledet må højst fylde 2 MB.");
  }

  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sourceX = Math.max(0, Math.floor((bitmap.width - side) / 2));
  const sourceY = Math.max(0, Math.floor((bitmap.height - side) / 2));
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    bitmap.close?.();
    throw new Error("Browseren kunne ikke behandle billedet.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, sourceX, sourceY, side, side, 0, 0, 512, 512);
  bitmap.close?.();

  const qualities = [0.84, 0.76, 0.68, 0.6];
  let blob = null;
  for (const quality of qualities) {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (blob && blob.size <= 520000) break;
  }
  if (!blob) throw new Error("Billedet kunne ikke konverteres til WEBP.");
  if (blob.size > 600000) throw new Error("Billedet er stadig for stort efter behandling. Prøv et andet billede.");
  return blob;
}

async function loadPlayerAvatarManager(player) {
  if (!playerAvatarManager || !player || !window.VCLData.getMyPlayerAvatarStatus) {
    if (playerAvatarManager) playerAvatarManager.hidden = true;
    return;
  }

  playerAvatarManager.hidden = false;
  try {
    currentPlayerAvatarStatus = await window.VCLData.getMyPlayerAvatarStatus();
  } catch (error) {
    console.error(error);
    setPlayerAvatarMessage("Avatarstatus kunne ikke hentes. Prøv igen om et øjeblik.", "error");
    return;
  }

  const alias = currentPlayerAvatarStatus?.alias || player.alias || "V";
  let previewUrl = currentPlayerAvatarStatus?.avatar_url || null;
  const status = currentPlayerAvatarStatus?.submission_status || "";

  if (status === "pending" && currentPlayerAvatarStatus?.pending_storage_path && window.VCLData.createMyPendingAvatarPreview) {
    const pendingUrl = await window.VCLData.createMyPendingAvatarPreview(currentPlayerAvatarStatus.pending_storage_path);
    if (pendingUrl) previewUrl = pendingUrl;
  }

  renderPlayerAvatarPreview(previewUrl, alias);
  if (playerAvatarRemove) playerAvatarRemove.hidden = !currentPlayerAvatarStatus?.avatar_url;
  if (playerAvatarSubmit) playerAvatarSubmit.disabled = true;
  preparedPlayerAvatarBlob = null;
  revokePreparedPlayerAvatarUrl();

  if (status === "pending") {
    if (playerAvatarStatusLabel) playerAvatarStatusLabel.textContent = "Afventer admin-godkendelse";
    if (playerAvatarStatusCopy) playerAvatarStatusCopy.textContent = currentPlayerAvatarStatus?.avatar_url
      ? "Dit nuværende godkendte billede bliver ved med at være offentligt, indtil det nye er godkendt."
      : "Billedet er kun synligt for dig og VCL-admins, indtil det bliver godkendt.";
  } else if (status === "rejected") {
    if (playerAvatarStatusLabel) playerAvatarStatusLabel.textContent = "Seneste billede blev afvist";
    if (playerAvatarStatusCopy) playerAvatarStatusCopy.textContent = currentPlayerAvatarStatus?.reject_reason
      ? `Admin-note: ${currentPlayerAvatarStatus.reject_reason}`
      : "Du kan vælge et nyt billede og sende det til godkendelse igen.";
  } else if (currentPlayerAvatarStatus?.avatar_url) {
    if (playerAvatarStatusLabel) playerAvatarStatusLabel.textContent = "Godkendt profilbillede";
    if (playerAvatarStatusCopy) playerAvatarStatusCopy.textContent = "Dette billede bruges offentligt på din VCL-profil og spilleroversigter.";
  } else {
    if (playerAvatarStatusLabel) playerAvatarStatusLabel.textContent = "Intet profilbillede";
    if (playerAvatarStatusCopy) playerAvatarStatusCopy.textContent = "Upload et billede, hvis du vil have en personlig avatar på VCL.";
  }

  if (playerAvatarFileInfo) playerAvatarFileInfo.textContent = "PNG, JPG eller WEBP · maks. 2 MB før behandling.";
  setPlayerAvatarMessage("", "info");

  const accountAvatarBox = document.querySelector(".account-avatar-v2");
  if (accountAvatarBox) {
    if (currentPlayerAvatarStatus?.avatar_url) {
      accountAvatarBox.innerHTML = `<img src="${escapeHTML(currentPlayerAvatarStatus.avatar_url)}" alt="" loading="lazy">`;
    } else {
      accountAvatarBox.innerHTML = `<span data-account-avatar>${escapeHTML(String(alias).charAt(0).toUpperCase())}</span>`;
    }
  }
}

function setOverviewText(element, value) {
  if (element) element.textContent = value;
}

async function renderAccountQuickAccess(profile) {
  const quickAccessBox = $("[data-account-quick-access]");
  const actionsBox = quickAccessBox?.querySelector("[data-account-quick-actions]");
  if (!quickAccessBox || !actionsBox) return;

  const actions = [];
  const role = String(profile?.role || "player").toLowerCase();
  const isAdmin = role === "admin";

  if (isAdmin) {
    actions.push(`
      <a class="account-tool-card account-tool-card--admin" href="admin.html">
        <span>Admin</span>
        <strong>Admin panel</strong>
        <p>Godkend hold, administrér nyheder, claims, turneringer og platformdata.</p>
      </a>
    `);
  }

  myCaptainData = null;
  try {
    if (window.VCLData?.getMyCaptainTeam) {
      myCaptainData = await window.VCLData.getMyCaptainTeam();
    }
  } catch (error) {
    console.warn("Kunne ikke tjekke captain adgang:", error);
  }

  if (myCaptainData?.team) {
    actions.push(`
      <a class="account-tool-card account-tool-card--captain" href="team-dashboard.html">
        <span>Captain</span>
        <strong>Team dashboard</strong>
        <p>Administrér roster, holdinfo, claim-links og captain-adgang for ${escapeHTML(myCaptainData.team.name || "dit hold")}.</p>
      </a>
    `);

    if (myCaptainData.team.slug) {
      actions.push(`
        <a class="account-tool-card" href="team-profile.html?team=${encodeURIComponent(myCaptainData.team.slug)}">
          <span>Offentligt hold</span>
          <strong>Se holdprofil</strong>
          <p>Åbn den offentlige VCL-side for ${escapeHTML(myCaptainData.team.name || "dit hold")}.</p>
        </a>
      `);
    }
  }

  const isCaptain = Boolean(myCaptainData?.team);
  const accessLabel = isAdmin && isCaptain ? "Admin + Captain" : isAdmin ? "Administrator" : isCaptain ? "Captain" : "Spiller";
  const accessCopy = isAdmin && isCaptain
    ? "Fuld platformadgang og Captain Tools er aktive."
    : isAdmin
      ? "Du har adgang til VCL's administrative værktøjer."
      : isCaptain
        ? "Captain Tools er aktive for dit hold."
        : "Standard VCL-adgang til din spillerprofil og holdfunktioner.";

  setOverviewText(overviewAccessStatus, accessLabel);
  setOverviewText(overviewAccessMeta, accessCopy);

  if (myCaptainData?.team) {
    setOverviewText(overviewTeamStatus, myCaptainData.team.name || "Dit VCL-hold");
    setOverviewText(overviewTeamMeta, `Captain${myCaptainData.team.tier ? ` · ${myCaptainData.team.tier}` : ""}`);
    if (overviewTeamLink && myCaptainData.team.slug) {
      overviewTeamLink.href = `team-profile.html?team=${encodeURIComponent(myCaptainData.team.slug)}`;
      overviewTeamLink.innerHTML = 'Se holdprofil <span aria-hidden="true">→</span>';
    }
  }

  if (!actions.length) {
    quickAccessBox.hidden = true;
    actionsBox.innerHTML = "";
    if (overviewToolsLink) overviewToolsLink.hidden = true;
    return;
  }

  actionsBox.innerHTML = actions.join("");
  quickAccessBox.hidden = false;
  if (overviewToolsLink) overviewToolsLink.hidden = false;
}

async function loadTeamInvites() {
  if (!teamInvitesSection || !teamInvitesList || !window.VCLData?.getMyTeamInvites) {
    return;
  }

  const invites = await window.VCLData.getMyTeamInvites();

  if (!invites.length) {
    teamInvitesSection.hidden = true;
    teamInvitesList.innerHTML = "";
    return;
  }

  teamInvitesSection.hidden = false;

  teamInvitesList.innerHTML = invites
    .map((invite) => {
      const message = invite.message
        ? `<p>${escapeHTML(invite.message)}</p>`
        : `<p>Ingen besked fra captain.</p>`;

      return `
        <article class="team-invite-card">
          <span>${escapeHTML(invite.team_tier || "VCL Team")}</span>
          <strong>${escapeHTML(invite.team_name || "Ukendt team")}</strong>

          <p>
            Inviteret af
            <a href="player-profile.html?player=${encodeURIComponent(invite.invited_by_player_slug || "")}">
              ${escapeHTML(invite.invited_by_player_alias || "Captain")}
            </a>
          </p>

          ${message}

          <div class="team-invite-card__actions">
            <button type="button" data-accept-team-invite="${escapeHTML(invite.id)}">
              Acceptér
            </button>

            <button type="button" data-decline-team-invite="${escapeHTML(invite.id)}">
              Afvis
            </button>
          </div>

          <p class="notice" data-team-invite-status="${escapeHTML(invite.id)}"></p>
        </article>
      `;
    })
    .join("");

  $$("[data-accept-team-invite]").forEach((button) => {
    button.addEventListener("click", async () => {
      const inviteId = button.dataset.acceptTeamInvite;
      const status = $(`[data-team-invite-status="${inviteId}"]`);

      try {
        button.disabled = true;

        if (status) {
          status.textContent = "Accepterer invite...";
          status.dataset.status = "info";
        }

        await window.VCLData.acceptTeamInvite(inviteId);

        if (status) {
          status.textContent = "Invite accepteret. Du er nu tilføjet til holdet.";
          status.dataset.status = "success";
        }

        await loadAccountPage();
      } catch (error) {
        console.error(error);
        button.disabled = false;

        const message = error?.message || "Kunne ikke acceptere invitationen.";
        if (status) {
          status.textContent = message;
          status.dataset.status = "error";
        }

        // If the backend says the invite is no longer active/valid, refresh the list so
        // a stale invitation never remains visible on the account page.
        if (/ingen aktiv|not active|not found|allerede|already/i.test(message)) {
          await loadTeamInvites();
        }
      }
    });
  });

  $$("[data-decline-team-invite]").forEach((button) => {
    button.addEventListener("click", async () => {
      const inviteId = button.dataset.declineTeamInvite;
      const status = $(`[data-team-invite-status="${inviteId}"]`);

      try {
        button.disabled = true;

        if (status) {
          status.textContent = "Afviser invite...";
          status.dataset.status = "info";
        }

        await window.VCLData.declineTeamInvite(inviteId);

        if (status) {
          status.textContent = "Invite afvist.";
          status.dataset.status = "success";
        }

        await loadTeamInvites();
      } catch (error) {
        console.error(error);
        button.disabled = false;

        const message = error?.message || "Kunne ikke afvise invitationen.";
        if (status) {
          status.textContent = message;
          status.dataset.status = "error";
        }

        if (/ingen aktiv|not active|not found|allerede|already/i.test(message)) {
          await loadTeamInvites();
        }
      }
    });
  });
}

async function loadClaimInvite() {
  if (
    !claimInviteSection ||
    !claimInviteBox ||
    !window.VCLData?.getClaimInviteByToken ||
    !window.VCLData?.acceptClaimInvite
  ) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const token = params.get("claim");

  if (!token) {
    claimInviteSection.hidden = true;
    return;
  }

  claimInviteSection.hidden = false;

  const invite = await window.VCLData.getClaimInviteByToken(token);

  if (!invite) {
    claimInviteBox.innerHTML = `
      <article>
        <span>Invalid</span>
        <strong>Claim link kunne ikke findes</strong>
        <p>Linket er ugyldigt eller findes ikke længere.</p>
      </article>
    `;
    return;
  }

  const isExpired = invite.expires_at && new Date(invite.expires_at) <= new Date();
  const isPending = invite.status === "pending";

  if (!isPending || isExpired) {
    claimInviteBox.innerHTML = `
      <article>
        <span>${escapeHTML(invite.status || "Unavailable")}</span>
        <strong>${escapeHTML(invite.player_alias || "Player profile")}</strong>
        <p>
          Dette claim link er ikke længere aktivt.
        </p>
      </article>
    `;
    return;
  }

  claimInviteBox.innerHTML = `
    <article class="claim-invite-card">
      <span>Pending claim</span>

      <strong>${escapeHTML(invite.player_alias || "Ukendt spiller")}</strong>

      <p>
        Du er inviteret til at claime denne player profile
        ${
          invite.team_name
            ? `fra <strong>${escapeHTML(invite.team_name)}</strong>.`
            : "."
        }
      </p>

      ${
        invite.invited_by_player_alias
          ? `<p>Inviteret af ${escapeHTML(invite.invited_by_player_alias)}.</p>`
          : ""
      }

      <div class="claim-invite-card__actions">
        <button type="button" data-accept-claim-invite>
          Claim profile
        </button>

        <a href="player-profile.html?player=${encodeURIComponent(invite.player_slug || "")}">
          Se public profile
        </a>
      </div>

      <p class="notice" data-claim-invite-status></p>
    </article>
  `;

  const acceptButton = $("[data-accept-claim-invite]");
  const status = $("[data-claim-invite-status]");

  if (acceptButton) {
    acceptButton.addEventListener("click", async () => {
      try {
        acceptButton.disabled = true;
        acceptButton.textContent = "Claimer...";

        if (status) {
          status.textContent = "Claimer player profile...";
          status.dataset.status = "info";
        }

        await window.VCLData.acceptClaimInvite(token);

        if (status) {
          status.textContent = "Player profile claimet.";
          status.dataset.status = "success";
        }

        window.history.replaceState({}, "", "account.html");

        await loadAccountPage();
      } catch (error) {
        console.error(error);

        acceptButton.disabled = false;
        acceptButton.textContent = "Claim profile";

        if (status) {
          status.textContent =
            error.message || "Kunne ikke claime player profile.";
          status.dataset.status = "error";
        }
      }
    });
  }
}

    async function loadAccountPage() {
      const session = await window.VCLData.getSession();

      if (!session) {
        window.location.href = "login.html";
        return;
      }

      const profile = await window.VCLData.getCurrentProfile();

      if (!profile) {
        setAccountMessage("Kunne ikke hente din account profile.", "error");
        return;
      }

      const displayName = profile.display_name || "VCL Player";
      const discord = profile.discord || "—";
      const email = profile.email || session.user?.email || "—";
      const role = profile.role || "player";

      setOverviewText(overviewPlayerStatus, "Kontrollerer profil...");
      setOverviewText(overviewPlayerMeta, "Henter din spillerstatus.");
      setOverviewText(overviewTeamStatus, "Intet aktivt hold");
      setOverviewText(overviewTeamMeta, "Du er ikke registreret på et VCL-hold endnu.");
      if (overviewTeamLink) {
        overviewTeamLink.href = "teams.html";
        overviewTeamLink.innerHTML = 'Se VCL-hold <span aria-hidden="true">→</span>';
      }

      setText("[data-account-avatar]", displayName.charAt(0).toUpperCase());
      setText("[data-account-name]", displayName);
      setText("[data-account-email]", email);
      setText("[data-account-role]", role);
      setText("[data-account-discord]", discord);
      setText("[data-side-email]", email);
      setText("[data-side-role]", role);
      setText("[data-side-discord]", discord);

      document.title = `${displayName} — VCL Account`;

      await renderAccountQuickAccess(profile);

      if (accountForm) {
        accountForm.display_name.value = profile.display_name || "";
        accountForm.discord.value = profile.discord || "";
      }
            if (window.VCLData.getMyClaimedPlayer) {
        myClaimedPlayer = await window.VCLData.getMyClaimedPlayer();

        if (myClaimedPlayer && playerProfileForm) {
          await loadPlayerAvatarManager(myClaimedPlayer);
          if (noClaimedPlayerBox) {
            noClaimedPlayerBox.hidden = true;
          }
          if (freeAgentForm) {
  freeAgentForm.hidden = true;
}

          playerProfileForm.hidden = false;

          playerProfileForm.discord.value = myClaimedPlayer.discord || "";
          playerProfileForm.primary_role.value = myClaimedPlayer.primary_role || "";
          playerProfileForm.level.value = myClaimedPlayer.level || "";
          playerProfileForm.bio.value = myClaimedPlayer.bio || "";
          playerProfileForm.is_free_agent.checked = Boolean(myClaimedPlayer.is_free_agent);

          const publicProfileLink = document.querySelector("[data-account-public-profile]");

          if (publicProfileLink) {
            publicProfileLink.href = `player-profile.html?player=${encodeURIComponent(myClaimedPlayer.slug)}`;
            publicProfileLink.hidden = false;
          }
          const claimedContext = window.VCLData.getPlayerProfileContext
            ? await window.VCLData.getPlayerProfileContext(myClaimedPlayer.slug)
            : null;
          const publicStats = claimedContext?.player || await window.VCLData.getPlayerBySlug(myClaimedPlayer.slug);
          const claimedLeaderboard = claimedContext?.leaderboardEntry || null;
          const claimedTeam = claimedContext?.team || null;

          setOverviewText(overviewPlayerStatus, publicStats?.alias || myClaimedPlayer.alias || "Forbundet profil");
          setOverviewText(
            overviewPlayerMeta,
            `${publicStats?.primary_role || "Player"} · ${publicStats?.level || "VCL"}${publicStats?.is_free_agent ? " · Free Agent" : ""}`
          );

          if (!myCaptainData?.team && claimedTeam) {
            setOverviewText(overviewTeamStatus, claimedTeam.name || "Aktivt VCL-hold");
            setOverviewText(overviewTeamMeta, "Aktivt roster-medlem");
            if (overviewTeamLink && claimedTeam.slug) {
              overviewTeamLink.href = `team-profile.html?team=${encodeURIComponent(claimedTeam.slug)}`;
              overviewTeamLink.innerHTML = 'Se holdprofil <span aria-hidden="true">→</span>';
            }
          }

if (claimedPlayerSummary && publicStats) {
  claimedPlayerSummary.hidden = false;

  setText(
    "[data-claimed-player-name]",
    publicStats.alias || myClaimedPlayer.alias || "VCL Player"
  );

  setText(
    "[data-claimed-player-meta]",
    `${publicStats.primary_role || "Player"} · ${publicStats.level || "VCL"} · ${
      publicStats.is_free_agent ? "Free Agent" : "Rostered"
    }`
  );

  const claimedTeamName = claimedTeam?.name || publicStats.current_team_name || "";
  const claimedTeamSlug = claimedTeam?.slug || publicStats.current_team_slug || "";
  const claimedTeamLogo = claimedTeam?.logo_url || publicStats.current_team_logo_url || "assets/teams/default-team.png";
  const claimedRank = claimedLeaderboard?.rank ?? claimedLeaderboard?.leaderboard_rank ?? null;
  const claimedPoints = claimedLeaderboard?.points ?? publicStats.points ?? 0;

  setText(
    "[data-claimed-player-team]",
    claimedTeamName || "Free Agent"
  );

  setText(
    "[data-claimed-player-stats]",
    `${claimedPoints} VCL Points · ${claimedRank ? `Leaderboard #${claimedRank} · ` : ""}${publicStats.championship_wins ?? claimedLeaderboard?.championship_wins ?? 0} Championship Wins · ${publicStats.academy_wins ?? claimedLeaderboard?.academy_wins ?? 0} Academy Wins`
  );

  const claimedTeamLink = $("[data-claimed-player-team-link]");
  const claimedTeamLogoElement = $("[data-claimed-player-team-logo]");

  if (claimedTeamLink) {
    claimedTeamLink.href = claimedTeamName && claimedTeamSlug
      ? `team-profile.html?team=${encodeURIComponent(claimedTeamSlug)}`
      : "teams.html";
  }

  if (claimedTeamLogoElement) {
    claimedTeamLogoElement.hidden = !claimedTeamName;
    claimedTeamLogoElement.src = claimedTeamLogo;
    claimedTeamLogoElement.alt = claimedTeamName ? `${claimedTeamName} logo` : "";
    claimedTeamLogoElement.addEventListener("error", () => {
      claimedTeamLogoElement.src = "assets/teams/default-team.png";
    }, { once: true });
  }

  const claimedLink = $("[data-claimed-player-link]");

  if (claimedLink) {
    claimedLink.href = `player-profile.html?player=${encodeURIComponent(myClaimedPlayer.slug)}`;
  }
}
        } else if (playerProfileForm) {
  if (playerAvatarManager) playerAvatarManager.hidden = true;
  const publicProfileLink = document.querySelector("[data-account-public-profile]");
  if (publicProfileLink) publicProfileLink.hidden = true;
  playerProfileForm.hidden = true;

  if (claimedPlayerSummary) {
    claimedPlayerSummary.hidden = true;
  }

  if (noClaimedPlayerBox) {
    noClaimedPlayerBox.hidden = false;
  }

  setOverviewText(overviewPlayerStatus, "Ikke forbundet");
  setOverviewText(overviewPlayerMeta, "Opret eller claim en spillerprofil for at blive synlig i VCL.");

  if (freeAgentForm) {
    freeAgentForm.hidden = false;

    freeAgentForm.alias.value = profile.display_name || "";
    freeAgentForm.discord.value = profile.discord || "";
  }
}
      }

      // Invitations belong to the signed-in account flow, not only to users who
      // already have a claimed player. This is especially important after login
      // with ?claim=, where an existing account may not have a player yet.
      await loadTeamInvites();
      await loadClaimInvite();
    }

    if (playerAvatarInput) {
      playerAvatarInput.addEventListener("change", async () => {
        const file = playerAvatarInput.files?.[0];
        if (!file) return;
        try {
          setPlayerAvatarMessage("Behandler billedet...", "info");
          const blob = await preparePlayerAvatar(file);
          preparedPlayerAvatarBlob = blob;
          revokePreparedPlayerAvatarUrl();
          preparedPlayerAvatarUrl = URL.createObjectURL(blob);
          renderPlayerAvatarPreview(preparedPlayerAvatarUrl, myClaimedPlayer?.alias || "V");
          if (playerAvatarSubmit) playerAvatarSubmit.disabled = false;
          if (playerAvatarFileInfo) {
            playerAvatarFileInfo.textContent = `Klar: 512 × 512 WEBP · ${Math.max(1, Math.round(blob.size / 1024))} KB`;
          }
          setPlayerAvatarMessage("Billedet er kun preview endnu. Send det til admin-godkendelse, når du er tilfreds.", "success");
        } catch (error) {
          preparedPlayerAvatarBlob = null;
          if (playerAvatarSubmit) playerAvatarSubmit.disabled = true;
          setPlayerAvatarMessage(error.message || "Billedet kunne ikke behandles.", "error");
        }
      });
    }

    if (playerAvatarSubmit) {
      playerAvatarSubmit.addEventListener("click", async () => {
        if (!preparedPlayerAvatarBlob) return;
        try {
          playerAvatarSubmit.disabled = true;
          playerAvatarSubmit.textContent = "Uploader...";
          setPlayerAvatarMessage("Uploader sikkert og sender til admin-godkendelse...", "info");
          await window.VCLData.uploadMyPendingPlayerAvatar(preparedPlayerAvatarBlob);
          preparedPlayerAvatarBlob = null;
          revokePreparedPlayerAvatarUrl();
          if (playerAvatarInput) playerAvatarInput.value = "";
          playerAvatarSubmit.textContent = "Send til godkendelse";
          setPlayerAvatarMessage("Profilbilledet er sendt til godkendelse.", "success");
          await loadPlayerAvatarManager(myClaimedPlayer);
        } catch (error) {
          console.error(error);
          playerAvatarSubmit.disabled = false;
          playerAvatarSubmit.textContent = "Send til godkendelse";
          setPlayerAvatarMessage(error.message || "Billedet kunne ikke sendes til godkendelse.", "error");
        }
      });
    }

    if (playerAvatarRemove) {
      playerAvatarRemove.addEventListener("click", async () => {
        const confirmed = window.confirm("Fjern dit nuværende offentlige profilbillede? Du kan altid sende et nyt til godkendelse senere.");
        if (!confirmed) return;
        try {
          playerAvatarRemove.disabled = true;
          setPlayerAvatarMessage("Fjerner profilbilledet...", "info");
          await window.VCLData.removeMyPlayerAvatar();
          setPlayerAvatarMessage("Dit offentlige profilbillede er fjernet.", "success");
          await loadPlayerAvatarManager(myClaimedPlayer);
        } catch (error) {
          console.error(error);
          setPlayerAvatarMessage(error.message || "Profilbilledet kunne ikke fjernes.", "error");
        } finally {
          playerAvatarRemove.disabled = false;
        }
      });
    }

    if (accountForm) {
      accountForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const formData = new FormData(accountForm);

        const updates = {
          display_name: String(formData.get("display_name") || "").trim(),
          discord: String(formData.get("discord") || "").trim()
        };

        if (!updates.display_name) {
          setAccountMessage("Display name må ikke være tomt.", "error");
          return;
        }

        if (window.VCLData?.isProfileUsernameAvailable) {
  const currentProfile = await window.VCLData.getCurrentProfile();

  const usernameAvailable = await window.VCLData.isProfileUsernameAvailable(
    updates.display_name,
    currentProfile?.id || null
  );

  if (!usernameAvailable) {
    setAccountMessage(
      "Det brugernavn er allerede taget. Vælg et andet.",
      "error"
    );
    return;
  }
}

        try {
          setAccountMessage("Gemmer ændringer...", "info");

          await window.VCLData.updateCurrentProfile(updates);

          setAccountMessage("Ændringer gemt.", "success");

          await loadAccountPage();
        } catch (error) {
          console.error(error);
          setAccountMessage(
            error.message || "Kunne ikke gemme ændringer.",
            "error"
          );
        }
      });
    }
    if (playerProfileForm) {
      playerProfileForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const formData = new FormData(playerProfileForm);

        const updates = {
          discord: String(formData.get("discord") || "").trim(),
          primary_role: String(formData.get("primary_role") || "").trim(),
          level: String(formData.get("level") || "").trim(),
          bio: String(formData.get("bio") || "").trim(),
          is_free_agent: Boolean(formData.get("is_free_agent"))
        };

        try {
          if (playerProfileStatus) {
            playerProfileStatus.textContent = "Gemmer public profile...";
            playerProfileStatus.dataset.status = "info";
          }

          await window.VCLData.updateMyClaimedPlayer(updates);

          if (playerProfileStatus) {
            playerProfileStatus.textContent = "Public profile gemt.";
            playerProfileStatus.dataset.status = "success";
          }

          await loadAccountPage();
        } catch (error) {
          console.error(error);

          if (playerProfileStatus) {
            playerProfileStatus.textContent =
              error.message || "Kunne ikke gemme public profile.";
            playerProfileStatus.dataset.status = "error";
          }
        }
      });
    }

    if (freeAgentForm) {
  freeAgentForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(freeAgentForm);

    const profile = {
      alias: String(formData.get("alias") || "").trim(),
      discord: String(formData.get("discord") || "").trim(),
      primary_role: String(formData.get("primary_role") || "").trim(),
      level: String(formData.get("level") || "").trim(),
      bio: String(formData.get("bio") || "").trim()
    };

    if (!profile.alias) {
      if (freeAgentStatus) {
        freeAgentStatus.textContent = "Alias må ikke være tomt.";
        freeAgentStatus.dataset.status = "error";
      }
      return;
    }

    try {
      if (freeAgentStatus) {
        freeAgentStatus.textContent = "Opretter Free Agent profile...";
        freeAgentStatus.dataset.status = "info";
      }

      await window.VCLData.createMyFreeAgentProfile(profile);

      if (freeAgentStatus) {
        freeAgentStatus.textContent = "Free Agent profile oprettet.";
        freeAgentStatus.dataset.status = "success";
      }

      await loadAccountPage();
    } catch (error) {
      console.error(error);

      if (freeAgentStatus) {
        freeAgentStatus.textContent =
          error.message || "Kunne ikke oprette Free Agent profile.";
        freeAgentStatus.dataset.status = "error";
      }
    }
  });
}
    if (logoutButton) {
      logoutButton.addEventListener("click", async () => {
        try {
          await window.VCLData.logoutAccount();
          window.location.href = "login.html";
        } catch (error) {
          console.error(error);
          setAccountMessage("Kunne ikke logge ud.", "error");
        }
      });
    }

    loadAccountPage();
  }
    /* =========================
     AUTH NAV BUTTON
  ========================= */

  if (window.VCLData?.getSession) {
    const authNavButton = document.querySelector(".site-header .nav-actions a.btn");

    async function updateAuthNavButton() {
      if (!authNavButton) return;

      const session = await window.VCLData.getSession();
      const label = authNavButton.querySelector("span");

      if (session) {
        authNavButton.href = "account.html";

        if (label) {
          label.textContent = "Account";
        } else {
          authNavButton.textContent = "Account";
        }
      } else {
        authNavButton.href = "login.html";

        if (label) {
          label.textContent = "Login";
        } else {
          authNavButton.textContent = "Login";
        }
      }
    }

    updateAuthNavButton();

    if (window.VCLData.onAuthChange) {
      window.VCLData.onAuthChange(() => {
        updateAuthNavButton();
      });
    }
  }
    /* =========================
     TEAM DASHBOARD
  ========================= */

  const teamDashboardPage = $("[data-team-dashboard-page]");

  if (teamDashboardPage && window.VCLData) {
    const noCaptainAccess = $("[data-no-captain-access]");
    const captainDashboardSections = $$("[data-captain-dashboard]");
    const teamSettingsForm = $("[data-team-settings-form]");
    const rosterList = $("[data-team-roster-list]");
    const captainTransferForm = $("[data-captain-transfer-form]");
    const captainTransferSelect = captainTransferForm?.querySelector("select");
    const teamSettingsStatus = $("[data-team-settings-status]");
    const captainTransferStatus = $("[data-captain-transfer-status]");
    const teamLogoInput = $("[data-team-logo-input]");
    const teamLogoPickButton = $("[data-team-logo-pick]");
    const teamLogoSaveButton = $("[data-team-logo-save]");
    const teamLogoStatus = $("[data-team-logo-status]");
    const teamLogoEditorPreview = $("[data-team-logo-editor-preview]");
    let rosterSwapForm = null;
    let currentDashboardTeam = null;
    let pendingTeamLogoFile = null;
    let pendingTeamLogoPreviewUrl = "";

    const setTeamText = (selector, value) => {
      const element = $(selector);
      if (element) element.textContent = value;
    };

    const formatTeamStatus = (status = "") => {
      const labels = {
        active: "Aktiv",
        looking: "Søger spillere",
        inactive: "Inaktiv"
      };

      return labels[String(status).toLowerCase()] || status || "—";
    };

    const getTeamLogoUrl = (team = {}) => {
  return team.logo_url || team.logo || "";
};

const renderTeamDashboardLogo = (team = {}, fallbackName = "VCL") => {
  const avatar = $("[data-team-dashboard-avatar]");
  if (!avatar) return;

  const logoUrl = getTeamLogoUrl(team);

  if (logoUrl) {
    avatar.innerHTML = `
      <img
        src="${escapeHTML(logoUrl)}"
        alt="${escapeHTML(fallbackName)} logo"
        loading="lazy"
      >
    `;
    avatar.classList.add("has-team-logo");
    return;
  }

  avatar.classList.remove("has-team-logo");
  avatar.textContent = fallbackName.charAt(0).toUpperCase();
};

const renderTeamLogoEditorPreview = (team = {}, fallbackName = "VCL", overrideUrl = "") => {
  if (!teamLogoEditorPreview) return;

  const logoUrl = overrideUrl || getTeamLogoUrl(team);

  if (logoUrl) {
    teamLogoEditorPreview.innerHTML = `
      <img src="${escapeHTML(logoUrl)}" alt="${escapeHTML(fallbackName)} logo preview">
    `;
    return;
  }

  teamLogoEditorPreview.innerHTML = `<span aria-hidden="true">${escapeHTML(fallbackName.charAt(0).toUpperCase())}</span>`;
};

const clearPendingTeamLogoPreview = () => {
  if (pendingTeamLogoPreviewUrl) {
    URL.revokeObjectURL(pendingTeamLogoPreviewUrl);
    pendingTeamLogoPreviewUrl = "";
  }
};

const validateTeamLogoFile = (file) => {
  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  const maxSize = 2 * 1024 * 1024;

  if (!file) return "Vælg en billedfil først.";
  if (!allowedTypes.includes(file.type)) return "Logo skal være PNG, JPG eller WEBP.";
  if (file.size > maxSize) return "Logo må maks være 2 MB.";
  return "";
};

    const setDashboardMode = (hasAccess) => {
      if (noCaptainAccess) {
        noCaptainAccess.hidden = hasAccess;
      }

      captainDashboardSections.forEach((section) => {
        section.hidden = !hasAccess;
      });
    };

    function ensureRosterSwapForm() {
  if (rosterSwapForm) return rosterSwapForm;
  if (!rosterList) return null;

  rosterSwapForm = document.createElement("form");
  rosterSwapForm.className = "team-dashboard-swap-v2";
  rosterSwapForm.setAttribute("data-roster-swap-form", "");

  rosterSwapForm.innerHTML = `
    <div class="team-dashboard-swap-v2__head">
      <div>
        <span>Lineup swap</span>
        <h3>Byt starter og substitute</h3>
      </div>
      <p>Brug denne handling, når startopstillingen er fuld, og en starter skal byttes direkte med en substitute.</p>
    </div>

    <div class="team-dashboard-swap-v2__grid">
      <label>
        <span>Starter</span>
        <select name="active_member_id" data-swap-active-select>
          <option value="">Vælg starter</option>
        </select>
      </label>

      <label>
        <span>Substitute</span>
        <select name="bench_member_id" data-swap-bench-select>
          <option value="">Vælg substitute</option>
        </select>
      </label>
    </div>

    <div class="team-dashboard-swap-v2__footer">
      <p class="notice" data-roster-swap-status></p>
      <button type="submit">Byt roster-pladser <span aria-hidden="true">→</span></button>
    </div>
  `;

  rosterList.insertAdjacentElement("afterend", rosterSwapForm);

  rosterSwapForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const activeSelect = rosterSwapForm.querySelector("[data-swap-active-select]");
    const benchSelect = rosterSwapForm.querySelector("[data-swap-bench-select]");
    const status = rosterSwapForm.querySelector("[data-roster-swap-status]");
    const submitButton = rosterSwapForm.querySelector('button[type="submit"]');

    const activeMemberId = activeSelect?.value || "";
    const benchMemberId = benchSelect?.value || "";

    if (!activeMemberId || !benchMemberId) {
      if (status) {
        status.textContent = "Vælg både en starter og en substitute.";
        status.dataset.status = "error";
      }
      return;
    }

    try {
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Bytter...";
      }

      if (status) {
        status.textContent = "Bytter roster-pladser...";
        status.dataset.status = "info";
      }

      await window.VCLData.captainSwapRosterMembers(
  activeMemberId,
  benchMemberId
);

if (status) {
  status.textContent = "Roster-pladser byttet.";
  status.dataset.status = "success";
}

await loadTeamDashboard();
    } catch (error) {
      console.error(error);

      if (status) {
        status.textContent =
          error.message || "Kunne ikke bytte roster-pladser.";
        status.dataset.status = "error";
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = 'Byt roster-pladser <span aria-hidden="true">→</span>';
      }
    }
  });

  return rosterSwapForm;
}

function renderRosterSwapForm(members = []) {
  const form = ensureRosterSwapForm();
  if (!form) return;

  const activeSelect = form.querySelector("[data-swap-active-select]");
  const benchSelect = form.querySelector("[data-swap-bench-select]");

  const activeMembers = members.filter((member) => {
    return member.roster_status === "active" && !member.left_at;
  });

  const benchMembers = members.filter((member) => {
    return member.roster_status === "bench" && !member.left_at;
  });

  if (!activeMembers.length || !benchMembers.length) {
    form.hidden = true;
    return;
  }

  form.hidden = false;

  activeSelect.innerHTML = `
    <option value="">Vælg starter</option>
    ${activeMembers
      .map((member) => {
        const player = member.players;
        return `
          <option value="${escapeHTML(member.id)}">
            ${escapeHTML(player?.alias || "Ukendt spiller")}
          </option>
        `;
      })
      .join("")}
  `;

  benchSelect.innerHTML = `
    <option value="">Vælg bench</option>
    ${benchMembers
      .map((member) => {
        const player = member.players;
        return `
          <option value="${escapeHTML(member.id)}">
            ${escapeHTML(player?.alias || "Ukendt spiller")}
          </option>
        `;
      })
      .join("")}
  `;
}

    const buildTeamDashboardClaimLink = (token) => {
      const baseUrl = `${window.location.origin}${window.location.pathname.replace(
        "team-dashboard.html",
        "signup.html"
      )}`;

      return `${baseUrl}?claim=${encodeURIComponent(token)}`;
    };

    const copyTeamDashboardText = async (value) => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }

      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    };

    const renderRoster = (members = [], captainPlayerId = "") => {
      if (!rosterList) return;

      if (!members.length) {
        rosterList.innerHTML = `
          <div class="team-dashboard-empty-v2">
            <strong>Ingen spillere på rosteren</strong>
            <p>Der er endnu ikke registreret spillere på holdet.</p>
          </div>
        `;
        return;
      }

      const sortedMembers = [...members].sort((a, b) => {
        const order = { active: 1, bench: 2 };
        return (order[a.roster_status] || 9) - (order[b.roster_status] || 9);
      });

      rosterList.innerHTML = sortedMembers
        .map((member) => {
          const player = member.players || {};
          const isCaptain =
            member.player_id === captainPlayerId || member.member_role === "captain";
          const isClaimed =
            isCaptain ||
            Boolean(player.claimed_by_profile_id) ||
            player.claim_status === "claimed";
          const rosterStatus = member.roster_status === "active" ? "Starter" : "Substitute";
          const playerId = player.id || member.player_id || "";
          const playerAlias = player.alias || "Ukendt spiller";
          const playerSlug = player.slug || "";

          const claimButton = !isClaimed && playerId
            ? `
                <button
                  type="button"
                  data-create-claim-invite
                  data-player-id="${escapeHTML(playerId)}"
                  data-player-alias="${escapeHTML(playerAlias)}"
                >
                  Lav claim link
                </button>
              `
            : "";

          return `
            <article class="team-dashboard-roster-row-v2">
              <div class="team-dashboard-roster-row-v2__status">
                <strong>${escapeHTML(rosterStatus)}</strong>
                ${isCaptain ? "<span>Captain</span>" : ""}
                <span class="${isClaimed ? "is-claimed" : "is-unclaimed"}">${isClaimed ? "Claimed" : "Unclaimed"}</span>
              </div>

              <div class="team-dashboard-roster-row-v2__player">
                <strong>
                  ${
                    playerSlug
                      ? `<a href="player-profile.html?player=${encodeURIComponent(playerSlug)}">${escapeHTML(playerAlias)}</a>`
                      : escapeHTML(playerAlias)
                  }
                </strong>
                <span>${escapeHTML(player.primary_role || "Player")}</span>
              </div>

              <div class="team-dashboard-roster-row-v2__actions">
                <button
                  type="button"
                  data-remove-roster-member
                  data-team-member-id="${escapeHTML(member.id)}"
                  data-player-alias="${escapeHTML(playerAlias)}"
                  ${isCaptain ? "disabled" : ""}
                >
                  ${isCaptain ? "Captain" : "Fjern spiller"}
                </button>

                ${claimButton}
              </div>

              <div class="team-dashboard-roster-row-v2__feedback">
                <p class="notice" data-roster-action-status="${escapeHTML(member.id)}"></p>
                <p class="notice" data-claim-action-status="${escapeHTML(playerId)}"></p>
              </div>
            </article>
          `;
        })
        .join("");

      $$("[data-remove-roster-member]", rosterList).forEach((button) => {
        button.addEventListener("click", async () => {
          const teamMemberId = button.dataset.teamMemberId;
          const playerAlias = button.dataset.playerAlias || "spilleren";
          const status = rosterList.querySelector(`[data-roster-action-status="${teamMemberId}"]`);

          if (!confirm(`Er du sikker på, at du vil fjerne ${playerAlias} fra rosteret? Spilleren bliver Free Agent igen.`)) {
            return;
          }

          try {
            button.disabled = true;
            button.textContent = "Fjerner...";
            if (status) {
              status.textContent = "Fjerner spiller fra roster...";
              status.dataset.status = "info";
            }

            await window.VCLData.captainRemoveRosterMember(teamMemberId);
            await loadTeamDashboard();
          } catch (error) {
            console.error(error);
            button.disabled = false;
            button.textContent = "Fjern spiller";
            if (status) {
              status.textContent = error.message || "Kunne ikke fjerne spiller.";
              status.dataset.status = "error";
            }
          }
        });
      });

      $$("[data-create-claim-invite]", rosterList).forEach((button) => {
        button.addEventListener("click", async () => {
          const playerId = button.dataset.playerId;
          const playerAlias = button.dataset.playerAlias || "spilleren";
          const status = rosterList.querySelector(`[data-claim-action-status="${playerId}"]`);

          try {
            button.disabled = true;
            button.textContent = "Laver link...";
            if (status) {
              status.textContent = `Laver claim link til ${playerAlias}...`;
              status.dataset.status = "info";
            }

            const invite = await window.VCLData.captainCreateClaimInvite(playerId);
            const claimLink = buildTeamDashboardClaimLink(invite.token);
            await copyTeamDashboardText(claimLink);

            button.textContent = "Link kopieret";
            if (status) {
              status.innerHTML = `Claim link kopieret:<br><a href="${escapeHTML(claimLink)}">${escapeHTML(claimLink)}</a>`;
              status.dataset.status = "success";
            }
          } catch (error) {
            console.error(error);
            button.disabled = false;
            button.textContent = "Lav claim link";
            if (status) {
              status.textContent = error.message || "Kunne ikke lave claim link.";
              status.dataset.status = "error";
            }
          }
        });
      });
    };

    const renderCaptainSelect = (members = [], currentCaptainId = "") => {
      if (!captainTransferSelect) return;

      captainTransferSelect.innerHTML = `
        <option value="">Vælg spiller fra roster</option>
      `;

      members.forEach((member) => {
        const player = member.players;

        if (!player || player.id === currentCaptainId || member.left_at) return;

        const option = document.createElement("option");
        option.value = player.id;
        option.textContent = player.alias || "Ukendt spiller";
        captainTransferSelect.appendChild(option);
      });
    };

    async function loadTeamDashboard() {
      const session = await window.VCLData.getSession();

      if (!session) {
        window.location.href = "login.html";
        return;
      }

      const captainData = await window.VCLData.getMyCaptainTeam();

      if (!captainData) {
        setDashboardMode(false);

        setTeamText("[data-team-dashboard-avatar]", "!");
        setTeamText("[data-team-dashboard-access]", "Ingen captain-adgang");
        setTeamText("[data-team-dashboard-title]", "Ingen captain adgang");
        setTeamText(
          "[data-team-dashboard-description]",
          "Din claimede player profile er ikke registreret som captain for et VCL-team."
        );

        setTeamText("[data-side-team-name]", "—");
        setTeamText("[data-side-captain-name]", "—");
        setTeamText("[data-side-roster-count]", "—");
        setTeamText("[data-side-team-tier]", "—");
        setTeamText("[data-side-team-status]", "Ingen adgang");

        return;
      }

      const { team, captain_player, members } = captainData;

      currentDashboardTeam = team;
      setDashboardMode(true);

      const teamName = team.name || "VCL Team";
      const teamTier = team.tier || "VCL";
      const teamStatus = team.status || "active";
      const captainName = captain_player?.alias || "Captain";

      renderTeamDashboardLogo(team, teamName);
      if (!pendingTeamLogoFile) {
        renderTeamLogoEditorPreview(team, teamName);
      }
      setTeamText("[data-team-dashboard-access]", "Captain-adgang");
      setTeamText("[data-team-dashboard-title]", teamName);
      setTeamText(
        "[data-team-dashboard-description]",
        "Administrér roster, holdoplysninger og captain-adgang ét sted."
      );

      setTeamText("[data-side-team-name]", teamName);
      setTeamText("[data-side-captain-name]", captainName);
      setTeamText("[data-side-roster-count]", `${members.length} spillere`);
      setTeamText("[data-side-team-tier]", teamTier);
      setTeamText("[data-side-team-status]", formatTeamStatus(teamStatus));


      const publicTeamLink = $("[data-public-team-link]");

      if (publicTeamLink) {
        publicTeamLink.href = `team-profile.html?team=${encodeURIComponent(team.slug)}`;
      }

      if (teamSettingsForm) {
  teamSettingsForm.name.value = team.name || "";
  teamSettingsForm.tagline.value = team.tagline || "";
  teamSettingsForm.description.value = team.description || "";
  const statusField = teamSettingsForm.elements.namedItem("status");
  if (statusField) statusField.value = team.status || "active";
}

renderRoster(members, team.captain_player_id);
renderRosterSwapForm(members);
renderCaptainSelect(members, team.captain_player_id);



      document.title = `${teamName} — Team Dashboard`;
    }

    if (teamLogoPickButton && teamLogoInput) {
      teamLogoPickButton.addEventListener("click", () => {
        teamLogoInput.click();
      });

      teamLogoInput.addEventListener("change", () => {
        const file = teamLogoInput.files?.[0] || null;
        const validationError = validateTeamLogoFile(file);

        clearPendingTeamLogoPreview();
        pendingTeamLogoFile = null;

        if (validationError) {
          teamLogoInput.value = "";
          if (teamLogoSaveButton) teamLogoSaveButton.disabled = true;
          if (teamLogoStatus) {
            teamLogoStatus.textContent = validationError;
            teamLogoStatus.dataset.status = "error";
          }
          if (currentDashboardTeam) {
            renderTeamLogoEditorPreview(currentDashboardTeam, currentDashboardTeam.name || "VCL");
          }
          return;
        }

        pendingTeamLogoFile = file;
        pendingTeamLogoPreviewUrl = URL.createObjectURL(file);
        renderTeamLogoEditorPreview(
          currentDashboardTeam || {},
          currentDashboardTeam?.name || "VCL",
          pendingTeamLogoPreviewUrl
        );

        if (teamLogoSaveButton) teamLogoSaveButton.disabled = false;
        if (teamLogoStatus) {
          teamLogoStatus.textContent = "Nyt logo valgt. Gem logoet for at gøre ændringen offentlig.";
          teamLogoStatus.dataset.status = "info";
        }
      });
    }

    if (teamLogoSaveButton) {
      teamLogoSaveButton.addEventListener("click", async () => {
        if (!pendingTeamLogoFile || !currentDashboardTeam) return;

        const file = pendingTeamLogoFile;

        try {
          teamLogoSaveButton.disabled = true;
          if (teamLogoPickButton) teamLogoPickButton.disabled = true;
          if (teamLogoStatus) {
            teamLogoStatus.textContent = "Uploader og opdaterer teamlogo...";
            teamLogoStatus.dataset.status = "info";
          }

          const logoUrl = await window.VCLData.uploadTeamLogo(
            file,
            currentDashboardTeam.name || "team"
          );

          await window.VCLData.updateMyCaptainTeamLogo(logoUrl);

          pendingTeamLogoFile = null;
          teamLogoInput.value = "";
          clearPendingTeamLogoPreview();

          if (teamLogoStatus) {
            teamLogoStatus.textContent = "Teamlogo opdateret. Ændringen er nu offentlig på VCL.";
            teamLogoStatus.dataset.status = "success";
          }

          await loadTeamDashboard();
        } catch (error) {
          console.error(error);
          if (teamLogoStatus) {
            teamLogoStatus.textContent = error.message || "Kunne ikke opdatere teamlogo.";
            teamLogoStatus.dataset.status = "error";
          }
          if (teamLogoSaveButton) teamLogoSaveButton.disabled = false;
        } finally {
          if (teamLogoPickButton) teamLogoPickButton.disabled = false;
        }
      });
    }

    if (teamSettingsForm) {
  teamSettingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(teamSettingsForm);

    const updates = {
      name: String(formData.get("name") || "").trim(),
      tagline: String(formData.get("tagline") || "").trim(),
      description: String(formData.get("description") || "").trim(),
      tier: String(currentDashboardTeam?.tier || "Academy").trim(),
      status: String(formData.get("status") || "active").trim()
    };

    if (!updates.name) {
      if (teamSettingsStatus) {
        teamSettingsStatus.textContent = "Team navn må ikke være tomt.";
        teamSettingsStatus.dataset.status = "error";
      }
      return;
    }

    try {
      if (teamSettingsStatus) {
        teamSettingsStatus.textContent = "Gemmer team info...";
        teamSettingsStatus.dataset.status = "info";
      }

      await window.VCLData.updateMyCaptainTeam(updates);

      if (teamSettingsStatus) {
        teamSettingsStatus.textContent = "Team info gemt.";
        teamSettingsStatus.dataset.status = "success";
      }

      await loadTeamDashboard();
    } catch (error) {
      console.error(error);

      if (teamSettingsStatus) {
        teamSettingsStatus.textContent =
          error.message || "Kunne ikke gemme team info.";
        teamSettingsStatus.dataset.status = "error";
      }
    }
  });
}



    if (captainTransferForm) {
  captainTransferForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(captainTransferForm);
    const newCaptainPlayerId = String(
      formData.get("new_captain_player_id") || ""
    ).trim();

    if (!newCaptainPlayerId) {
      if (captainTransferStatus) {
        captainTransferStatus.textContent = "Vælg en ny captain først.";
        captainTransferStatus.dataset.status = "error";
      }
      return;
    }

    const confirmed = window.confirm(
      "Er du sikker på, at du vil overdrage captain adgang? Du mister selv adgang til team-dashboardet bagefter."
    );

    if (!confirmed) return;

    try {
      if (captainTransferStatus) {
        captainTransferStatus.textContent = "Overdrager captain rolle...";
        captainTransferStatus.dataset.status = "info";
      }

      await window.VCLData.transferMyTeamCaptain(newCaptainPlayerId);

      if (captainTransferStatus) {
        captainTransferStatus.textContent =
          "Captain rolle overdraget. Dashboard opdateres...";
        captainTransferStatus.dataset.status = "success";
      }

      setTimeout(() => {
        loadTeamDashboard();
      }, 800);
    } catch (error) {
      console.error(error);

      if (captainTransferStatus) {
        captainTransferStatus.textContent =
          error.message || "Kunne ikke overdrage captain rolle.";
        captainTransferStatus.dataset.status = "error";
      }
    }
  });
}

    loadTeamDashboard();
  }
    /* =========================
     PUBLIC TEAM PROFILE
  ========================= */

  const teamProfilePage = $("[data-team-profile-page]");

  if (teamProfilePage && window.VCLData?.getTeamProfile) {
    const params = new URLSearchParams(window.location.search);
    const teamSlug = params.get("team") || "";

    const setTeamProfileText = (selector, value) => {
      const element = $(selector);
      if (element) element.textContent = value;
    };

    const formatTeamStatus = (status) => {
      const normalized = String(status || "active").toLowerCase();

      if (normalized === "active") return "Aktiv";
      if (normalized === "inactive") return "Inaktiv";
      if (normalized === "archived") return "Arkiveret";

      return String(status || "Aktiv");
    };

    const formatSeries = (series) => {
      const normalized = String(series || "").toLowerCase();

      if (normalized === "championship") return "Championship";
      if (normalized === "contender") return "Contender";
      if (normalized === "academy") return "Academy";
      return String(series || "VCL");
    };

    const formatAchievementSeries = (series) => {
      const normalized = String(series || "").toLowerCase();

      if (normalized === "championship") return "Championship";
      if (normalized === "contender") return "Contender Series";
      if (normalized === "academy") return "Academy Cup";
      return "VCL";
    };

    const formatAchievementPlacement = (placement) => {
      const numericPlacement = Number(placement);

      if (!numericPlacement) return "Placering ikke angivet";
      return `${numericPlacement}. plads`;
    };

    const formatAchievementDate = (achievement) => {
      const rawDate =
        achievement.event_date ||
        achievement.settled_at ||
        achievement.created_at ||
        "";

      if (!rawDate) return "";

      const date = new Date(rawDate);

      if (Number.isNaN(date.getTime())) return "";

      return new Intl.DateTimeFormat("da-DK", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      }).format(date);
    };

    const getAchievementMark = (placement) => {
      if (Number(placement) === 1) return "01";
      if (Number(placement) === 2) return "02";
      if (Number(placement) === 3) return "03";
      return String(placement || "—").padStart(2, "0");
    };

    const renderRosterPlayer = (member, index, captainId) => {
      const player = member.players || {};
      const alias = player.alias || "Ukendt spiller";
      const slug = player.slug || "";
      const role = player.primary_role || "Player";
      const level = player.level || "VCL";
      const isCaptain =
        member.player_id === captainId || member.member_role === "captain";

      const content = `
        <span class="team-roster-v3__number">${String(index + 1).padStart(2, "0")}</span>
        <span class="team-roster-v3__identity">
          <strong>${escapeHTML(alias)}</strong>
          <small>${escapeHTML(role)} · ${escapeHTML(level)}</small>
        </span>
        ${isCaptain ? '<span class="team-roster-v3__captain">Captain</span>' : ""}
        <span class="team-roster-v3__arrow" aria-hidden="true">↗</span>
      `;

      return slug
        ? `
          <a class="team-roster-v3__player" href="player-profile.html?player=${encodeURIComponent(slug)}">
            ${content}
          </a>
        `
        : `
          <div class="team-roster-v3__player team-roster-v3__player--static">
            ${content}
          </div>
        `;
    };

    const renderRosterGroup = (title, members, captainId, emptyText) => `
      <section class="team-roster-v3__group">
        <header>
          <span>${escapeHTML(title)}</span>
          <strong>${members.length}</strong>
        </header>

        <div class="team-roster-v3__list">
          ${
            members.length
              ? members
                  .map((member, index) =>
                    renderRosterPlayer(member, index, captainId)
                  )
                  .join("")
              : `
                <div class="team-roster-v3__empty">
                  ${escapeHTML(emptyText)}
                </div>
              `
          }
        </div>
      </section>
    `;

    const renderPublicRoster = (members = [], captainId = "") => {
      const roster = $("[data-public-team-roster]");

      if (!roster) return;

      const activeMembers = members
        .filter((member) => member.roster_status !== "bench")
        .sort((a, b) =>
          String(a.players?.alias || "").localeCompare(
            String(b.players?.alias || ""),
            "da"
          )
        );

      const benchMembers = members
        .filter((member) => member.roster_status === "bench")
        .sort((a, b) => {
          const aCaptain =
            a.player_id === captainId || a.member_role === "captain";
          const bCaptain =
            b.player_id === captainId || b.member_role === "captain";

          if (aCaptain && !bCaptain) return -1;
          if (!aCaptain && bCaptain) return 1;

          return String(a.players?.alias || "").localeCompare(
            String(b.players?.alias || ""),
            "da"
          );
        });

      if (!members.length) {
        roster.innerHTML = `
          <div class="team-profile-empty-v3">
            <strong>Ingen aktive spillere</strong>
            <p>Der er endnu ikke registreret en roster på holdet.</p>
          </div>
        `;
        return;
      }

      roster.innerHTML = `
        ${renderRosterGroup(
          "Startopstilling",
          activeMembers,
          captainId,
          "Ingen starters registreret"
        )}
        ${renderRosterGroup(
          "Bænk / substitutes",
          benchMembers,
          captainId,
          "Ingen substitutes registreret"
        )}
      `;
    };

    const renderRosterSnapshot = (snapshot = []) => {
      if (!Array.isArray(snapshot) || !snapshot.length) {
        return `
          <p class="team-result-v3__missing">
            Der findes ikke et roster-snapshot for dette resultat.
          </p>
        `;
      }

      return `
        <div class="team-result-v3__roster" aria-label="Roster ved resultatet">
          ${snapshot
            .map((player) => {
              const slug = player.slug || "";
              const alias = player.alias || "Ukendt spiller";
              const role = player.role || "Player";
              const status =
                String(player.status || "").toLowerCase() === "sub"
                  ? "Sub"
                  : "Starter";

              const content = `
                <strong>${escapeHTML(alias)}</strong>
                <span>${escapeHTML(role)} · ${escapeHTML(status)}</span>
              `;

              return slug
                ? `
                  <a href="player-profile.html?player=${encodeURIComponent(slug)}">
                    ${content}
                  </a>
                `
                : `<span>${content}</span>`;
            })
            .join("")}
        </div>
      `;
    };

    const renderTeamAchievements = (achievements = []) => {
      const results = $("[data-public-team-achievements]");
      const resultCount = $("[data-team-profile-achievement-count]");

      if (resultCount) {
        resultCount.textContent = String(achievements.length);
      }

      const winCount = $("[data-team-profile-win-count]");
      if (winCount) {
        winCount.textContent = String(
          achievements.filter((achievement) => Number(achievement.placement) === 1).length
        );
      }

      if (!results) return;

      if (!achievements.length) {
        results.innerHTML = `
          <div class="team-profile-empty-v3">
            <strong>Ingen registrerede resultater endnu</strong>
            <p>Holdets officielle VCL-placeringer vises her, når de er godkendt.</p>
          </div>
        `;
        return;
      }

      results.innerHTML = achievements
        .map((achievement) => {
          const series = formatAchievementSeries(achievement.series);
          const placement = formatAchievementPlacement(achievement.placement);
          const eventName =
            achievement.event_name ||
            achievement.title ||
            "VCL-turnering";
          const eventDate = formatAchievementDate(achievement);
          const points = Number(achievement.points_per_player || 0);

          return `
            <article class="team-result-v3" data-placement="${escapeHTML(String(achievement.placement || ""))}">
              <div class="team-result-v3__placement">
                <span>${getAchievementMark(achievement.placement)}</span>
                <small>${escapeHTML(placement)}</small>
              </div>

              <div class="team-result-v3__content">
                <div class="team-result-v3__meta">
                  <span>${escapeHTML(series)}</span>
                  ${eventDate ? `<span>${escapeHTML(eventDate)}</span>` : ""}
                  ${
                    points > 0
                      ? `<strong>+${points} VP pr. spiller</strong>`
                      : ""
                  }
                </div>

                <h3>${escapeHTML(eventName)}</h3>

                ${
                  achievement.description
                    ? `<p>${escapeHTML(achievement.description)}</p>`
                    : ""
                }

                ${renderRosterSnapshot(achievement.roster_snapshot)}
              </div>
            </article>
          `;
        })
        .join("");
    };

    async function loadPublicTeamProfile() {
      const teamData = teamSlug
        ? await window.VCLData.getTeamProfile(teamSlug)
        : null;

      if (!teamData) {
        setTeamProfileText("[data-team-profile-tier]", "Ikke fundet");
        setTeamProfileText("[data-team-profile-name]", "Holdet blev ikke fundet");
        setTeamProfileText(
          "[data-team-profile-tagline]",
          "Denne holdprofil findes ikke."
        );
        setTeamProfileText(
          "[data-team-profile-description]",
          "Kontrollér linket, eller gå tilbage til holdoversigten."
        );
        return;
      }

      const { team, members = [], captain } = teamData;

      const teamName = team.name || "VCL Team";
      const tier = formatSeries(team.tier);
      const status = formatTeamStatus(team.status);
      const captainName = captain?.alias || "Ikke angivet";
      const tagline = team.tagline || `${tier}-hold i VCL`;
      const description =
        team.description ||
        "Holdet har endnu ikke skrevet en offentlig beskrivelse.";

      const logo = $("[data-team-profile-logo]");

      if (logo) {
        logo.src = team.logo_url || "assets/teams/default-team.png";
        logo.alt = `${teamName} logo`;
      }

      setTeamProfileText("[data-team-profile-tier]", tier);
      setTeamProfileText("[data-team-profile-name]", teamName);
      setTeamProfileText("[data-team-profile-tagline]", tagline);
      setTeamProfileText("[data-team-profile-description]", description);

      setTeamProfileText("[data-side-team-tier]", tier);
      setTeamProfileText("[data-side-team-status]", status);
      setTeamProfileText("[data-side-team-captain]", captainName);
      setTeamProfileText(
        "[data-team-profile-roster-count]",
        `${members.length} ${members.length === 1 ? "spiller" : "spillere"}`
      );

      renderPublicRoster(members, team.captain_player_id);

      const achievements = window.VCLData.getTeamAchievements
        ? await window.VCLData.getTeamAchievements(team.slug)
        : [];

      renderTeamAchievements(achievements);

      document.title = `${teamName} — VCL Holdprofil`;
    }

    loadPublicTeamProfile();
  }

  /* =========================
     LIVE FREE AGENTS
  ========================= */

  const liveFreeAgentsList = $("[data-live-free-agents]");
  const liveFreeAgentCount = $("[data-free-agent-count]");

  if (liveFreeAgentsList && window.VCLData?.getFreeAgents) {
    async function getCaptainAccess() {
      try {
        const session = await window.VCLData.getSession();

        if (!session) {
          return null;
        }

        return await window.VCLData.getMyCaptainTeam();
      } catch (error) {
        console.warn("Ingen captain adgang fundet:", error);
        return null;
      }
    }

    function renderFreeAgentState(title, description, mark = "VCL") {
      liveFreeAgentsList.innerHTML = `
        <div class="market-player-state market-player-state--v2">
          <div>
            <h3>${escapeHTML(title)}</h3>
            <p>${escapeHTML(description)}</p>
          </div>
        </div>
      `;
    }

    function bindFreeAgentInviteActions() {
      $$('[data-invite-free-agent]').forEach((button) => {
        button.addEventListener('click', async () => {
          const playerId = button.dataset.playerId;
          const playerAlias = button.dataset.playerAlias || 'spilleren';
          const status = $(`[data-invite-status="${playerId}"]`);

          const message = prompt(
            `Skriv en kort besked til ${playerAlias}. Du kan også lade den være tom.`
          );

          if (message === null) return;

          try {
            button.disabled = true;
            button.textContent = 'Sender...';

            if (status) {
              status.textContent = 'Sender invitation...';
              status.dataset.status = 'info';
            }

            await window.VCLData.sendTeamInviteToFreeAgent(playerId, message);
            button.textContent = 'Invitation sendt';

            if (status) {
              status.textContent = `Invitation sendt til ${playerAlias}.`;
              status.dataset.status = 'success';
            }
          } catch (error) {
            console.error(error);
            button.disabled = false;
            button.textContent = 'Invitér spiller';

            if (status) {
              status.textContent = error.message || 'Kunne ikke sende invitationen.';
              status.dataset.status = 'error';
            }
          }
        });
      });
    }

    function renderFreeAgents(freeAgents, captainTeam = null) {
      const visibleFreeAgents = Array.isArray(freeAgents) ? freeAgents : [];

      if (liveFreeAgentCount) {
        liveFreeAgentCount.textContent = String(visibleFreeAgents.length);
      }

      if (!visibleFreeAgents.length) {
        renderFreeAgentState(
          'Ingen aktive Free Agents endnu',
          'Når en spiller gør sin profil synlig fra account-siden, vises den her.',
          '0'
        );
        return;
      }

      liveFreeAgentsList.innerHTML = visibleFreeAgents
        .map((player) => {
          const alias = player.alias || 'Ukendt spiller';
          const role = player.primary_role || 'Player';
          const level = player.level || 'VCL';
          const bio =
            player.bio ||
            'Denne spiller har endnu ikke skrevet en Free Agent-beskrivelse.';
          const initial = alias.trim().charAt(0).toUpperCase() || 'V';
          const profileUrl = `player-profile.html?player=${encodeURIComponent(player.slug)}`;

          const inviteButton = captainTeam
            ? `
              <button
                type="button"
                class="market-player-row__invite"
                data-invite-free-agent
                data-player-id="${escapeHTML(player.id)}"
                data-player-alias="${escapeHTML(alias)}"
              >
                Invitér <span aria-hidden="true">→</span>
              </button>
            `
            : '';

          return `
            <article class="market-player-row">
              <a class="market-player-row__identity" href="${profileUrl}">
                <span class="market-player-row__avatar" aria-hidden="true">${escapeHTML(initial)}${player.avatar_url ? `<img src="${escapeHTML(player.avatar_url)}" alt="" loading="lazy">` : ''}</span>
                <span class="market-player-row__name">
                  <strong>${escapeHTML(alias)}</strong>
                  <small>Aktiv Free Agent</small>
                </span>
              </a>

              <dl class="market-player-row__facts">
                <div>
                  <dt>Rolle</dt>
                  <dd>${escapeHTML(role)}</dd>
                </div>
                <div>
                  <dt>Niveau</dt>
                  <dd>${escapeHTML(level)}</dd>
                </div>
              </dl>

              <div class="market-player-row__bio">
                <span>Kort om spilleren</span>
                <p>${escapeHTML(bio)}</p>
              </div>

              <div class="market-player-row__actions">
                <a href="${profileUrl}">Se profil <span aria-hidden="true">→</span></a>
                ${inviteButton}
              </div>

              <p class="notice market-player-row__status" data-invite-status="${escapeHTML(player.id)}"></p>
            </article>
          `;
        })
        .join('');

      bindFreeAgentInviteActions();
    }

    async function loadLiveFreeAgents() {
      try {
        // Free Agents are the primary content. Do not wait for auth/captain
        // resolution before showing them on slower mobile connections.
        const freeAgents = await window.VCLData.getFreeAgents();
        renderFreeAgents(freeAgents, null);

        getCaptainAccess()
          .then((captainAccess) => {
            const captainTeam = captainAccess?.team || null;
            if (captainTeam) renderFreeAgents(freeAgents, captainTeam);
          })
          .catch((error) => {
            console.warn('Captain tools kunne ikke indlæses:', error);
          });
      } catch (error) {
        console.error('Kunne ikke hente Free Agents:', error);

        if (liveFreeAgentCount) {
          liveFreeAgentCount.textContent = '—';
        }

        renderFreeAgentState(
          'Roster Market kunne ikke indlæses',
          'Genindlæs siden og prøv igen. Hvis fejlen fortsætter, kan Supabase være midlertidigt utilgængelig.',
          '!'
        );
      }
    }

    loadLiveFreeAgents();
  }
   /* =========================
     SIGNUP CLAIM-AWARE HANDLER
  ========================= */

  if (window.location.pathname.includes("signup")) {
    document.addEventListener(
      "submit",
      async (event) => {
        const form = event.target;

        if (!(form instanceof HTMLFormElement)) {
          return;
        }

        const emailInput = form.querySelector('[name="email"]');
        const passwordInput = form.querySelector('[name="password"]');
        const aliasInput = form.querySelector('[name="alias"]');

        // Kun håndter signup-formen
        if (!emailInput || !passwordInput || !aliasInput) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        const formData = new FormData(form);
        const status =
          form.querySelector("[data-signup-status]") ||
          form.querySelector("[data-auth-status]") ||
          form.querySelector(".notice");

        const claimToken = new URLSearchParams(window.location.search).get("claim");

        const signupPayload = {
          email: String(formData.get("email") || "").trim(),
          password: String(formData.get("password") || ""),
          alias: String(formData.get("alias") || "").trim(),
          discord: String(formData.get("discord") || "").trim()
        };

        if (!signupPayload.email || !signupPayload.password || !signupPayload.alias) {
          if (status) {
            status.textContent = "Udfyld email, password og alias.";
            status.dataset.status = "error";
          }
          return;
        }

        if (signupPayload.password.length < 6) {
          if (status) {
            status.textContent = "Password skal være mindst 6 tegn.";
            status.dataset.status = "error";
          }
          return;
        }

        const rulesInput =
          form.querySelector('[name="rules_acceptance"]') ||
          form.querySelector('[name="rules"]') ||
          form.querySelector('[type="checkbox"]');

        if (rulesInput && !rulesInput.checked) {
          if (status) {
            status.textContent = "Du skal acceptere reglerne først.";
            status.dataset.status = "error";
          }
          return;
        }

        try {
          const submitButton = form.querySelector('button[type="submit"]');

          if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = claimToken
              ? "Opretter og claimer..."
              : "Opretter spillerprofil...";
          }

          if (status) {
            status.textContent = claimToken
              ? "Opretter spillerprofil og forbinder profilen..."
              : "Opretter spillerprofil...";
            status.dataset.status = "info";
          }

          const VCLData = await waitForVCLData("signUpAccount");

          if (VCLData.isProfileUsernameAvailable) {
            const usernameAvailable = await VCLData.isProfileUsernameAvailable(
              signupPayload.alias
            );

            if (!usernameAvailable) {
              throw new Error("Det brugernavn er allerede taget. Prøv et andet.");
            }
          }

          await VCLData.signUpAccount(signupPayload);

          if (claimToken && VCLData.acceptClaimInvite) {
            await VCLData.acceptClaimInvite(claimToken);

            if (status) {
              status.textContent = "Spillerprofil oprettet og forbundet.";
              status.dataset.status = "success";
            }

            window.location.href = "account.html";
            return;
          }

          if (status) {
            status.textContent = "Spillerprofil oprettet. Du kan nu logge ind.";
            status.dataset.status = "success";
          }

          window.location.href = "login.html";
        } catch (error) {
          console.error(error);

          const submitButton = form.querySelector('button[type="submit"]');

          if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = `<span>Opret spillerprofil</span><span aria-hidden="true">→</span>`;
          }

          if (status) {
            status.textContent =
              error.message || "Kunne ikke oprette spillerprofil.";
            status.dataset.status = "error";
          }
        }
      },
      true
    );
  }

  /* =========================
     SIGNUP CLAIM PREVIEW / UX
  ========================= */

  const signupClaimPreviewToken = new URLSearchParams(window.location.search).get("claim");

  if (
    window.location.pathname.includes("signup") &&
    signupClaimPreviewToken &&
    window.VCLData?.getClaimInviteByToken
  ) {
    async function renderSignupClaimPreview() {
      let signupClaimBanner = $("[data-signup-claim-section]");

      if (!signupClaimBanner) {
        const signupForm =
          document.querySelector("form") ||
          document.querySelector("[data-signup-form]");

        if (!signupForm) return;

        signupClaimBanner = document.createElement("div");
        signupClaimBanner.className = "auth-claim-banner";
        signupClaimBanner.setAttribute("data-signup-claim-section", "");

        signupClaimBanner.innerHTML = `
          <div class="auth-claim-banner__loading">
            <span>Claim invite</span>
            <strong>Henter claim invite...</strong>
            <p>Vi tjekker linket i Supabase.</p>
          </div>
        `;

        signupForm.parentNode.insertBefore(signupClaimBanner, signupForm);
      }

      signupClaimBanner.hidden = false;
      signupClaimBanner.className = "auth-claim-banner";

      const invite = await window.VCLData.getClaimInviteByToken(signupClaimPreviewToken);

      if (!invite) {
        signupClaimBanner.innerHTML = `
          <span>Invalid claim link</span>
          <strong>Claim link kunne ikke findes</strong>
          <p>Linket er ugyldigt eller findes ikke længere.</p>
        `;
        return;
      }

      const isExpired =
        invite.expires_at && new Date(invite.expires_at) <= new Date();

      if (invite.status !== "pending" || isExpired) {
        signupClaimBanner.innerHTML = `
          <span>${escapeHTML(invite.status || "Unavailable")}</span>
          <strong>${escapeHTML(invite.player_alias || "Player profile")}</strong>
          <p>Dette claim link er ikke længere aktivt.</p>
        `;
        return;
      }

      signupClaimBanner.innerHTML = `
        <span>Claim invite</span>

        <strong>
          Claim ${escapeHTML(invite.player_alias || "player profile")}
        </strong>

        <p>
          Du er inviteret til at claime
          <b>${escapeHTML(invite.player_alias || "denne profil")}</b>
          ${
            invite.team_name
              ? `fra <b>${escapeHTML(invite.team_name)}</b>.`
              : "."
          }
          Opret din spillerprofil herunder, så bliver den koblet automatisk.
        </p>

        ${
          invite.invited_by_player_alias
            ? `<p class="auth-claim-banner__small">Inviteret af ${escapeHTML(invite.invited_by_player_alias)}.</p>`
            : ""
        }

        <div class="auth-claim-banner__actions">
          <a href="login.html?claim=${encodeURIComponent(signupClaimPreviewToken)}">
            Jeg har allerede en konto
          </a>

          <a href="player-profile.html?player=${encodeURIComponent(invite.player_slug || "")}">
            Se profil
          </a>
        </div>
      `;

      const signupButton = document.querySelector('form button[type="submit"]');

      if (signupButton) {
        signupButton.innerHTML = `<span>Opret og forbind profil</span><span aria-hidden="true">→</span>`;
      }
    }

    renderSignupClaimPreview();

    window.addEventListener("load", () => {
      setTimeout(renderSignupClaimPreview, 300);
      setTimeout(renderSignupClaimPreview, 1000);
    });
  }
    /* =========================
     LOGIN CLAIM-AWARE HANDLER
  ========================= */

  if (window.location.pathname.includes("login")) {
    document.addEventListener(
      "submit",
      async (event) => {
        const form = event.target;

        if (!(form instanceof HTMLFormElement)) {
          return;
        }

        const emailInput = form.querySelector('[name="email"]');
        const passwordInput = form.querySelector('[name="password"]');

        if (!emailInput || !passwordInput) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        const formData = new FormData(form);
        const claimToken = new URLSearchParams(window.location.search).get("claim");

        const status =
          form.querySelector("[data-login-status]") ||
          form.querySelector("[data-auth-status]") ||
          form.querySelector(".notice");

        const payload = {
          email: String(formData.get("email") || "").trim(),
          password: String(formData.get("password") || "")
        };

        if (!payload.email || !payload.password) {
          if (status) {
            status.textContent = "Udfyld email og password.";
            status.dataset.status = "error";
          }
          return;
        }

        try {
          const submitButton = form.querySelector('button[type="submit"]');

          if (submitButton) {
            submitButton.disabled = true;
            submitButton.innerHTML = '<span>Logger ind...</span><span aria-hidden="true">→</span>';
          }

          if (status) {
            status.textContent = "Logger ind...";
            status.dataset.status = "info";
          }

          const VCLData = await waitForVCLData("loginAccount");
          await VCLData.loginAccount(payload);

          window.location.href = claimToken
            ? `account.html?claim=${encodeURIComponent(claimToken)}`
            : "account.html";
        } catch (error) {
          console.error(error);

          const submitButton = form.querySelector('button[type="submit"]');

          if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = '<span>Log ind</span><span aria-hidden="true">→</span>';
          }

          if (status) {
            status.textContent = error.message || "Kunne ikke logge ind.";
            status.dataset.status = "error";
          }
        }
      },
      true
    );
  }

    /* =========================
     ADMIN DASHBOARD
  ========================= */

  const adminPage = $(".admin-page");

  if (adminPage && window.VCLData) {
    const adminLoading = $("[data-admin-loading]");
    const adminDenied = $("[data-admin-denied]");
    const adminDashboard = $("[data-admin-dashboard]");

    const adminNewsForm = $("[data-admin-news-form]");
    const adminNewsStatus = $("[data-admin-news-status]");
    const adminNewsList = $("[data-admin-news-list]");
    const adminNewsCount = $("[data-admin-news-count]");
    let cachedAdminNewsPosts = [];

    const adminAvatarList = $("[data-admin-avatar-list]");
    const adminAvatarQueue = $("[data-admin-avatar-queue]");
    const adminUnclaimedList = $("[data-admin-unclaimed-list]");
    const adminUnclaimedCount = $("[data-admin-unclaimed-count]");
    const adminUnclaimedSearch = $("[data-admin-unclaimed-search]");
const adminUnclaimedSearchCount = $("[data-admin-unclaimed-search-count]");
    const adminTeamSignupsList = $("[data-admin-team-signups-list]");
const adminTeamSignupsCount = $("[data-admin-team-signups-count]");
const adminSignupFilters = $$("[data-admin-signup-filter]");
const adminTeamSignupsHistoryCount = $("[data-admin-team-signups-history-count]");
let activeAdminSignupFilter = "pending";
let cachedAdminTeamSignups = [];

    const adminTournamentForm = $("[data-admin-tournament-form]");
    const adminTournamentStatus = $("[data-admin-tournament-status]");
    const adminTournamentReset = $("[data-admin-tournament-reset]");
    const adminTournamentList = $("[data-admin-tournament-list]");
    const adminTournamentManager = $("[data-admin-tournament-manager]");
    const adminManagedTournamentName = $("[data-admin-managed-tournament-name]");
    const adminManagedTournamentMeta = $("[data-admin-managed-tournament-meta]");
    const adminOpenTournament = $("[data-admin-open-tournament]");
    const adminGenerateBracket = $("[data-admin-generate-bracket]");
    const adminTournamentStreamUrl = $("[data-admin-tournament-stream-url]");
    const adminSaveTournamentStream = $("[data-admin-save-tournament-stream]");
    const adminOpenTournamentStream = $("[data-admin-open-tournament-stream]");
    const adminTournamentStreamStatus = $("[data-admin-tournament-stream-status]");
    const adminTournamentManagerStatus = $("[data-admin-tournament-manager-status]");
    const adminTournamentEntries = $("[data-admin-tournament-entries]");
    const adminTournamentMatches = $("[data-admin-tournament-matches]");
    const adminTournamentSettlement = $("[data-admin-tournament-settlement]");
    const adminSettlementPreview = $("[data-admin-settlement-preview]");
    const adminSettlementStatus = $("[data-admin-settlement-status]");
    const adminRefreshSettlement = $("[data-admin-refresh-settlement]");
    const adminFinalizeTournament = $("[data-admin-finalize-tournament]");
    const adminDeleteTournamentDialog = $("[data-admin-delete-tournament-dialog]");
    const adminDeleteTournamentName = $("[data-admin-delete-tournament-name]");
    const adminDeleteTournamentConfirm = $("[data-admin-delete-tournament-confirm]");
    const adminDeleteTournamentStatus = $("[data-admin-delete-tournament-status]");
    const adminDeleteTournamentCancelButtons = $$("[data-admin-delete-tournament-cancel]");
    let cachedAdminTournaments = [];
    let managedAdminTournament = null;
    let pendingAdminTournamentDelete = null;
    let slugWasManuallyEdited = false;

    function buildAdminClaimLink(token) {
      const baseUrl = `${window.location.origin}${window.location.pathname.replace(
        "admin.html",
        "signup.html"
      )}`;

      return `${baseUrl}?claim=${encodeURIComponent(token)}`;
    }

    async function copyAdminText(text) {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }

      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    async function checkAdminAccess() {
      const session = await window.VCLData.getSession();

      if (!session) {
        window.location.href = "login.html";
        return false;
      }

      const profile = await window.VCLData.getCurrentProfile();

      if (!profile || profile.role !== "admin") {
        if (adminLoading) adminLoading.hidden = true;
        if (adminDenied) adminDenied.hidden = false;
        if (adminDashboard) adminDashboard.hidden = true;
        return false;
      }

      if (adminLoading) adminLoading.hidden = true;
      if (adminDenied) adminDenied.hidden = true;
      if (adminDashboard) adminDashboard.hidden = false;

      return true;
    }

    const getTournamentFormValue = (formData, name) => {
      return String(formData.get(name) || "").trim();
    };

    function resetAdminTournamentForm() {
      if (!adminTournamentForm) return;
      adminTournamentForm.reset();
      const idInput = adminTournamentForm.querySelector('[name="tournament_id"]');
      const maxTeamsInput = adminTournamentForm.querySelector('[name="max_teams"]');
      const mapOrderInput = adminTournamentForm.querySelector('[name="map_order"]');
      if (idInput) idInput.value = "";
      if (maxTeamsInput) maxTeamsInput.value = "16";
      if (mapOrderInput) mapOrderInput.value = "HP · SND · OL · HP · SND";
      if (adminTournamentStatus) {
        adminTournamentStatus.textContent = "";
        adminTournamentStatus.dataset.status = "";
      }
      const submitButton = adminTournamentForm.querySelector('button[type="submit"]');
      if (submitButton) submitButton.textContent = "Gem turnering";
    }

    function setAdminTournamentForm(tournament) {
      if (!adminTournamentForm || !tournament) return;

      const setValue = (name, value) => {
        const input = adminTournamentForm.querySelector(`[name="${name}"]`);
        if (input) input.value = value ?? "";
      };

      setValue("tournament_id", tournament.id);
      setValue("name", tournament.name);
      setValue("slug", tournament.slug);
      setValue("series_slug", tournament.series_slug || "academy");
      setValue("status", tournament.status || "draft");
      setValue("starts_at", toDateTimeLocalValue(tournament.starts_at));
      setValue("signup_closes_at", toDateTimeLocalValue(tournament.signup_closes_at));
      setValue("checkin_opens_at", toDateTimeLocalValue(tournament.checkin_opens_at));
      setValue("checkin_closes_at", toDateTimeLocalValue(tournament.checkin_closes_at));
      setValue("max_teams", Number(tournament.max_teams || 16));
      setValue("map_order", tournament.map_order || "HP · SND · OL · HP · SND");
      setValue("description", tournament.description || "");
      setValue("rules_url", tournament.rules_url || "");

      const submitButton = adminTournamentForm.querySelector('button[type="submit"]');
      if (submitButton) submitButton.textContent = "Opdater turnering";

      adminTournamentForm.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function closeAdminTournamentDeleteDialog() {
      pendingAdminTournamentDelete = null;
      if (adminDeleteTournamentDialog) adminDeleteTournamentDialog.hidden = true;
      if (adminDeleteTournamentStatus) {
        adminDeleteTournamentStatus.textContent = "";
        adminDeleteTournamentStatus.dataset.status = "";
      }
      if (adminDeleteTournamentConfirm) {
        adminDeleteTournamentConfirm.disabled = false;
        adminDeleteTournamentConfirm.textContent = "Slet turnering";
      }
      document.body.classList.remove("has-admin-dialog");
    }

    function openAdminTournamentDeleteDialog(tournament) {
      if (!adminDeleteTournamentDialog || !tournament) return;
      pendingAdminTournamentDelete = tournament;
      if (adminDeleteTournamentName) {
        adminDeleteTournamentName.textContent = tournament.name || "Turneringen";
      }
      adminDeleteTournamentDialog.hidden = false;
      document.body.classList.add("has-admin-dialog");
      adminDeleteTournamentConfirm?.focus();
    }

    function renderAdminTournamentList() {
      if (!adminTournamentList) return;

      if (!cachedAdminTournaments.length) {
        adminTournamentList.innerHTML = `
          <article>
            <span>Empty</span>
            <strong>Ingen turneringer endnu</strong>
            <p>Opret den første turnering i formularen.</p>
          </article>
        `;
        return;
      }

      adminTournamentList.innerHTML = cachedAdminTournaments
        .map((tournament) => {
          return `
            <article class="admin-tournament-card admin-tournament-card--${escapeHTML(tournament.status || "draft")}">
              <div>
                <span>
                  ${escapeHTML(tournamentSeriesLabel(tournament.series_slug))}
                  · ${escapeHTML(tournamentStatusLabel(tournament.status))}
                </span>
                <strong>${escapeHTML(tournament.name || "VCL turnering")}</strong>
                <p>
                  Start: ${escapeHTML(formatVCLDateTime(tournament.starts_at))}
                  · Maks. ${Number(tournament.max_teams || 0)} hold
                </p>
              </div>
              <div class="admin-list-card__actions">
                <button type="button" data-admin-edit-tournament="${escapeHTML(tournament.id)}">Rediger</button>
                <button type="button" data-admin-manage-tournament="${escapeHTML(tournament.id)}">Administrer</button>
                ${
                  tournament.status !== "draft"
                    ? `<a href="turnering.html?tournament=${encodeURIComponent(tournament.slug || "")}" target="_blank" rel="noopener">Se side</a>`
                    : ""
                }
                <button type="button" class="admin-tournament-delete-button" data-admin-delete-tournament="${escapeHTML(tournament.id)}">Slet</button>
              </div>
            </article>
          `;
        })
        .join("");

      $$("[data-admin-edit-tournament]", adminTournamentList).forEach((button) => {
        button.addEventListener("click", () => {
          const tournament = cachedAdminTournaments.find(
            (item) => String(item.id) === String(button.dataset.adminEditTournament)
          );
          if (tournament) setAdminTournamentForm(tournament);
        });
      });

      $$("[data-admin-manage-tournament]", adminTournamentList).forEach((button) => {
        button.addEventListener("click", () => {
          loadAdminTournamentManager(button.dataset.adminManageTournament);
        });
      });

      $$("[data-admin-delete-tournament]", adminTournamentList).forEach((button) => {
        button.addEventListener("click", () => {
          const tournament = cachedAdminTournaments.find(
            (item) => String(item.id) === String(button.dataset.adminDeleteTournament)
          );
          if (tournament) openAdminTournamentDeleteDialog(tournament);
        });
      });
    }

    async function loadAdminTournaments() {
      if (!adminTournamentList || !window.VCLData.getAdminTournaments) return;

      try {
        cachedAdminTournaments = await window.VCLData.getAdminTournaments();
        renderAdminTournamentList();
      } catch (error) {
        console.error(error);
        adminTournamentList.innerHTML = `
          <article class="admin-setup-required">
            <span>Fejl</span>
            <strong>Turneringerne kunne ikke hentes</strong>
            <p>Prøv igen om et øjeblik. Hvis fejlen fortsætter, kontrollér forbindelsen til VCL-databasen.</p>
          </article>
        `;
      }
    }

    function renderAdminTournamentEntries(entries) {
      if (!adminTournamentEntries) return;

      if (!entries.length) {
        adminTournamentEntries.innerHTML = `
          <div class="tournament-empty-state">
            <strong>Ingen holdtilmeldinger endnu</strong>
            <p>Nye hold og eksisterende captains bliver vist her, når de sender en anmodning.</p>
          </div>
        `;
        return;
      }

      adminTournamentEntries.innerHTML = entries
        .map((entry, index) => {
          const team = entry.teams || {};
          const name = team.name || entry.team_name_snapshot || "Ukendt hold";
          const logo = team.logo_url || entry.logo_url_snapshot || "assets/teams/default-team.png";
          const isPending = entry.status === "pending";
          const isRejected = entry.status === "rejected";
          const statusLabels = {
            pending: "Afventer godkendelse",
            approved: "Godkendt",
            checked_in: "Checket ind",
            rejected: "Afvist",
            withdrawn: "Trukket",
            disqualified: "Diskvalificeret"
          };

          return `
            <article class="admin-tournament-entry-card admin-tournament-entry-card--${escapeHTML(entry.status || "pending")}" data-entry-id="${escapeHTML(entry.id)}">
              <div class="admin-tournament-entry-card__team">
                <img src="${escapeHTML(logo)}" alt="">
                <div>
                  <strong>${escapeHTML(name)}</strong>
                  <span>${escapeHTML(statusLabels[entry.status] || entry.status || "Ukendt status")}${entry.signup_id ? " · Nyt hold" : " · Eksisterende VCL-hold"}</span>
                  ${entry.admin_note ? `<small>${escapeHTML(entry.admin_note)}</small>` : ""}
                </div>
              </div>
              <label>
                <span>Seed</span>
                <input type="number" min="1" max="64" value="${entry.seed ?? index + 1}" data-entry-seed ${isPending || isRejected ? "disabled" : ""}>
              </label>
              <label>
                <span>Status</span>
                <select data-entry-status ${isPending ? "disabled" : ""}>
                  <option value="pending" ${entry.status === "pending" ? "selected" : ""}>Afventer</option>
                  <option value="approved" ${entry.status === "approved" ? "selected" : ""}>Godkendt</option>
                  <option value="checked_in" ${entry.status === "checked_in" ? "selected" : ""}>Checket ind</option>
                  <option value="rejected" ${entry.status === "rejected" ? "selected" : ""}>Afvist</option>
                  <option value="withdrawn" ${entry.status === "withdrawn" ? "selected" : ""}>Trukket</option>
                  <option value="disqualified" ${entry.status === "disqualified" ? "selected" : ""}>Diskvalificeret</option>
                </select>
              </label>
              <div class="admin-tournament-entry-card__actions">
                ${
                  isPending
                    ? `
                      <button type="button" data-approve-tournament-entry>Godkend</button>
                      <button type="button" data-reject-tournament-entry>Afvis</button>
                    `
                    : `<button type="button" data-save-tournament-entry>Gem</button>`
                }
              </div>
              <p class="notice" data-entry-status-message></p>
            </article>
          `;
        })
        .join("");

      $$('[data-approve-tournament-entry]', adminTournamentEntries).forEach((button) => {
        button.addEventListener('click', async () => {
          const card = button.closest('[data-entry-id]');
          const entryId = card?.dataset.entryId;
          const statusMessage = card?.querySelector('[data-entry-status-message]');
          if (!entryId) return;

          if (!confirm('Godkend dette hold til turneringen?')) return;

          try {
            button.disabled = true;
            if (statusMessage) {
              statusMessage.textContent = 'Godkender holdet...';
              statusMessage.dataset.status = 'info';
            }

            await window.VCLData.reviewTournamentEntry(entryId, 'approved');
            await loadAdminTournamentManager(managedAdminTournament.id, false);
          } catch (error) {
            console.error(error);
            button.disabled = false;
            if (statusMessage) {
              statusMessage.textContent = error.message || 'Kunne ikke godkende holdet.';
              statusMessage.dataset.status = 'error';
            }
          }
        });
      });

      $$('[data-reject-tournament-entry]', adminTournamentEntries).forEach((button) => {
        button.addEventListener('click', async () => {
          const card = button.closest('[data-entry-id]');
          const entryId = card?.dataset.entryId;
          const statusMessage = card?.querySelector('[data-entry-status-message]');
          if (!entryId) return;

          const note = prompt('Skriv eventuelt en kort årsag til afvisningen.');
          if (note === null) return;

          try {
            button.disabled = true;
            if (statusMessage) {
              statusMessage.textContent = 'Afviser tilmeldingen...';
              statusMessage.dataset.status = 'info';
            }

            await window.VCLData.reviewTournamentEntry(entryId, 'rejected', note);
            await loadAdminTournamentManager(managedAdminTournament.id, false);
          } catch (error) {
            console.error(error);
            button.disabled = false;
            if (statusMessage) {
              statusMessage.textContent = error.message || 'Kunne ikke afvise tilmeldingen.';
              statusMessage.dataset.status = 'error';
            }
          }
        });
      });

      $$('[data-save-tournament-entry]', adminTournamentEntries).forEach((button) => {
        button.addEventListener('click', async () => {
          const card = button.closest('[data-entry-id]');
          const entryId = card?.dataset.entryId;
          const seed = Number(card?.querySelector('[data-entry-seed]')?.value || 0) || null;
          const statusValue = card?.querySelector('[data-entry-status]')?.value || 'approved';
          const statusMessage = card?.querySelector('[data-entry-status-message]');

          if (!entryId) return;

          try {
            button.disabled = true;
            if (statusMessage) {
              statusMessage.textContent = 'Gemmer hold...';
              statusMessage.dataset.status = 'info';
            }

            await window.VCLData.updateTournamentEntry(entryId, {
              seed,
              status: statusValue,
              checked_in_at: statusValue === 'checked_in' ? new Date().toISOString() : null
            });

            if (statusMessage) {
              statusMessage.textContent = 'Holdet er opdateret.';
              statusMessage.dataset.status = 'success';
            }
          } catch (error) {
            console.error(error);
            if (statusMessage) {
              statusMessage.textContent = error.message || 'Kunne ikke opdatere holdet.';
              statusMessage.dataset.status = 'error';
            }
          } finally {
            button.disabled = false;
          }
        });
      });
    }

    function renderAdminTournamentMatches(matches) {
      if (!adminTournamentMatches) return;

      if (!matches.length) {
        adminTournamentMatches.innerHTML = `
          <div class="tournament-empty-state">
            <strong>Ingen bracket endnu</strong>
            <p>Kontrollér seeds og tryk derefter på “Generér bracket”.</p>
          </div>
        `;
        return;
      }

      adminTournamentMatches.innerHTML = matches
        .map((match) => {
          const teamAName = match.team_a_name || "TBD";
          const teamBName = match.team_b_name || "TBD";
          const isCompleted = match.status === "completed" && match.winner_team_id;
          const winnerName = String(match.winner_team_id || "") === String(match.team_a_id || "")
            ? teamAName
            : String(match.winner_team_id || "") === String(match.team_b_id || "")
              ? teamBName
              : "";

          const winnerButton = (teamId, teamName, side) => {
            if (!teamId) return "";
            const selected = String(match.winner_team_id || "") === String(teamId);
            return `
              <button
                type="button"
                class="admin-match-winner-button${selected ? " is-selected" : ""}"
                data-complete-tournament-match
                data-winner-team-id="${escapeHTML(teamId)}"
                data-winner-side="${side}"
              >
                <span>${selected ? "Vinder" : "Afslut med"}</span>
                <strong>${escapeHTML(teamName)}</strong>
              </button>
            `;
          };

          return `
            <article class="admin-tournament-match-card${isCompleted ? " is-completed" : ""}" data-match-id="${escapeHTML(match.id)}">
              <div class="admin-tournament-match-card__head">
                <span>${escapeHTML(match.round_label || `Runde ${match.round_number}`)} · Kamp ${Number(match.match_number)}</span>
                <strong>${escapeHTML(teamAName)} vs. ${escapeHTML(teamBName)}</strong>
                ${isCompleted ? `<small>Afsluttet · ${escapeHTML(winnerName)} er vinder</small>` : ""}
              </div>

              <div class="admin-tournament-match-card__scores">
                <label>
                  <span>${escapeHTML(teamAName)}</span>
                  <input type="number" min="0" value="${match.team_a_score ?? ""}" data-match-score-a>
                </label>
                <label>
                  <span>${escapeHTML(teamBName)}</span>
                  <input type="number" min="0" value="${match.team_b_score ?? ""}" data-match-score-b>
                </label>
              </div>

              <div class="admin-match-winner-actions" aria-label="Vælg kampvinder">
                ${winnerButton(match.team_a_id, teamAName, "a")}
                ${winnerButton(match.team_b_id, teamBName, "b")}
              </div>

              <div class="admin-tournament-match-card__settings">
                <label>
                  <span>Status</span>
                  <select data-match-status>
                    <option value="scheduled" ${match.status === "scheduled" ? "selected" : ""}>Planlagt</option>
                    <option value="ready" ${match.status === "ready" ? "selected" : ""}>Klar</option>
                    <option value="live" ${match.status === "live" ? "selected" : ""}>Live</option>
                    ${match.status === "completed" ? '<option value="completed" selected>Afsluttet</option>' : ''}
                    <option value="cancelled" ${match.status === "cancelled" ? "selected" : ""}>Annulleret</option>
                  </select>
                </label>

                <label>
                  <span>Starttid</span>
                  <input type="datetime-local" value="${escapeHTML(toDateTimeLocalValue(match.scheduled_at))}" data-match-scheduled>
                </label>
              </div>

              <label>
                <span>Twitch-link</span>
                <input type="url" value="${escapeHTML(match.twitch_url || "")}" placeholder="https://twitch.tv/..." data-match-twitch>
              </label>

              <button type="button" data-save-tournament-match>Gem score, status og stream</button>
              <p class="notice" data-match-status-message></p>
            </article>
          `;
        })
        .join("");

      $$('[data-complete-tournament-match]', adminTournamentMatches).forEach((button) => {
        button.addEventListener('click', async () => {
          const card = button.closest('[data-match-id]');
          const matchId = card?.dataset.matchId;
          const winnerTeamId = button.dataset.winnerTeamId;
          const winnerName = button.querySelector('strong')?.textContent?.trim() || 'holdet';
          const statusMessage = card?.querySelector('[data-match-status-message]');
          if (!matchId || !winnerTeamId) return;

          const scoreAValue = card.querySelector('[data-match-score-a]')?.value;
          const scoreBValue = card.querySelector('[data-match-score-b]')?.value;
          const scoreA = scoreAValue === '' ? null : Number(scoreAValue);
          const scoreB = scoreBValue === '' ? null : Number(scoreBValue);

          if (!confirm(`Afslut kampen med ${winnerName} som vinder? Vinderen bliver sendt videre i bracketen.`)) {
            return;
          }

          try {
            $$('[data-complete-tournament-match]', card).forEach((item) => { item.disabled = true; });
            if (statusMessage) {
              statusMessage.textContent = `Afslutter kampen med ${winnerName} som vinder...`;
              statusMessage.dataset.status = 'info';
            }

            await window.VCLData.completeTournamentMatch({
              matchId,
              winnerTeamId,
              teamAScore: scoreA,
              teamBScore: scoreB,
              scheduledAt: toISOStringOrNull(card.querySelector('[data-match-scheduled]')?.value),
              twitchUrl: String(card.querySelector('[data-match-twitch]')?.value || '').trim() || null
            });

            if (managedAdminTournament) {
              await loadAdminTournamentManager(managedAdminTournament.id, false);
            }
          } catch (error) {
            console.error(error);
            $$('[data-complete-tournament-match]', card).forEach((item) => { item.disabled = false; });
            if (statusMessage) {
              statusMessage.textContent = error.message || 'Kunne ikke afslutte kampen.';
              statusMessage.dataset.status = 'error';
            }
          }
        });
      });

      $$('[data-save-tournament-match]', adminTournamentMatches).forEach((button) => {
        button.addEventListener('click', async () => {
          const card = button.closest('[data-match-id]');
          const matchId = card?.dataset.matchId;
          const statusMessage = card?.querySelector('[data-match-status-message]');
          if (!matchId) return;

          const scoreAValue = card.querySelector('[data-match-score-a]')?.value;
          const scoreBValue = card.querySelector('[data-match-score-b]')?.value;
          const updates = {
            team_a_score: scoreAValue === '' ? null : Number(scoreAValue),
            team_b_score: scoreBValue === '' ? null : Number(scoreBValue),
            status: card.querySelector('[data-match-status]')?.value || 'scheduled',
            scheduled_at: toISOStringOrNull(card.querySelector('[data-match-scheduled]')?.value),
            twitch_url: String(card.querySelector('[data-match-twitch]')?.value || '').trim() || null
          };

          try {
            button.disabled = true;
            if (statusMessage) {
              statusMessage.textContent = 'Gemmer kampdata...';
              statusMessage.dataset.status = 'info';
            }

            await window.VCLData.updateTournamentMatch(matchId, updates);
            if (managedAdminTournament) {
              await loadAdminTournamentManager(managedAdminTournament.id, false);
            }
          } catch (error) {
            console.error(error);
            if (statusMessage) {
              statusMessage.textContent = error.message || 'Kunne ikke opdatere kampen.';
              statusMessage.dataset.status = 'error';
            }
          } finally {
            button.disabled = false;
          }
        });
      });
    }

    function renderAdminTournamentSettlement(preview) {
      if (!adminSettlementPreview || !adminFinalizeTournament) return;

      if (!preview) {
        adminSettlementPreview.innerHTML = `
          <div class="tournament-empty-state">
            <strong>Preview kunne ikke beregnes</strong>
            <p>Kontrollér turneringsdataene og prøv igen.</p>
          </div>
        `;
        adminFinalizeTournament.disabled = true;
        return;
      }

      const standings = Array.isArray(preview.standings) ? preview.standings : [];
      const issues = Array.isArray(preview.issues) ? preview.issues : [];

      if (preview.settled_at) {
        adminSettlementPreview.innerHTML = `
          <div class="admin-settlement-complete">
            <span>Afregnet</span>
            <strong>Turneringen er afsluttet</strong>
            <p>Placeringer og points blev låst ${escapeHTML(formatVCLDateTime(preview.settled_at))}.</p>
          </div>
        `;
        adminFinalizeTournament.disabled = true;
        adminFinalizeTournament.textContent = 'Turneringen er afregnet';
        return;
      }

      adminFinalizeTournament.textContent = 'Afslut turnering og uddel points';
      adminFinalizeTournament.disabled = !preview.ready;

      const issueHtml = issues.length
        ? `<div class="admin-settlement-issues">${issues.map((issue) => `<p>${escapeHTML(issue)}</p>`).join('')}</div>`
        : '';

      const standingsHtml = standings.length
        ? `<div class="admin-settlement-standings">${standings.map((team) => {
            const players = Array.isArray(team.players) ? team.players : [];
            return `
              <article class="admin-settlement-team${Number(team.placement) === 1 ? ' is-winner' : ''}">
                <span class="admin-settlement-team__place">#${Number(team.placement)}</span>
                <img src="${escapeHTML(team.logo_url || 'assets/teams/default-team.png')}" alt="">
                <div>
                  <strong>${escapeHTML(team.team_name || 'Ukendt hold')}</strong>
                  <span>${players.length} spillere · ${Number(team.points_per_player || 0)} VP pr. spiller</span>
                  <small>${players.map((player) => `${escapeHTML(player.alias || 'Ukendt')} +${Number(player.points || 0)}`).join(' · ')}</small>
                </div>
              </article>
            `;
          }).join('')}</div>`
        : `<div class="tournament-empty-state"><strong>Ingen placeringer endnu</strong><p>Afslut finalen for at beregne standings.</p></div>`;

      adminSettlementPreview.innerHTML = issueHtml + standingsHtml;
    }

    async function loadAdminTournamentSettlement(tournamentId) {
      if (!adminTournamentSettlement || !window.VCLData.getTournamentSettlementPreview) return;

      try {
        if (adminSettlementStatus) {
          adminSettlementStatus.textContent = 'Beregner placeringer og point...';
          adminSettlementStatus.dataset.status = 'info';
        }
        const preview = await window.VCLData.getTournamentSettlementPreview(tournamentId);
        renderAdminTournamentSettlement(preview);
        if (adminSettlementStatus) {
          adminSettlementStatus.textContent = preview?.ready
            ? 'Previewet er klar. Kontrollér alle hold og spillere før endelig afregning.'
            : 'Turneringen er endnu ikke klar til afregning.';
          adminSettlementStatus.dataset.status = preview?.ready ? 'success' : 'info';
        }
      } catch (error) {
        console.error(error);
        renderAdminTournamentSettlement(null);
        if (adminSettlementStatus) {
          adminSettlementStatus.textContent = error.message || 'Kunne ikke beregne point-preview.';
          adminSettlementStatus.dataset.status = 'error';
        }
      }
    }

    async function loadAdminTournamentManager(tournamentId, scroll = true) {
      const tournament = cachedAdminTournaments.find(
        (item) => String(item.id) === String(tournamentId)
      );

      if (!tournament || !adminTournamentManager) return;
      managedAdminTournament = tournament;
      adminTournamentManager.hidden = false;

      if (adminManagedTournamentName) adminManagedTournamentName.textContent = tournament.name;
      if (adminManagedTournamentMeta) {
        adminManagedTournamentMeta.textContent = `${tournamentStatusLabel(tournament.status)} · ${formatVCLDateTime(tournament.starts_at)}`;
      }
      if (adminOpenTournament) {
        adminOpenTournament.href = `turnering.html?tournament=${encodeURIComponent(tournament.slug || "")}`;
      }
      if (adminTournamentStreamUrl) {
        adminTournamentStreamUrl.value = tournament.stream_url || "";
      }
      if (adminOpenTournamentStream) {
        const hasStream = Boolean(tournament.stream_url);
        adminOpenTournamentStream.hidden = !hasStream;
        adminOpenTournamentStream.href = hasStream ? tournament.stream_url : "#";
      }
      if (adminTournamentStreamStatus) {
        adminTournamentStreamStatus.textContent = tournament.stream_url
          ? "Streamlink er gemt på turneringen."
          : "Ingen livestream er tilknyttet endnu.";
        adminTournamentStreamStatus.dataset.status = tournament.stream_url ? "success" : "info";
      }
      if (adminTournamentManagerStatus) {
        adminTournamentManagerStatus.textContent = "Henter hold og kampe...";
        adminTournamentManagerStatus.dataset.status = "info";
      }

      try {
        const [entries, matches] = await Promise.all([
          window.VCLData.getAdminTournamentEntries(tournament.id),
          window.VCLData.getAdminTournamentMatches(tournament.id)
        ]);

        renderAdminTournamentEntries(entries);
        renderAdminTournamentMatches(matches);
        await loadAdminTournamentSettlement(tournament.id);

        if (adminTournamentManagerStatus) {
          const approvedCount = entries.filter((entry) =>
            ["approved", "checked_in"].includes(entry.status)
          ).length;
          const pendingCount = entries.filter((entry) => entry.status === "pending").length;
          adminTournamentManagerStatus.textContent = `${approvedCount} godkendte hold · ${pendingCount} afventer · ${matches.length} kampe`;
          adminTournamentManagerStatus.dataset.status = "success";
        }
      } catch (error) {
        console.error(error);
        if (adminTournamentManagerStatus) {
          adminTournamentManagerStatus.textContent = error.message || "Kunne ikke hente turneringen.";
          adminTournamentManagerStatus.dataset.status = "error";
        }
      }

      if (scroll) {
        adminTournamentManager.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    adminSaveTournamentStream?.addEventListener("click", async () => {
      if (!managedAdminTournament) return;

      const streamUrl = String(adminTournamentStreamUrl?.value || "").trim();

      try {
        adminSaveTournamentStream.disabled = true;
        adminSaveTournamentStream.textContent = "Gemmer...";
        if (adminTournamentStreamStatus) {
          adminTournamentStreamStatus.textContent = streamUrl
            ? "Gemmer livestream på turneringen..."
            : "Fjerner livestream fra turneringen...";
          adminTournamentStreamStatus.dataset.status = "info";
        }

        const updated = await window.VCLData.updateTournament(managedAdminTournament.id, {
          stream_url: streamUrl || null
        });

        managedAdminTournament = {
          ...managedAdminTournament,
          ...(updated || {}),
          stream_url: updated?.stream_url ?? (streamUrl || null)
        };

        cachedAdminTournaments = cachedAdminTournaments.map((tournament) =>
          String(tournament.id) === String(managedAdminTournament.id)
            ? { ...tournament, ...managedAdminTournament }
            : tournament
        );

        renderAdminTournamentList();

        if (adminOpenTournamentStream) {
          adminOpenTournamentStream.hidden = !streamUrl;
          adminOpenTournamentStream.href = streamUrl || "#";
        }

        if (adminTournamentStreamStatus) {
          adminTournamentStreamStatus.textContent = streamUrl
            ? "Livestream er gemt. LIVE-bjælken og turneringssiden bruger linket, når eventet er Live."
            : "Livestream-linket er fjernet.";
          adminTournamentStreamStatus.dataset.status = "success";
        }
      } catch (error) {
        console.error(error);
        if (adminTournamentStreamStatus) {
          adminTournamentStreamStatus.textContent = error.message || "Kunne ikke gemme livestream-linket.";
          adminTournamentStreamStatus.dataset.status = "error";
        }
      } finally {
        adminSaveTournamentStream.disabled = false;
        adminSaveTournamentStream.textContent = "Gem stream";
      }
    });

    adminRefreshSettlement?.addEventListener('click', async () => {
      if (!managedAdminTournament) return;
      adminRefreshSettlement.disabled = true;
      try {
        await loadAdminTournamentSettlement(managedAdminTournament.id);
      } finally {
        adminRefreshSettlement.disabled = false;
      }
    });

    adminFinalizeTournament?.addEventListener('click', async () => {
      if (!managedAdminTournament || adminFinalizeTournament.disabled) return;

      const confirmed = confirm(
        `Afslut ${managedAdminTournament.name} permanent? Placeringer og points skrives til spillerne og kan ikke afregnes igen.`
      );
      if (!confirmed) return;

      try {
        adminFinalizeTournament.disabled = true;
        adminFinalizeTournament.textContent = 'Afregner turnering...';
        if (adminSettlementStatus) {
          adminSettlementStatus.textContent = 'Skriver resultater og points til Supabase...';
          adminSettlementStatus.dataset.status = 'info';
        }

        const result = await window.VCLData.finalizeTournament(managedAdminTournament.id);
        if (adminSettlementStatus) {
          adminSettlementStatus.textContent = `${result?.players_processed || 0} spillere fik i alt ${result?.points_awarded_total || 0} VCL Points.`;
          adminSettlementStatus.dataset.status = 'success';
        }

        await loadAdminTournaments();
        await loadAdminTournamentManager(managedAdminTournament.id, false);
      } catch (error) {
        console.error(error);
        adminFinalizeTournament.disabled = false;
        adminFinalizeTournament.textContent = 'Afslut turnering og uddel points';
        if (adminSettlementStatus) {
          adminSettlementStatus.textContent = error.message || 'Kunne ikke afslutte turneringen.';
          adminSettlementStatus.dataset.status = 'error';
        }
      }
    });

    if (adminTournamentForm) {
      const nameInput = adminTournamentForm.querySelector('[name="name"]');
      const slugInput = adminTournamentForm.querySelector('[name="slug"]');
      slugInput?.addEventListener("input", () => {
        slugWasManuallyEdited = Boolean(slugInput.value.trim());
      });

      nameInput?.addEventListener("input", () => {
        const currentId = adminTournamentForm.querySelector('[name="tournament_id"]')?.value;
        if (!slugWasManuallyEdited && !currentId && slugInput) {
          slugInput.value = slugifyVCL(nameInput.value);
        }
      });

      adminTournamentForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(adminTournamentForm);
        const tournamentId = getTournamentFormValue(formData, "tournament_id");
        const payload = {
          name: getTournamentFormValue(formData, "name"),
          slug: slugifyVCL(getTournamentFormValue(formData, "slug")),
          series_slug: getTournamentFormValue(formData, "series_slug") || "academy",
          status: getTournamentFormValue(formData, "status") || "draft",
          starts_at: toISOStringOrNull(getTournamentFormValue(formData, "starts_at")),
          signup_closes_at: toISOStringOrNull(getTournamentFormValue(formData, "signup_closes_at")),
          checkin_opens_at: toISOStringOrNull(getTournamentFormValue(formData, "checkin_opens_at")),
          checkin_closes_at: toISOStringOrNull(getTournamentFormValue(formData, "checkin_closes_at")),
          max_teams: Number(getTournamentFormValue(formData, "max_teams") || 16),
          map_order: getTournamentFormValue(formData, "map_order") || "HP · SND · OL · HP · SND",
          description: getTournamentFormValue(formData, "description"),
          rules_url: getTournamentFormValue(formData, "rules_url") || null
        };

        if (!payload.name || !payload.slug) {
          if (adminTournamentStatus) {
            adminTournamentStatus.textContent = "Navn og slug skal udfyldes.";
            adminTournamentStatus.dataset.status = "error";
          }
          return;
        }

        const submitButton = adminTournamentForm.querySelector('button[type="submit"]');

        try {
          if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = tournamentId ? "Opdaterer..." : "Opretter...";
          }
          if (adminTournamentStatus) {
            adminTournamentStatus.textContent = "Gemmer turnering i Supabase...";
            adminTournamentStatus.dataset.status = "info";
          }

          if (tournamentId) {
            await window.VCLData.updateTournament(tournamentId, payload);
          } else {
            await window.VCLData.createTournament(payload);
          }

          const successMessage = tournamentId
            ? "Turneringen er opdateret."
            : "Turneringen er oprettet.";

          resetAdminTournamentForm();
          slugWasManuallyEdited = false;

          if (adminTournamentStatus) {
            adminTournamentStatus.textContent = successMessage;
            adminTournamentStatus.dataset.status = "success";
          }

          await loadAdminTournaments();
        } catch (error) {
          console.error(error);
          if (adminTournamentStatus) {
            adminTournamentStatus.textContent = error.message || "Kunne ikke gemme turneringen.";
            adminTournamentStatus.dataset.status = "error";
          }
        } finally {
          if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "Gem turnering";
          }
        }
      });
    }

    adminTournamentReset?.addEventListener("click", () => {
      slugWasManuallyEdited = false;
      resetAdminTournamentForm();
    });

    adminDeleteTournamentCancelButtons.forEach((button) => {
      button.addEventListener("click", closeAdminTournamentDeleteDialog);
    });

    adminDeleteTournamentConfirm?.addEventListener("click", async () => {
      const tournament = pendingAdminTournamentDelete;
      if (!tournament) return;

      try {
        adminDeleteTournamentConfirm.disabled = true;
        adminDeleteTournamentConfirm.textContent = "Sletter...";
        if (adminDeleteTournamentStatus) {
          adminDeleteTournamentStatus.textContent = "Fjerner turneringen fra Supabase...";
          adminDeleteTournamentStatus.dataset.status = "info";
        }

        await window.VCLData.deleteTournament(tournament.id);

        const editingId = adminTournamentForm?.querySelector('[name="tournament_id"]')?.value;
        if (String(editingId || "") === String(tournament.id)) {
          resetAdminTournamentForm();
        }
        if (String(managedAdminTournament?.id || "") === String(tournament.id)) {
          managedAdminTournament = null;
          if (adminTournamentManager) adminTournamentManager.hidden = true;
        }

        closeAdminTournamentDeleteDialog();
        await loadAdminTournaments();
        if (adminTournamentStatus) {
          adminTournamentStatus.textContent = `${tournament.name || "Turneringen"} er slettet.`;
          adminTournamentStatus.dataset.status = "success";
        }
      } catch (error) {
        console.error(error);
        if (adminDeleteTournamentStatus) {
          adminDeleteTournamentStatus.textContent = error.message || "Kunne ikke slette turneringen.";
          adminDeleteTournamentStatus.dataset.status = "error";
        }
        adminDeleteTournamentConfirm.disabled = false;
        adminDeleteTournamentConfirm.textContent = "Prøv igen";
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && adminDeleteTournamentDialog && !adminDeleteTournamentDialog.hidden) {
        closeAdminTournamentDeleteDialog();
      }
    });

    adminGenerateBracket?.addEventListener("click", async () => {
      if (!managedAdminTournament) return;

      const confirmed = confirm(
        `Generér en ny single-elimination bracket til ${managedAdminTournament.name}? En eksisterende planlagt bracket bliver erstattet.`
      );
      if (!confirmed) return;

      try {
        adminGenerateBracket.disabled = true;
        adminGenerateBracket.textContent = "Genererer...";
        if (adminTournamentManagerStatus) {
          adminTournamentManagerStatus.textContent = "Genererer bracket ud fra seeds...";
          adminTournamentManagerStatus.dataset.status = "info";
        }

        const result = await window.VCLData.generateTournamentBracket(managedAdminTournament.id);
        if (adminTournamentManagerStatus) {
          adminTournamentManagerStatus.textContent = `Bracket klar: ${result?.team_count || "?"} hold · ${result?.round_count || "?"} runder.`;
          adminTournamentManagerStatus.dataset.status = "success";
        }
        await loadAdminTournamentManager(managedAdminTournament.id, false);
      } catch (error) {
        console.error(error);
        if (adminTournamentManagerStatus) {
          adminTournamentManagerStatus.textContent = error.message || "Kunne ikke generere bracket.";
          adminTournamentManagerStatus.dataset.status = "error";
        }
      } finally {
        adminGenerateBracket.disabled = false;
        adminGenerateBracket.textContent = "Generér bracket";
      }
    });

    function injectAdminNewsEditButtons() {
  if (!adminNewsList) return;

  $$(".admin-news-actions", adminNewsList).forEach((actions) => {
    if (actions.querySelector("[data-admin-edit-news]")) return;

    const referenceButton = actions.querySelector("[data-news-id]");
    const newsId = referenceButton?.dataset.newsId;

    if (!newsId) return;

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.setAttribute("data-admin-edit-news", "");
    editButton.setAttribute("data-news-id", newsId);

    actions.prepend(editButton);
  });

  $$("[data-admin-edit-news]", adminNewsList).forEach((button) => {
    button.addEventListener("click", () => {
      openAdminNewsEditForm(button.dataset.newsId);
    });
  });
}

function openAdminNewsEditForm(newsId) {
  if (!adminNewsList) return;

  const post = cachedAdminNewsPosts.find((item) => item.id === newsId);

  if (!post) {
    alert("Kunne ikke finde nyheden i admin listen.");
    return;
  }

  closeAdminNewsEditForm();

  const form = document.createElement("form");
  form.className = "admin-news-edit-form";
  form.setAttribute("data-admin-news-edit-form", "");
  form.setAttribute("data-news-id", newsId);

  form.innerHTML = `
    <div class="profile-section-head">
      <p class="section-kicker">Edit news</p>
      <h3>Rediger nyhed</h3>
      <p>Ret indholdet og gem ændringerne direkte i Supabase.</p>
    </div>

    <div class="admin-news-edit-form__grid">
      <label>
        Title
        <input
          name="title"
          value="${escapeHTML(post.title || "")}"
          required
        >
      </label>

      <label>
        Category
        <select name="category">
          <option value="General" ${post.category === "General" ? "selected" : ""}>General</option>
          <option value="Academy" ${post.category === "Academy" ? "selected" : ""}>Academy</option>
          <option value="Contender" ${post.category === "Contender" ? "selected" : ""}>Contender</option>
          <option value="Championship" ${post.category === "Championship" ? "selected" : ""}>Championship</option>
          <option value="Roster" ${post.category === "Roster" ? "selected" : ""}>Roster</option>
          <option value="Signup" ${post.category === "Signup" ? "selected" : ""}>Signup</option>
        </select>
      </label>

      <label>
        Status
        <select name="status">
          <option value="draft" ${post.status === "draft" ? "selected" : ""}>Draft</option>
          <option value="published" ${post.status === "published" ? "selected" : ""}>Published</option>
          <option value="archived" ${post.status === "archived" ? "selected" : ""}>Archived</option>
        </select>
      </label>

      <label class="admin-news-edit-form__checkbox">
        <input
          type="checkbox"
          name="is_pinned"
          ${post.is_pinned ? "checked" : ""}
        >
        Pin som featured news
      </label>
    </div>

    <label>
      Excerpt
      <textarea name="excerpt" rows="3">${escapeHTML(post.excerpt || "")}</textarea>
    </label>

    <label>
      Body
      <textarea name="body" rows="8">${escapeHTML(post.body || "")}</textarea>
    </label>

    <div class="admin-news-edit-form__actions">
      <button type="submit">Gem ændringer</button>
      <button type="button" data-cancel-news-edit>Cancel</button>
    </div>

    <p class="notice" data-admin-news-edit-status></p>
  `;

  const currentCard = adminNewsList
    .querySelector(`[data-news-id="${CSS.escape(newsId)}"]`)
    ?.closest(".admin-list-card");

  if (currentCard) {
    currentCard.insertAdjacentElement("afterend", form);
  } else {
    adminNewsList.prepend(form);
  }

  form.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  form.querySelector("[data-cancel-news-edit]")?.addEventListener("click", () => {
    closeAdminNewsEditForm();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const status = form.querySelector("[data-admin-news-edit-status]");
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);

    const nextStatus = String(formData.get("status") || "draft").trim();

    const updates = {
      title: String(formData.get("title") || "").trim(),
      category: String(formData.get("category") || "General").trim(),
      status: nextStatus,
      excerpt: String(formData.get("excerpt") || "").trim(),
      body: String(formData.get("body") || "").trim(),
      is_pinned: Boolean(formData.get("is_pinned"))
    };

    if (!updates.title) {
      if (status) {
        status.textContent = "Title må ikke være tom.";
        status.dataset.status = "error";
      }
      return;
    }

    if (updates.status !== "published") {
      updates.is_pinned = false;
    }

    if (updates.status === "published") {
      updates.published_at = post.published_at || new Date().toISOString();
    }

    try {
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Gemmer...";
      }

      if (status) {
        status.textContent = "Gemmer ændringer...";
        status.dataset.status = "info";
      }

      await window.VCLData.updateNewsPost(newsId, updates);

      if (status) {
        status.textContent = "Nyhed opdateret.";
        status.dataset.status = "success";
      }

      await loadAdminNews();
    } catch (error) {
      console.error(error);

      if (status) {
        status.textContent =
          error.message || "Kunne ikke opdatere nyheden.";
        status.dataset.status = "error";
      }

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Gem ændringer";
      }
    }
  });
}

function closeAdminNewsEditForm() {
  const existingForm = $("[data-admin-news-edit-form]");
  if (existingForm) {
    existingForm.remove();
  }
}

    async function loadAdminNews() {
  if (!adminNewsList || !window.VCLData.getAdminNewsPosts) return;

  const posts = await window.VCLData.getAdminNewsPosts();
  cachedAdminNewsPosts = posts;

  if (adminNewsCount) {
    adminNewsCount.textContent = String(posts.length);
  }

  if (!posts.length) {
    adminNewsList.innerHTML = `
      <article>
        <span>Empty</span>
        <strong>Ingen nyheder endnu</strong>
        <p>Opret den første VCL announcement i formularen.</p>
      </article>
    `;
    return;
  }

  adminNewsList.innerHTML = posts
    .map((post) => {
      const date = post.published_at || post.created_at;
      const dateText = date
        ? new Date(date).toLocaleDateString("da-DK")
        : "Ingen dato";

      const isPublished = post.status === "published";
      const isArchived = post.status === "archived";

      return `
        <article class="admin-list-card">
          <div>
            <span>
              ${escapeHTML(post.category || "News")}
              · ${escapeHTML(post.status || "draft")}
              ${post.is_pinned ? " · Pinned" : ""}
            </span>

            <strong>${escapeHTML(post.title || "Untitled")}</strong>

            <p>${escapeHTML(post.excerpt || post.body || "Ingen tekst.")}</p>

            <small>${escapeHTML(dateText)}</small>
          </div>

          <div class="admin-list-card__actions admin-news-actions">
            <button
              type="button"
              data-admin-pin-news
              data-news-id="${escapeHTML(post.id)}"
              ${post.is_pinned && isPublished ? "disabled" : ""}
            >
              ${post.is_pinned && isPublished ? "Pinned" : "Pin"}
            </button>

            <button
              type="button"
              data-admin-toggle-news-status
              data-news-id="${escapeHTML(post.id)}"
              data-current-status="${escapeHTML(post.status || "draft")}"
            >
              ${isPublished ? "Gør draft" : "Publish"}
            </button>

            <button
              type="button"
              data-admin-archive-news
              data-news-id="${escapeHTML(post.id)}"
              ${isArchived ? "disabled" : ""}
            >
              ${isArchived ? "Archived" : "Archive"}
            </button>

            <button
              type="button"
              data-admin-delete-news
              data-news-id="${escapeHTML(post.id)}"
              data-news-title="${escapeHTML(post.title || "nyheden")}"
            >
              Delete
            </button>

            <a href="nyheder.html">Se side</a>
          </div>

          <p class="notice" data-admin-news-action-status="${escapeHTML(post.id)}"></p>
        </article>
      `;
    })
    .join("");
    injectAdminNewsEditButtons();

  $$("[data-admin-pin-news]").forEach((button) => {
    button.addEventListener("click", async () => {
      const newsId = button.dataset.newsId;
      const status = $(`[data-admin-news-action-status="${newsId}"]`);

      try {
        button.disabled = true;
        button.textContent = "Pinner...";

        if (status) {
          status.textContent = "Pinner nyhed...";
          status.dataset.status = "info";
        }

        await window.VCLData.updateNewsPost(newsId, {
          is_pinned: true,
          status: "published",
          published_at: new Date().toISOString()
        });

        await loadAdminNews();
      } catch (error) {
        console.error(error);

        if (status) {
          status.textContent = error.message || "Kunne ikke pinne nyhed.";
          status.dataset.status = "error";
        }

        await loadAdminNews();
      }
    });
  });

  $$("[data-admin-toggle-news-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const newsId = button.dataset.newsId;
      const currentStatus = button.dataset.currentStatus || "draft";
      const status = $(`[data-admin-news-action-status="${newsId}"]`);

      const nextStatus = currentStatus === "published" ? "draft" : "published";

      const updates = {
        status: nextStatus
      };

      if (nextStatus === "published") {
        updates.published_at = new Date().toISOString();
      } else {
        updates.is_pinned = false;
      }

      try {
        button.disabled = true;
        button.textContent = "Opdaterer...";

        if (status) {
          status.textContent = "Opdaterer status...";
          status.dataset.status = "info";
        }

        await window.VCLData.updateNewsPost(newsId, updates);

        await loadAdminNews();
      } catch (error) {
        console.error(error);

        if (status) {
          status.textContent = error.message || "Kunne ikke opdatere status.";
          status.dataset.status = "error";
        }

        await loadAdminNews();
      }
    });
  });

  $$("[data-admin-archive-news]").forEach((button) => {
    button.addEventListener("click", async () => {
      const newsId = button.dataset.newsId;
      const status = $(`[data-admin-news-action-status="${newsId}"]`);

      const confirmed = confirm(
        "Er du sikker på, at du vil archive denne nyhed? Den vises ikke længere offentligt."
      );

      if (!confirmed) return;

      try {
        button.disabled = true;
        button.textContent = "Archiver...";

        if (status) {
          status.textContent = "Archiverer nyhed...";
          status.dataset.status = "info";
        }

        await window.VCLData.updateNewsPost(newsId, {
          status: "archived",
          is_pinned: false
        });

        await loadAdminNews();
      } catch (error) {
        console.error(error);

        if (status) {
          status.textContent = error.message || "Kunne ikke archive nyhed.";
          status.dataset.status = "error";
        }

        await loadAdminNews();
      }
    });
  });

  $$("[data-admin-delete-news]").forEach((button) => {
    button.addEventListener("click", async () => {
      const newsId = button.dataset.newsId;
      const newsTitle = button.dataset.newsTitle || "nyheden";
      const status = $(`[data-admin-news-action-status="${newsId}"]`);

      const confirmed = confirm(
        `Er du sikker på, at du vil slette "${newsTitle}" permanent?`
      );

      if (!confirmed) return;

      try {
        button.disabled = true;
        button.textContent = "Sletter...";

        if (status) {
          status.textContent = "Sletter nyhed...";
          status.dataset.status = "info";
        }

        await window.VCLData.deleteNewsPost(newsId);

        await loadAdminNews();
      } catch (error) {
        console.error(error);

        if (status) {
          status.textContent = error.message || "Kunne ikke slette nyhed.";
          status.dataset.status = "error";
        }

        await loadAdminNews();
      }
    });
  });
}

function applyAdminUnclaimedSearch() {
  if (!adminUnclaimedList) return;

  const query = String(adminUnclaimedSearch?.value || "")
    .toLowerCase()
    .trim();

  const cards = Array.from(adminUnclaimedList.children).filter((card) => {
    return card.matches("article, .admin-list-card");
  });

  let visibleCount = 0;

  cards.forEach((card) => {
    const text = card.textContent.toLowerCase();
    const matches = !query || text.includes(query);

    card.hidden = !matches;

    if (matches) {
      visibleCount += 1;
    }
  });

  let emptyMessage = $("[data-admin-unclaimed-search-empty]");

  if (query && cards.length && visibleCount === 0) {
    if (!emptyMessage) {
      emptyMessage = document.createElement("div");
      emptyMessage.className = "admin-search-empty";
      emptyMessage.setAttribute("data-admin-unclaimed-search-empty", "");
      adminUnclaimedList.insertAdjacentElement("afterend", emptyMessage);
    }

    emptyMessage.innerHTML = `
      <strong>Ingen profiler fundet</strong>
      <p>Der er ingen unclaimed profiles der matcher "${escapeHTML(query)}".</p>
    `;
  } else if (emptyMessage) {
    emptyMessage.remove();
  }

  if (adminUnclaimedSearchCount) {
    adminUnclaimedSearchCount.textContent = query
      ? `Viser ${visibleCount} af ${cards.length}`
      : `Alle ${cards.length} unclaimed profiles`;
  }
}

if (adminUnclaimedSearch) {
  adminUnclaimedSearch.addEventListener("input", applyAdminUnclaimedSearch);
}

async function loadAdminTeamSignups() {
  if (!adminTeamSignupsList || !window.VCLData.getAdminTeamSignups) {
    return;
  }

  const signups = await window.VCLData.getAdminTeamSignups();
  cachedAdminTeamSignups = signups;

  const pendingCount = signups.filter((signup) => signup.status === "pending").length;

  if (adminTeamSignupsCount) {
    adminTeamSignupsCount.textContent = String(pendingCount);
  }

  renderAdminTeamSignups();
}

function renderAdminTeamSignups() {
  if (!adminTeamSignupsList) return;

  const signups = cachedAdminTeamSignups || [];

  const filteredSignups =
    activeAdminSignupFilter === "all"
      ? signups
      : signups.filter((signup) => signup.status === activeAdminSignupFilter);

  if (adminTeamSignupsHistoryCount) {
    adminTeamSignupsHistoryCount.textContent =
      activeAdminSignupFilter === "all"
        ? `Viser ${filteredSignups.length} af ${signups.length} signups`
        : `Viser ${filteredSignups.length} ${activeAdminSignupFilter} signups`;
  }

  if (!filteredSignups.length) {
    adminTeamSignupsList.innerHTML = `
      <article>
        <span>Clean</span>
        <strong>Ingen ${escapeHTML(activeAdminSignupFilter)} team signups</strong>
        <p>Der er ingen holdtilmeldinger i denne kategori.</p>
      </article>
    `;
    return;
  }

  adminTeamSignupsList.innerHTML = filteredSignups
    .map((signup) => {
      const roster = Array.isArray(signup.roster) ? signup.roster : [];
      const substitutes = Array.isArray(signup.substitutes)
        ? signup.substitutes
        : [];

      const createdDate = signup.created_at
        ? new Date(signup.created_at).toLocaleDateString("da-DK")
        : "Ingen dato";

      const reviewedDate = signup.reviewed_at
        ? new Date(signup.reviewed_at).toLocaleDateString("da-DK")
        : "";

      const rosterHtml = roster.length
        ? roster
            .map((player) => {
              return `<span>${escapeHTML(player.alias || "Ukendt spiller")}</span>`;
            })
            .join("")
        : `<span>Roster mangler</span>`;

      const subsHtml = substitutes.length
        ? substitutes
            .map((player) => {
              return `<span>${escapeHTML(player.alias || "Ukendt sub")}</span>`;
            })
            .join("")
        : `<span>Ingen subs</span>`;

      const isPending = signup.status === "pending";
      const isApproved = signup.status === "approved";
      const isRejected = signup.status === "rejected";

      const approvedTeamLink =
        isApproved && signup.approved_team_slug
          ? `
            <a href="team-profile.html?team=${encodeURIComponent(signup.approved_team_slug)}">
              Se team
            </a>
          `
          : "";

          const claimLinksButton = isApproved
  ? `
    <button
      type="button"
      data-admin-create-signup-claim-links
      data-signup-id="${escapeHTML(signup.id)}"
      data-team-name="${escapeHTML(signup.team_name || "teamet")}"
    >
      Lav claim-links
    </button>
  `
  : "";

      const rejectedNote =
        isRejected && signup.admin_note
          ? `<p><b>Admin note:</b> ${escapeHTML(signup.admin_note)}</p>`
          : "";

      const reviewedText =
        reviewedDate && !isPending
          ? ` · Behandlet ${escapeHTML(reviewedDate)}`
          : "";

      return `
        <article class="admin-list-card admin-team-signup-card admin-team-signup-card--${escapeHTML(signup.status || "pending")}">
          <div>
            <span>
              ${escapeHTML("VCL Team Registration")}
              · ${escapeHTML(signup.status || "pending")}
              · ${escapeHTML(createdDate)}
              ${reviewedText}
            </span>

            <strong>${escapeHTML(signup.team_name || "Ukendt team")}</strong>

            <p>
              Niveau:
              <b>${escapeHTML(signup.team_level || "Ikke angivet")}</b>
            </p>

            <p>
              Captain:
              <b>${escapeHTML(signup.captain_name || "Ukendt")}</b>
              · Discord:
              <b>${escapeHTML(signup.captain_discord || "—")}</b>
              · Email:
              <b>${escapeHTML(signup.captain_email || "—")}</b>
            </p>

            ${
              signup.team_description
                ? `<p>${escapeHTML(signup.team_description)}</p>`
                : ""
            }

            <div class="admin-signup-roster">
              <div>
                <span>Starting roster</span>
                <div>${rosterHtml}</div>
              </div>

              <div>
                <span>Bench / subs</span>
                <div>${subsHtml}</div>
              </div>
            </div>

            ${
              signup.message
                ? `<p><b>Besked:</b> ${escapeHTML(signup.message)}</p>`
                : ""
            }

            ${rejectedNote}
          </div>

          <div class="admin-list-card__actions">
            ${
              isPending
                ? `
                  <button
                    type="button"
                    data-admin-approve-signup
                    data-signup-id="${escapeHTML(signup.id)}"
                    data-team-name="${escapeHTML(signup.team_name || "teamet")}"
                  >
                    Godkend
                  </button>

                  <button
                    type="button"
                    data-admin-reject-signup
                    data-signup-id="${escapeHTML(signup.id)}"
                    data-team-name="${escapeHTML(signup.team_name || "teamet")}"
                  >
                    Afvis
                  </button>
                `
                : ""
            }

            ${approvedTeamLink}
${claimLinksButton}
          </div>

          <p class="notice" data-admin-signup-status="${escapeHTML(signup.id)}"></p>
        </article>
      `;
    })
    .join("");

  bindAdminSignupActions();
}

function bindAdminSignupActions() {
  $$("[data-admin-approve-signup]").forEach((button) => {
    button.addEventListener("click", async () => {
      const signupId = button.dataset.signupId;
      const teamName = button.dataset.teamName || "teamet";
      const status = $(`[data-admin-signup-status="${signupId}"]`);

      try {
        if (status) {
          status.textContent = "Tjekker signup for fejl...";
          status.dataset.status = "info";
        }

        if (window.VCLData.adminValidateTeamSignup) {
          const validation = await window.VCLData.adminValidateTeamSignup(signupId);

          const errors = Array.isArray(validation.errors)
            ? validation.errors
            : [];

          const warnings = Array.isArray(validation.warnings)
            ? validation.warnings
            : [];

          if (!validation.valid || errors.length) {
            if (status) {
              status.dataset.status = "error";
              status.innerHTML = `
                <strong>Kan ikke godkendes:</strong>
                <ul>
                  ${errors
                    .map((error) => `<li>${escapeHTML(error)}</li>`)
                    .join("")}
                </ul>
              `;
            }

            return;
          }

          if (warnings.length) {
            const continueWithWarnings = confirm(
              `Advarsler for ${teamName}:\n\n${warnings
                .map((warning) => `- ${warning}`)
                .join("\n")}\n\nVil du stadig godkende holdet?`
            );

            if (!continueWithWarnings) {
              if (status) {
                status.textContent = "Approval afbrudt.";
                status.dataset.status = "info";
              }

              return;
            }
          }
        }

        const confirmed = confirm(
          `Er du sikker på, at du vil godkende ${teamName}? Det opretter team, roster og captain.`
        );

        if (!confirmed) return;

        button.disabled = true;
        button.textContent = "Godkender...";

        if (status) {
          status.textContent = "Godkender holdregistrering...";
          status.dataset.status = "info";
        }

        await window.VCLData.adminApproveTeamSignup(signupId);

        if (status) {
          status.textContent = "Holdet er godkendt.";
          status.dataset.status = "success";
        }

        await Promise.all([
          loadAdminTeamSignups(),
          loadAdminPendingAvatars(),
          loadAdminUnclaimedProfiles()
        ]);
      } catch (error) {
        console.error(error);

        button.disabled = false;
        button.textContent = "Godkend";

        if (status) {
          status.textContent =
            error.message || "Kunne ikke godkende holdregistreringen.";
          status.dataset.status = "error";
        }
      }
    });
  });

  $$("[data-admin-reject-signup]").forEach((button) => {
    button.addEventListener("click", async () => {
      const signupId = button.dataset.signupId;
      const teamName = button.dataset.teamName || "teamet";
      const status = $(`[data-admin-signup-status="${signupId}"]`);

      const note = prompt(
        `Hvorfor afviser du ${teamName}? Du kan også lade feltet være tomt.`
      );

      if (note === null) return;

      try {
        button.disabled = true;
        button.textContent = "Afviser...";

        if (status) {
          status.textContent = "Afviser holdregistrering...";
          status.dataset.status = "info";
        }

        await window.VCLData.adminRejectTeamSignup(signupId, note);

        if (status) {
          status.textContent = "Registreringen er afvist.";
          status.dataset.status = "success";
        }

        await loadAdminTeamSignups();
      } catch (error) {
        console.error(error);

        button.disabled = false;
        button.textContent = "Afvis";

        if (status) {
          status.textContent =
            error.message || "Kunne ikke afvise holdregistreringen.";
          status.dataset.status = "error";
        }
      }
    });
  });

  $$("[data-admin-create-signup-claim-links]").forEach((button) => {
    button.addEventListener("click", async () => {
      const signupId = button.dataset.signupId;
      const teamName = button.dataset.teamName || "teamet";
      const status = $(`[data-admin-signup-status="${signupId}"]`);

      try {
        button.disabled = true;
        button.textContent = "Laver links...";

        if (status) {
          status.textContent = `Finder unclaimed spillere på ${teamName}...`;
          status.dataset.status = "info";
        }

        if (!window.VCLData.getAdminSignupClaimTargets) {
          throw new Error("getAdminSignupClaimTargets mangler i vclData.js");
        }

        if (!window.VCLData.adminCreateClaimInvite) {
          throw new Error("adminCreateClaimInvite mangler i vclData.js");
        }

        const targets = await window.VCLData.getAdminSignupClaimTargets(signupId);

        if (!targets.length) {
          if (status) {
            status.textContent =
              "Alle spillere på dette hold er allerede claimed, eller der er ingen claim targets.";
            status.dataset.status = "success";
          }

          button.disabled = false;
          button.textContent = "Lav claim-links";
          return;
        }

        const claimLinks = [];

        for (const target of targets) {
          const invite = await window.VCLData.adminCreateClaimInvite(target.player_id);
          const token = Array.isArray(invite) ? invite[0]?.token : invite?.token;

          if (!token) continue;

          const claimUrl = `${window.location.origin}${window.location.pathname.replace(
            "admin.html",
            "signup.html"
          )}?claim=${encodeURIComponent(token)}`;

          claimLinks.push({
            alias: target.player_alias,
            role: target.member_role,
            rosterStatus: target.roster_status,
            url: claimUrl
          });
        }

        if (!claimLinks.length) {
          if (status) {
            status.textContent = "Der blev ikke lavet nogen claim-links.";
            status.dataset.status = "error";
          }

          button.disabled = false;
          button.textContent = "Lav claim-links";
          return;
        }

        if (status) {
          status.dataset.status = "success";
          status.innerHTML = `
            <strong>Claim-links klar:</strong>

            <div class="admin-claim-links">
              ${claimLinks
                .map((link) => {
                  return `
                    <article>
                      <div>
                        <strong>${escapeHTML(link.alias || "Ukendt spiller")}</strong>
                        <span>${escapeHTML(link.rosterStatus || "roster")} · ${escapeHTML(link.role || "player")}</span>
                      </div>

                      <input value="${escapeHTML(link.url)}" readonly>

                      <button
                        type="button"
                        data-copy-admin-claim-link="${escapeHTML(link.url)}"
                      >
                        Kopiér
                      </button>
                    </article>
                  `;
                })
                .join("")}
            </div>
          `;

          $$("[data-copy-admin-claim-link]", status).forEach((copyButton) => {
            copyButton.addEventListener("click", async () => {
              const url = copyButton.dataset.copyAdminClaimLink;

              try {
                await navigator.clipboard.writeText(url);
                copyButton.textContent = "Kopieret";
              } catch {
                copyButton.textContent = "Kunne ikke kopiere";
              }

              setTimeout(() => {
                copyButton.textContent = "Kopiér";
              }, 1400);
            });
          });
        }

        button.disabled = false;
        button.textContent = "Lav claim-links";
      } catch (error) {
        console.error(error);

        if (status) {
          status.textContent =
            error.message || "Kunne ikke lave claim-links.";
          status.dataset.status = "error";
        }

        button.disabled = false;
        button.textContent = "Lav claim-links";
      }
    });
  });
}
adminSignupFilters.forEach((button) => {
  button.addEventListener("click", () => {
    activeAdminSignupFilter = button.dataset.adminSignupFilter || "pending";

    adminSignupFilters.forEach((item) => {
      item.classList.toggle("active", item === button);
    });

    renderAdminTeamSignups();
  });
});

    async function loadAdminPendingAvatars() {
      if (!adminAvatarList || !window.VCLData.getAdminPendingPlayerAvatars) return;
      try {
        const submissions = await window.VCLData.getAdminPendingPlayerAvatars();
        if (!submissions.length) {
          adminAvatarList.innerHTML = `<article><span>Clean</span><strong>Ingen profilbilleder afventer</strong><p>Der er ingen nye avatars til moderation lige nu.</p></article>`;
          return;
        }
        adminAvatarList.innerHTML = submissions.map((item) => `
          <article class="admin-avatar-card-v1" data-admin-avatar-card="${escapeHTML(item.submission_id)}">
            <div class="admin-avatar-card-v1__image">${item.pending_preview_url ? `<img src="${escapeHTML(item.pending_preview_url)}" alt="Profilbillede fra ${escapeHTML(item.alias || 'spiller')}">` : ''}</div>
            <div class="admin-avatar-card-v1__copy">
              <span>Afventer godkendelse</span>
              <strong>${escapeHTML(item.alias || 'Ukendt spiller')}</strong>
              <p>${new Date(item.submitted_at).toLocaleString('da-DK')}</p>
            </div>
            <div class="admin-avatar-card-v1__actions">
              <button type="button" data-admin-avatar-approve>Godkend</button>
              <button type="button" data-admin-avatar-reject>Afvis</button>
            </div>
          </article>`).join('');

        adminAvatarList.querySelectorAll('[data-admin-avatar-card]').forEach((card) => {
          const id = card.dataset.adminAvatarCard;
          const item = submissions.find((entry) => entry.submission_id === id);
          if (!item) return;
          const approve = card.querySelector('[data-admin-avatar-approve]');
          const reject = card.querySelector('[data-admin-avatar-reject]');
          approve?.addEventListener('click', async () => {
            try {
              approve.disabled = true;
              reject.disabled = true;
              approve.textContent = 'Godkender...';
              await window.VCLData.adminApprovePlayerAvatar(item);
              await loadAdminPendingAvatars();
            } catch (error) {
              console.error(error);
              approve.disabled = false;
              reject.disabled = false;
              approve.textContent = 'Godkend';
              window.alert(error.message || 'Profilbilledet kunne ikke godkendes.');
            }
          });
          reject?.addEventListener('click', async () => {
            const reason = window.prompt('Valgfri besked til spilleren om hvorfor billedet afvises:', '') ?? null;
            if (reason === null) return;
            try {
              approve.disabled = true;
              reject.disabled = true;
              reject.textContent = 'Afviser...';
              await window.VCLData.adminRejectPlayerAvatar(item, reason);
              await loadAdminPendingAvatars();
            } catch (error) {
              console.error(error);
              approve.disabled = false;
              reject.disabled = false;
              reject.textContent = 'Afvis';
              window.alert(error.message || 'Profilbilledet kunne ikke afvises.');
            }
          });
        });
      } catch (error) {
        console.error(error);
        adminAvatarList.innerHTML = `<article><span>Fejl</span><strong>Kunne ikke hente profilbilleder</strong><p>Prøv igen om et øjeblik.</p></article>`;
      }
    }

    async function loadAdminUnclaimedProfiles() {
      if (!adminUnclaimedList || !window.VCLData.getAdminUnclaimedProfiles) {
        return;
      }

      const profiles = await window.VCLData.getAdminUnclaimedProfiles();

      if (adminUnclaimedCount) {
        adminUnclaimedCount.textContent = String(profiles.length);
      }

      if (!profiles.length) {
        adminUnclaimedList.innerHTML = `
          <article>
            <span>Clean</span>
            <strong>Ingen unclaimed profiles</strong>
            <p>Alle aktive player profiles er claimet.</p>
          </article>
        `;
        return;
      }

      adminUnclaimedList.innerHTML = profiles
        .map((player) => {
          return `
            <article class="admin-list-card">
              <div>
                <span>
                  ${escapeHTML(player.team_name || "No team")}
                  · ${escapeHTML(player.roster_status || "No roster")}
                </span>

                <strong>${escapeHTML(player.alias || "Ukendt spiller")}</strong>

                <p>
                  ${escapeHTML(player.primary_role || "Player")}
                  ${
                    player.level
                      ? `· ${escapeHTML(player.level)}`
                      : ""
                  }
                </p>

                <small>
                  ${player.is_free_agent ? "Free Agent" : "Ikke Free Agent"}
                </small>
              </div>

              <div class="admin-list-card__actions">
                <a href="player-profile.html?player=${encodeURIComponent(player.player_slug || "")}">
                  Se profile
                </a>

                <button
                  type="button"
                  data-admin-claim-player
                  data-player-id="${escapeHTML(player.player_id)}"
                  data-player-alias="${escapeHTML(player.alias || "spilleren")}"
                >
                  Lav claim link
                </button>
              </div>

              <p class="notice" data-admin-claim-status="${escapeHTML(player.player_id)}"></p>
            </article>
          `;
        })
        .join("");

      $$("[data-admin-claim-player]").forEach((button) => {
        button.addEventListener("click", async () => {
          const playerId = button.dataset.playerId;
          const playerAlias = button.dataset.playerAlias || "spilleren";
          const status = $(`[data-admin-claim-status="${playerId}"]`);

          try {
            button.disabled = true;
            button.textContent = "Laver link...";

            if (status) {
              status.textContent = `Laver claim link til ${playerAlias}...`;
              status.dataset.status = "info";
            }

            const invite = await window.VCLData.adminCreateClaimInvite(playerId);
            const link = buildAdminClaimLink(invite.token);

            await copyAdminText(link);

            button.textContent = "Link kopieret";

            if (status) {
              status.innerHTML = `
                Claim link kopieret:
                <br>
                <a href="${escapeHTML(link)}">${escapeHTML(link)}</a>
              `;
              status.dataset.status = "success";
            }
          } catch (error) {
            console.error(error);

            button.disabled = false;
            button.textContent = "Lav claim link";

            if (status) {
              status.textContent =
                error.message || "Kunne ikke lave claim link.";
              status.dataset.status = "error";
            }
          }
        });
      });
    }
    if (adminNewsForm) {
      adminNewsForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const formData = new FormData(adminNewsForm);

        const post = {
          title: String(formData.get("title") || "").trim(),
          excerpt: String(formData.get("excerpt") || "").trim(),
          body: String(formData.get("body") || "").trim(),
          category: String(formData.get("category") || "Announcement"),
          status: String(formData.get("status") || "draft"),
          is_pinned: Boolean(formData.get("is_pinned"))
        };

        if (!post.title || !post.body) {
          if (adminNewsStatus) {
            adminNewsStatus.textContent = "Titel og indhold skal udfyldes.";
            adminNewsStatus.dataset.status = "error";
          }
          return;
        }

        try {
          const submitButton = adminNewsForm.querySelector('button[type="submit"]');

          if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Opretter...";
          }

          if (adminNewsStatus) {
            adminNewsStatus.textContent = "Opretter nyhed...";
            adminNewsStatus.dataset.status = "info";
          }

          await window.VCLData.createNewsPost(post);

          adminNewsForm.reset();

          if (adminNewsStatus) {
            adminNewsStatus.textContent = "Nyhed oprettet.";
            adminNewsStatus.dataset.status = "success";
          }

          if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "Opret nyhed";
          }

          await loadAdminNews();
        } catch (error) {
          console.error(error);

          const submitButton = adminNewsForm.querySelector('button[type="submit"]');

          if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "Opret nyhed";
          }

          if (adminNewsStatus) {
            adminNewsStatus.textContent =
              error.message || "Kunne ikke oprette nyhed.";
            adminNewsStatus.dataset.status = "error";
          }
        }
      });
    }

    async function loadAdminDashboard() {
      const isAdmin = await checkAdminAccess();

      if (!isAdmin) {
        return;
      }

      await Promise.all([
  loadAdminTournaments(),
  loadAdminNews(),
  loadAdminTeamSignups(),
  loadAdminPendingAvatars(),
  loadAdminUnclaimedProfiles()
]);
    }

    loadAdminDashboard();
  }

  /* =========================
     LIVE NEWS PAGE — VCL 2.0
  ========================= */

  const newsPage = $(".news-page");
  const featuredNewsBox = $("[data-news-featured]");
  const featuredNewsSection = $("[data-news-featured-section]");
  const newsList = $("[data-news-list]");
  const newsFeedSection = $("[data-news-feed-section]");

  if (newsPage && featuredNewsBox && newsList) {
    function getNewsDateParts(dateValue) {
      if (!dateValue) {
        return {
          month: "VCL",
          day: "--",
          year: "2026",
          full: "VCL"
        };
      }

      const date = new Date(dateValue);

      return {
        month: date.toLocaleDateString("da-DK", { month: "short" }).replace(".", ""),
        day: date.toLocaleDateString("da-DK", { day: "2-digit" }),
        year: date.toLocaleDateString("da-DK", { year: "numeric" }),
        full: date.toLocaleDateString("da-DK", {
          day: "numeric",
          month: "long",
          year: "numeric"
        })
      };
    }

    function getNewsLink(post) {
      const slug = String(post.slug || "").trim();

      if (!slug) {
        return "nyheder.html";
      }

      return `nyhed.html?slug=${encodeURIComponent(slug)}`;
    }

    function cleanNewsPreviewText(value) {
      return String(value || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, "$1")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/(?:discord\.gg|discord\.com\/invite)\/\S+/gi, " ")
        .replace(/^\s*[-#>*]+\s*/gm, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function getNewsPreview(post) {
      const excerpt = cleanNewsPreviewText(post.excerpt);
      const body = cleanNewsPreviewText(post.body);

      // Excerpts are useful when they contain real copy. Some older posts used
      // the excerpt field for a Discord URL, so in that case the article body
      // is the correct source for the newsroom teaser.
      const source = excerpt.length >= 35 ? excerpt : body || excerpt;
      if (!source) return "Læs den seneste opdatering fra VCL.";

      if (source.length <= 240) return source;

      const shortened = source.slice(0, 240);
      const lastSpace = shortened.lastIndexOf(" ");
      const preview = lastSpace > 180 ? shortened.slice(0, lastSpace) : shortened;
      return `${preview.trim()}…`;
    }

    function renderFeaturedNews(post) {
      const date = post.published_at || post.created_at;
      const dateParts = getNewsDateParts(date);
      const link = getNewsLink(post);

      featuredNewsBox.innerHTML = `
        <div class="news-featured-story-v2__meta">
          <span>${escapeHTML(post.category || "VCL News")}</span>
          <time datetime="${escapeHTML(date || "")}">${escapeHTML(dateParts.full)}</time>
          ${post.is_pinned ? '<b>Featured</b>' : ''}
        </div>

        <div class="news-featured-story-v2__content">
          <h2><a href="${escapeHTML(link)}">${escapeHTML(post.title || "VCL nyhed")}</a></h2>
          <p>${escapeHTML(getNewsPreview(post))}</p>
          <a class="news-read-more-v2" href="${escapeHTML(link)}">
            Læs historien <span aria-hidden="true">→</span>
          </a>
        </div>
      `;
    }

    function renderNewsRow(post) {
      const date = post.published_at || post.created_at;
      const dateParts = getNewsDateParts(date);
      const link = getNewsLink(post);

      return `
        <article class="news-feed-row-v2">
          <time class="news-feed-row-v2__date" datetime="${escapeHTML(date || "")}">
            <strong>${escapeHTML(dateParts.day)}</strong>
            <span>${escapeHTML(dateParts.month)} ${escapeHTML(dateParts.year)}</span>
          </time>

          <div class="news-feed-row-v2__content">
            <span class="news-feed-row-v2__category">${escapeHTML(post.category || "VCL News")}</span>
            <h3><a href="${escapeHTML(link)}">${escapeHTML(post.title || "VCL nyhed")}</a></h3>
            <p>${escapeHTML(getNewsPreview(post))}</p>
          </div>

          <a class="news-feed-row-v2__arrow" href="${escapeHTML(link)}" aria-label="Læs ${escapeHTML(post.title || "nyheden")}">→</a>
        </article>
      `;
    }

    let newsLoadInProgress = false;

    function renderNewsLoadError(error) {
      console.error("Kunne ikke hente nyheder:", error);

      if (featuredNewsSection) featuredNewsSection.hidden = false;
      if (newsFeedSection) newsFeedSection.hidden = true;

      featuredNewsBox.innerHTML = `
        <div class="news-empty-v2 news-empty-v2--error">
          <h2>Nyhederne kunne ikke indlæses</h2>
          <p>Der opstod en midlertidig fejl i forbindelsen til VCL. Prøv igen om et øjeblik.</p>
          <button type="button" data-retry-news>Prøv igen <span aria-hidden="true">→</span></button>
        </div>
      `;

      featuredNewsBox
        .querySelector("[data-retry-news]")
        ?.addEventListener("click", () => loadNewsV2());
    }

    async function loadNewsV2() {
      if (newsLoadInProgress) return;
      newsLoadInProgress = true;

      featuredNewsBox.setAttribute("aria-busy", "true");
      newsList.setAttribute("aria-busy", "true");

      try {
        const VCLData = await waitForVCLData("getNewsPosts", 8000);
        const posts = await VCLData.getNewsPosts();

        if (!posts.length) {
          if (featuredNewsSection) featuredNewsSection.hidden = false;
          if (newsFeedSection) newsFeedSection.hidden = true;

          featuredNewsBox.innerHTML = `
            <div class="news-empty-v2">
              <h2>Ingen nyheder endnu</h2>
              <p>Der er ikke publiceret nyt fra VCL lige nu. Kig forbi igen snart, eller følg announcements direkte i Discord.</p>
            </div>
          `;
          return;
        }

        const pinnedPost = posts.find((post) => post.is_pinned) || posts[0];
        const otherPosts = posts.filter((post) => post.id !== pinnedPost.id);

        if (featuredNewsSection) featuredNewsSection.hidden = false;
        renderFeaturedNews(pinnedPost);

        if (!otherPosts.length) {
          if (newsFeedSection) newsFeedSection.hidden = true;
          newsList.innerHTML = "";
          return;
        }

        if (newsFeedSection) newsFeedSection.hidden = false;
        newsList.innerHTML = otherPosts.map((post) => renderNewsRow(post)).join("");
      } catch (error) {
        renderNewsLoadError(error);
      } finally {
        newsLoadInProgress = false;
        featuredNewsBox.removeAttribute("aria-busy");
        newsList.removeAttribute("aria-busy");
      }
    }

    loadNewsV2();
  }

  /* =========================
   NEWS ARTICLE PAGE
========================= */

const newsArticlePage = document.querySelector(".news-article-page");
const newsArticleBox = document.querySelector("[data-news-article]");
const newsArticleTitle = document.querySelector("[data-news-article-title]");

if (newsArticlePage && newsArticleBox) {
  const loadNewsArticle = async () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const newsSlug = params.get("slug");

      if (!newsSlug) {
        throw new Error("Nyhedens slug mangler.");
      }

      const VCLData = await waitForVCLData("getNewsPosts");
      const posts = await VCLData.getNewsPosts();

      const post = posts.find((item) => {
        return String(item.slug || "").toLowerCase() === newsSlug.toLowerCase();
      });

      if (!post) {
        const notFoundError = new Error("Nyheden blev ikke fundet.");
        notFoundError.code = "VCL_NEWS_NOT_FOUND";
        throw notFoundError;
      }

      const publishedDate = post.published_at || post.created_at;

      const formattedDate = publishedDate
        ? new Intl.DateTimeFormat("da-DK", {
            day: "numeric",
            month: "long",
            year: "numeric"
          }).format(new Date(publishedDate))
        : "";

      document.title = `${post.title} — VCL`;

      if (newsArticleTitle) {
        newsArticleTitle.textContent = post.title || "VCL News";
      }

      const bodyParagraphs = String(post.body || post.excerpt || "")
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => {
          return `<p>${escapeHTML(paragraph).replace(/\n/g, "<br>")}</p>`;
        })
        .join("");

      newsArticleBox.innerHTML = `
        <div class="news-article__meta">
          <span>${escapeHTML(post.category || "Announcement")}</span>
          <span>${escapeHTML(formattedDate)}</span>
        </div>

        ${
          post.excerpt
            ? `<p class="news-article__lead">${escapeHTML(post.excerpt)}</p>`
            : ""
        }

        <div class="news-article__body">
          ${bodyParagraphs || "<p>Nyheden har endnu ikke noget indhold.</p>"}
        </div>

        <a class="news-article__back" href="nyheder.html">
          ← Tilbage til nyheder
        </a>
      `;
    } catch (error) {
      console.error("Kunne ikke hente nyheden:", error);

      const isNotFound = error?.code === "VCL_NEWS_NOT_FOUND";

      if (newsArticleTitle) {
        newsArticleTitle.textContent = isNotFound
          ? "Nyhed ikke fundet"
          : "Nyheden kunne ikke indlæses";
      }

      newsArticleBox.innerHTML = `
        <div class="news-article__error">
          <strong>${isNotFound ? "Nyheden blev ikke fundet" : "Nyheden kunne ikke indlæses"}</strong>
          <p>${
            isNotFound
              ? "Opslaget findes muligvis ikke længere eller er ikke publiceret."
              : "Der opstod en midlertidig forbindelsesfejl. Prøv igen om et øjeblik."
          }</p>
          ${
            isNotFound
              ? ""
              : '<a href="#" data-retry-news-article>Prøv igen</a>'
          }
          <a href="nyheder.html">Tilbage til nyheder</a>
        </div>
      `;

      newsArticleBox
        .querySelector("[data-retry-news-article]")
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          newsArticleBox.innerHTML = `
            <div class="news-article__loading">Henter opslag...</div>
          `;
          loadNewsArticle();
        });
    }
  };

  loadNewsArticle();
}

})();