(async () => {
  "use strict";

  const section = document.querySelector("[data-roster-activity-section]");
  const list = document.querySelector("[data-roster-activity-list]");
  const count = document.querySelector("[data-roster-activity-count]");
  const moreWrap = document.querySelector("[data-roster-activity-more-wrap]");
  const moreButton = document.querySelector("[data-roster-activity-more]");

  if (!section || !list) return;

  let db = window.vclSupabase;

  if (!db && window.vclSupabaseReady) {
    try {
      db = await window.vclSupabaseReady;
    } catch (error) {
      console.warn("Roster activity kunne ikke vente på Supabase:", error);
    }
  }

  const escapeHTML = (value = "") =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const playerLink = (activity) => {
    const label = escapeHTML(activity.player_alias || "Ukendt spiller");
    const slug = String(activity.player_slug || "").trim();

    return slug
      ? `<a href="player-profile.html?player=${encodeURIComponent(slug)}">${label}</a>`
      : `<strong>${label}</strong>`;
  };

  const teamLink = (name, slug, fallback = "holdet") => {
    const label = escapeHTML(name || fallback);
    const cleanSlug = String(slug || "").trim();

    return cleanSlug
      ? `<a href="team-profile.html?team=${encodeURIComponent(cleanSlug)}">${label}</a>`
      : `<strong>${label}</strong>`;
  };

  const tournamentLink = (activity) => {
    const label = escapeHTML(activity.tournament_name || "turneringen");
    const slug = String(activity.tournament_slug || "").trim();

    return slug
      ? `<a href="turnering.html?tournament=${encodeURIComponent(slug)}">${label}</a>`
      : `<strong>${label}</strong>`;
  };

  const formatRelativeTime = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const diffMs = date.getTime() - Date.now();
    const absMs = Math.abs(diffMs);
    const rtf = new Intl.RelativeTimeFormat("da-DK", { numeric: "auto" });

    if (absMs < 60_000) return "lige nu";
    if (absMs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), "minute");
    if (absMs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), "hour");
    if (absMs < 604_800_000) return rtf.format(Math.round(diffMs / 86_400_000), "day");

    return new Intl.DateTimeFormat("da-DK", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(date);
  };

  const eventLabel = (eventType) => {
    const labels = {
      transfer: "Transfer",
      signed_free_agent: "Signing",
      became_free_agent: "Free Agent",
      joined_roster_market: "Ny spiller",
      joined_team: "Nyt hold",
      loan_from_team: "Loan",
      loan_free_agent: "Stand-in"
    };

    return labels[eventType] || "Roster move";
  };

  const eventMessage = (activity) => {
    const player = playerLink(activity);
    const fromTeam = teamLink(activity.from_team_name, activity.from_team_slug, "tidligere hold");
    const toTeam = teamLink(activity.to_team_name, activity.to_team_slug, "nyt hold");
    const tournament = tournamentLink(activity);

    switch (activity.event_type) {
      case "transfer":
        return `${player} skiftede fra ${fromTeam} til ${toTeam}.`;
      case "signed_free_agent":
        return `${toTeam} hentede ${player} fra Free Agency.`;
      case "became_free_agent":
        return `${player} er nu Free Agent efter at have forladt ${fromTeam}.`;
      case "joined_roster_market":
        return `${player} er ny på VCL Roster Market.`;
      case "joined_team":
        return `${player} sluttede sig til ${toTeam}.`;
      case "loan_from_team":
        return `${toTeam} lånte ${player} fra ${fromTeam} til ${tournament}.`;
      case "loan_free_agent":
        return `${toTeam} hentede Free Agent ${player} som stand-in til ${tournament}.`;
      default:
        return `${player} har lavet et roster move.`;
    }
  };

  const teamMark = ({ name, slug, logo }, fallbackText) => {
    if (!name && !slug && !logo) {
      return `<span class="roster-activity-route__free-agent">${escapeHTML(fallbackText)}</span>`;
    }

    const label = escapeHTML(name || fallbackText);
    const image = logo
      ? `<img src="${escapeHTML(logo)}" alt="" loading="lazy">`
      : `<span>${escapeHTML((name || fallbackText).charAt(0).toUpperCase())}</span>`;

    const content = `
      <span class="roster-activity-route__logo">${image}</span>
      <small>${label}</small>
    `;

    return slug
      ? `<a class="roster-activity-route__team" href="team-profile.html?team=${encodeURIComponent(slug)}">${content}</a>`
      : `<span class="roster-activity-route__team">${content}</span>`;
  };

  const renderRoute = (activity) => {
    const from = teamMark(
      {
        name: activity.from_team_name,
        slug: activity.from_team_slug,
        logo: activity.from_team_logo_url
      },
      "Free Agent"
    );

    const to = teamMark(
      {
        name: activity.to_team_name,
        slug: activity.to_team_slug,
        logo: activity.to_team_logo_url
      },
      "Free Agent"
    );

    if (activity.event_type === "joined_roster_market") {
      return `<span class="roster-activity-route__free-agent">Roster Market</span>`;
    }

    return `${from}<span class="roster-activity-route__arrow" aria-hidden="true">→</span>${to}`;
  };

  const renderPlayerAvatar = (activity) => {
    const alias = String(activity.player_alias || "V");
    const initial = escapeHTML(alias.trim().charAt(0).toUpperCase() || "V");
    const avatar = activity.player_avatar_url
      ? `<img src="${escapeHTML(activity.player_avatar_url)}" alt="" loading="lazy">`
      : "";

    return `<span class="roster-activity-row__avatar" aria-hidden="true"><b>${initial}</b>${avatar}</span>`;
  };

  let activities = [];
  let visibleCount = 8;
  let refreshTimer = null;

  const render = () => {
    if (count) count.textContent = String(activities.length);

    if (!activities.length) {
      list.innerHTML = `
        <div class="roster-activity-empty">
          <strong>Ingen roster moves registreret endnu</strong>
          <p>Transfers, signings, stand-ins og nye Free Agents bliver automatisk vist her, når de sker.</p>
        </div>
      `;

      if (moreWrap) moreWrap.hidden = true;
      return;
    }

    list.innerHTML = activities
      .slice(0, visibleCount)
      .map((activity) => `
        <article class="roster-activity-row" data-event-type="${escapeHTML(activity.event_type || "roster_move")}">
          <div class="roster-activity-row__time">
            <time datetime="${escapeHTML(activity.created_at || "")}">${escapeHTML(formatRelativeTime(activity.created_at))}</time>
            <span>${escapeHTML(eventLabel(activity.event_type))}</span>
          </div>

          <div class="roster-activity-row__story">
            ${renderPlayerAvatar(activity)}
            <p>${eventMessage(activity)}</p>
          </div>

          <div class="roster-activity-route" aria-label="Roster move">
            ${renderRoute(activity)}
          </div>
        </article>
      `)
      .join("");

    if (moreWrap) {
      moreWrap.hidden = activities.length <= visibleCount;
    }
  };

  const renderError = (error) => {
    console.warn("Roster activity kunne ikke indlæses:", error);

    if (count) count.textContent = "—";
    if (moreWrap) moreWrap.hidden = true;

    list.innerHTML = `
      <div class="roster-activity-empty roster-activity-empty--error">
        <strong>Transferhistorikken kunne ikke indlæses</strong>
        <p>Kør den nye Roster Activity-migration i Supabase og genindlæs siden.</p>
      </div>
    `;
  };

  const loadActivity = async ({ quiet = false } = {}) => {
    if (!db) {
      renderError(new Error("Supabase er ikke klar."));
      return;
    }

    if (!quiet) list.setAttribute("aria-busy", "true");

    const { data, error } = await db
      .from("public_roster_activity_view")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      renderError(error);
      list.removeAttribute("aria-busy");
      return;
    }

    activities = Array.isArray(data) ? data : [];
    render();
    list.removeAttribute("aria-busy");
  };

  moreButton?.addEventListener("click", () => {
    visibleCount += 8;
    render();
  });

  await loadActivity();

  refreshTimer = window.setInterval(() => {
    if (!document.hidden) loadActivity({ quiet: true });
  }, 60_000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadActivity({ quiet: true });
  });

  window.addEventListener("beforeunload", () => {
    if (refreshTimer) window.clearInterval(refreshTimer);
  });
})();
