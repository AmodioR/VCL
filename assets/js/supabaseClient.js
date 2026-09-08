(() => {
  "use strict";

  const SUPABASE_URL = "https://rdjgxinrkydadrcxpbmg.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_LkEGcNIxSxvxEeAhnfc2RA_y8Nav972";
  const FALLBACK_CDN = "https://unpkg.com/@supabase/supabase-js@2";

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);

      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.head.appendChild(script);
    });
  }

  async function initializeSupabase() {
    if (!window.supabase) {
      console.warn("Primær Supabase CDN blev ikke klar. Prøver fallback CDN.");

      try {
        await loadScript(FALLBACK_CDN);
      } catch (error) {
        console.error("Supabase fallback CDN kunne ikke indlæses:", error);
      }
    }

    if (!window.supabase) {
      throw new Error(
        "Supabase library kunne ikke indlæses fra hverken primær eller fallback CDN."
      );
    }

    if (!window.vclSupabase) {
      window.vclSupabase = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: window.localStorage,
            storageKey: "vcl-auth-session"
          }
        }
      );
    }

    console.log("VCL Supabase connected");
    return window.vclSupabase;
  }

  window.vclSupabaseReady = initializeSupabase().catch((error) => {
    console.error("VCL Supabase kunne ikke initialiseres:", error);
    throw error;
  });
})();
