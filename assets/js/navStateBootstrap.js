(() => {
  const KEY = "vcl-nav-visual-state-v1";
  const MAX_AGE = 12 * 60 * 60 * 1000;

  const escapeHTML = (value = "") =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const read = () => {
    try {
      const state = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!state?.updatedAt || Date.now() - state.updatedAt > MAX_AGE) return null;
      return state;
    } catch (_) {
      return null;
    }
  };

  const write = (state) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...state, updatedAt: Date.now() }));
    } catch (_) {}
  };

  const button = document.querySelector(".site-header .nav-actions a.btn");
  const cached = read();

  if (button && cached?.loggedIn && cached.displayName) {
    const initial = String(cached.displayName).trim().charAt(0).toUpperCase() || "V";
    button.href = "account.html";
    button.classList.remove("auth-nav-ready");
    button.classList.add("nav-account-trigger");
    button.innerHTML = `
      <span class="nav-account-trigger__avatar">${cached.avatarUrl ? `<img src="${escapeHTML(cached.avatarUrl)}" alt="">` : escapeHTML(initial)}</span>
      <span class="nav-account-trigger__label">${escapeHTML(cached.displayName)}</span>
      <span class="nav-account-trigger__chevron" aria-hidden="true"></span>
    `;
  } else if (button && cached?.loggedIn === false) {
    button.href = "login.html";
    button.classList.remove("nav-account-trigger");
    button.classList.add("auth-nav-ready");
    button.innerHTML = "<span>Login</span>";
  }

  const syncFromLiveNav = () => {
    const liveButton = document.querySelector(".site-header .nav-actions a.btn");
    if (!liveButton) return;

    if (liveButton.classList.contains("nav-account-trigger")) {
      const displayName = liveButton.querySelector(".nav-account-trigger__label")?.textContent?.trim();
      const avatarUrl = liveButton.querySelector(".nav-account-trigger__avatar img")?.getAttribute("src") || "";
      if (displayName) write({ loggedIn: true, displayName, avatarUrl });
      return;
    }

    const label = liveButton.textContent?.trim().toLowerCase();
    if (label === "login") write({ loggedIn: false });
  };

  const navActions = document.querySelector(".site-header .nav-actions");
  if (navActions) {
    new MutationObserver(syncFromLiveNav).observe(navActions, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    });
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-nav-account-logout], [data-logout-button]")) {
      write({ loggedIn: false });
    }
  }, true);

  syncFromLiveNav();
})();
