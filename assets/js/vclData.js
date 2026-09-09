(async () => {
  let db = window.vclSupabase;

  if (!db && window.vclSupabaseReady) {
    try {
      db = await window.vclSupabaseReady;
    } catch (error) {
      console.error("vclSupabase blev ikke klar:", error);
      return;
    }
  }

  if (!db) {
    console.error("vclSupabase mangler. Tjek supabaseClient.js.");
    return;
  }

  function normalizeLeaderboardRow(row, fallbackRank = 0) {
    const wins = row.wins || {};
    const rank = Number(row.leaderboard_rank ?? row.rank ?? fallbackRank) || fallbackRank;
    const playerSlug = row.player_slug || row.playerId || row.slug || "";
    const championshipWins = Number(row.championship_wins ?? wins.championship ?? 0);
    const contenderWins = Number(row.contender_wins ?? wins.contender ?? 0);
    const academyWins = Number(row.academy_wins ?? wins.academy ?? 0);

    return {
      ...row,
      rank,
      leaderboard_rank: rank,

      playerId: playerSlug,
      player_slug: playerSlug,
      slug: playerSlug,

      alias: row.alias || playerSlug,
      points: Number(row.points ?? 0),

      tier: row.level || row.tier || "default",
      level: row.level || row.tier || "",

      primary_role: row.primary_role || row.primaryRole || "",
      current_team_id: row.current_team_id || row.currentTeamId || "",
      current_team_name: row.current_team_name || row.currentTeamName || "",
      current_team_slug: row.current_team_slug || row.currentTeamSlug || "",
      current_team_logo_url:
        row.current_team_logo_url || row.team_logo_url || row.teamLogo || "",

      championship_wins: championshipWins,
      contender_wins: contenderWins,
      academy_wins: academyWins,

      wins: {
        championship: championshipWins,
        contender: contenderWins,
        academy: academyWins
      },

      placements: Array.isArray(row.placements) ? row.placements : []
    };
  }

  function formatTeamTagline(team) {
  const savedTagline = String(team.tagline || "").trim();

  if (savedTagline) {
    return savedTagline;
  }

  return `${team.tier || "VCL"} roster`;
}

  window.VCLData = {
    /* =========================
       AUTH / ACCOUNT
    ========================= */

    async signUpAccount({ email, password, alias, discord }) {
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
          data: {
            alias: alias || "",
            discord: discord || ""
          }
        }
      });

      if (error) {
        console.error("Kunne ikke oprette account:", error);
        throw error;
      }

      return data;
    },

    async loginAccount({ email, password }) {
      const { data, error } = await db.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        console.error("Kunne ikke logge ind:", error);
        throw error;
      }

      return data;
    },

    async adminValidateTeamSignup(signupId) {
  const { data, error } = await db.rpc("admin_validate_team_signup", {
    p_signup_id: signupId
  });

  if (error) {
    console.error("Kunne ikke validere team signup:", error);
    throw error;
  }

  return data || {
    valid: false,
    errors: ["Kunne ikke validere signup."],
    warnings: []
  };
},

    async isProfileUsernameAvailable(username, excludeProfileId = null) {
  const { data, error } = await db.rpc("is_profile_username_available", {
    p_username: username,
    p_exclude_profile_id: excludeProfileId
  });

  if (error) {
    console.error("Kunne ikke tjekke username:", error);
    throw error;
  }

  return Boolean(data);
},

    async logoutAccount() {
      const { error } = await db.auth.signOut();

      if (error) {
        console.error("Kunne ikke logge ud:", error);
        throw error;
      }

      return true;
    },

    async getSession() {
      const { data, error } = await db.auth.getSession();

      if (error) {
        console.error("Kunne ikke hente session:", error);
        return null;
      }

      return data.session;
    },

    async getCurrentUser() {
      const { data, error } = await db.auth.getUser();

      if (error) {
        console.error("Kunne ikke hente bruger:", error);
        return null;
      }

      return data.user;
    },

    async getCurrentProfile() {
      const user = await this.getCurrentUser();

      if (!user) return null;

      const { data, error } = await db
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (error) {
        console.error("Kunne ikke hente profile:", error);
        return null;
      }

      return data;
    },

    async getAdminNewsPosts() {
  const { data, error } = await db
    .from("news_posts_view")
    .select("*")
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Kunne ikke hente admin news posts:", error);
    return [];
  }

  return data || [];
},

async createNewsPost(post) {
  const user = await this.getCurrentUser();

  if (!user) {
    throw new Error("Du skal være logget ind for at oprette nyheder.");
  }

  const slugBase = String(post.title || "")
    .toLowerCase()
    .trim()
    .replaceAll("æ", "ae")
    .replaceAll("ø", "oe")
    .replaceAll("å", "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const slug = `${slugBase || "vcl-news"}-${Date.now()}`;

  const status = post.status || "draft";

  const { data, error } = await db
    .from("news_posts")
    .insert({
      slug,
      title: post.title || "",
      excerpt: post.excerpt || "",
      body: post.body || "",
      category: post.category || "Announcement",
      status,
      is_pinned: Boolean(post.is_pinned),
      author_profile_id: user.id,
      published_at: status === "published" ? new Date().toISOString() : null
    })
    .select()
    .single();

  if (error) {
    console.error("Kunne ikke oprette news post:", error);
    throw error;
  }

  return data;
},

async updateNewsPost(postId, updates) {
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  );

  if (cleanUpdates.status === "published" && !cleanUpdates.published_at) {
    cleanUpdates.published_at = new Date().toISOString();
  }

  const { data, error } = await db
    .from("news_posts")
    .update(cleanUpdates)
    .eq("id", postId)
    .select()
    .single();

  if (error) {
    console.error("Kunne ikke opdatere news post:", error);
    throw error;
  }

  return data;
},

async deleteNewsPost(postId) {
  const { error } = await db
    .from("news_posts")
    .delete()
    .eq("id", postId);

  if (error) {
    console.error("Kunne ikke slette news post:", error);
    throw error;
  }

  return true;
},

async getAdminTeamSignups() {
  const { data, error } = await db
    .from("team_signups")
    .select(`
      *,
      tournaments:tournament_id (
        id,
        slug,
        name,
        status,
        starts_at
      ),
      approved_team:approved_team_id (
        id,
        slug,
        name
      )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Kunne ikke hente team signups:", error);
    throw error;
  }

  return (data || []).map((signup) => ({
    ...signup,
    tournament_label:
      signup.tournaments?.name || signup.tournament_label || signup.series_slug || "VCL Signup",
    tournament_slug:
      signup.tournaments?.slug || signup.tournament_slug || "",
    approved_team_slug:
      signup.approved_team?.slug || signup.approved_team_slug || ""
  }));
},

async adminApproveTeamSignup(signupId) {
  const { data, error } = await db.rpc("admin_approve_team_signup_linked", {
    p_signup_id: signupId
  });

  if (error) {
    console.error("Kunne ikke approve team signup:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},

async getAdminSignupClaimTargets(signupId) {
  const { data, error } = await db
    .from("admin_signup_claim_targets_view")
    .select("*")
    .eq("signup_id", signupId)
    .order("roster_status", { ascending: true })
    .order("player_alias", { ascending: true });

  if (error) {
    console.error("Kunne ikke hente signup claim targets:", error);
    throw error;
  }

  return data || [];
},

async adminRejectTeamSignup(signupId, adminNote = "") {
  const { data, error } = await db.rpc("admin_reject_team_signup", {
    p_signup_id: signupId,
    p_admin_note: adminNote
  });

  if (error) {
    console.error("Kunne ikke reject team signup:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},

async captainSwapRosterMembers(memberAId, memberBId) {
  const { data, error } = await db.rpc("captain_swap_roster_members", {
    p_member_a_id: memberAId,
    p_member_b_id: memberBId
  });

  if (error) {
    console.error("Kunne ikke swap roster members:", error);
    throw error;
  }

  return data;
},

async getAdminUnclaimedProfiles() {
  const { data, error } = await db
    .from("admin_unclaimed_profiles_view")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Kunne ikke hente unclaimed profiles:", error);
    return [];
  }

  return data || [];
},

async adminCreateClaimInvite(playerId) {
  const { data, error } = await db.rpc("admin_create_claim_invite", {
    p_player_id: playerId
  });

  if (error) {
    console.error("Kunne ikke lave admin claim invite:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},

async getMyPlayerAvatarStatus() {
  const { data, error } = await db.rpc("get_my_player_avatar_status");
  if (error) {
    console.error("Kunne ikke hente avatarstatus:", error);
    throw error;
  }
  return data || null;
},

async uploadMyPendingPlayerAvatar(blob) {
  const user = await this.getCurrentUser();
  if (!user) throw new Error("Du skal være logget ind for at uploade et profilbillede.");
  if (!(blob instanceof Blob) || blob.type !== "image/webp") {
    throw new Error("Profilbilledet skal behandles som WEBP før upload.");
  }
  if (blob.size > 600000) {
    throw new Error("Det behandlede profilbillede er stadig for stort.");
  }

  const token = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const storagePath = `${user.id}/${Date.now()}-${token}.webp`;

  const { error: uploadError } = await db.storage
    .from("player-avatar-pending")
    .upload(storagePath, blob, { contentType: "image/webp", upsert: false, cacheControl: "3600" });

  if (uploadError) {
    console.error("Kunne ikke uploade pending avatar:", uploadError);
    throw uploadError;
  }

  const { data, error } = await db.rpc("submit_my_player_avatar", {
    p_storage_path: storagePath
  });

  if (error) {
    await db.storage.from("player-avatar-pending").remove([storagePath]);
    console.error("Kunne ikke registrere avatar til godkendelse:", error);
    throw error;
  }

  if (data?.previous_pending_storage_path) {
    await db.storage
      .from("player-avatar-pending")
      .remove([data.previous_pending_storage_path]);
  }

  return data;
},

async createMyPendingAvatarPreview(storagePath, expiresIn = 900) {
  if (!storagePath) return null;
  const { data, error } = await db.storage
    .from("player-avatar-pending")
    .createSignedUrl(storagePath, expiresIn);
  if (error) return null;
  return data?.signedUrl || null;
},

async removeMyPlayerAvatar() {
  const { data, error } = await db.rpc("remove_my_player_avatar");
  if (error) {
    console.error("Kunne ikke fjerne profilbillede:", error);
    throw error;
  }
  if (data?.previous_storage_path) {
    await db.storage.from("player-avatars").remove([data.previous_storage_path]);
  }
  return data;
},

async getAdminPendingPlayerAvatars() {
  const { data, error } = await db.rpc("admin_get_pending_player_avatars");
  if (error) {
    console.error("Kunne ikke hente pending profilbilleder:", error);
    throw error;
  }

  return Promise.all((data || []).map(async (row) => {
    const { data: signedData } = await db.storage
      .from("player-avatar-pending")
      .createSignedUrl(row.pending_storage_path, 900);
    return { ...row, pending_preview_url: signedData?.signedUrl || null };
  }));
},

async adminApprovePlayerAvatar(submission) {
  if (!submission?.submission_id || !submission?.pending_storage_path || !submission?.player_id) {
    throw new Error("Avatar submission mangler nødvendige data.");
  }

  const { data: pendingBlob, error: downloadError } = await db.storage
    .from("player-avatar-pending")
    .download(submission.pending_storage_path);
  if (downloadError) throw downloadError;

  const token = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const approvedPath = `${submission.player_id}/${Date.now()}-${token}.webp`;

  const { error: uploadError } = await db.storage
    .from("player-avatars")
    .upload(approvedPath, pendingBlob, { contentType: "image/webp", upsert: false, cacheControl: "31536000" });
  if (uploadError) throw uploadError;

  const { data: publicData } = db.storage.from("player-avatars").getPublicUrl(approvedPath);
  const publicUrl = publicData?.publicUrl;

  const { data, error } = await db.rpc("admin_review_player_avatar", {
    p_submission_id: submission.submission_id,
    p_decision: "approve",
    p_approved_avatar_url: publicUrl,
    p_approved_storage_path: approvedPath,
    p_reject_reason: null
  });

  if (error) {
    await db.storage.from("player-avatars").remove([approvedPath]);
    throw error;
  }

  await db.storage.from("player-avatar-pending").remove([submission.pending_storage_path]);
  if (data?.previous_avatar_storage_path && data.previous_avatar_storage_path !== approvedPath) {
    await db.storage.from("player-avatars").remove([data.previous_avatar_storage_path]);
  }
  return data;
},

async adminRejectPlayerAvatar(submission, reason = "") {
  const { data, error } = await db.rpc("admin_review_player_avatar", {
    p_submission_id: submission.submission_id,
    p_decision: "reject",
    p_approved_avatar_url: null,
    p_approved_storage_path: null,
    p_reject_reason: reason || null
  });
  if (error) throw error;
  if (submission?.pending_storage_path) {
    await db.storage.from("player-avatar-pending").remove([submission.pending_storage_path]);
  }
  return data;
},

async getNewsPosts() {
  const fields = [
    "id",
    "slug",
    "title",
    "excerpt",
    "body",
    "category",
    "status",
    "is_pinned",
    "published_at",
    "created_at"
  ].join(",");

  const sources = ["public_news_posts_view"];

  let lastError = null;

  for (const source of sources) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller =
        typeof AbortController === "function" ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), 6500)
        : null;

      let data = null;
      let error = null;

      try {
        let query = db
          .from(source)
          .select(fields)
          .eq("status", "published")
          .order("is_pinned", { ascending: false })
          .order("published_at", { ascending: false })
          .order("created_at", { ascending: false });

        if (controller && typeof query.abortSignal === "function") {
          query = query.abortSignal(controller.signal);
        }

        const response = await query;
        data = response.data;
        error = response.error;
      } catch (requestError) {
        error = requestError;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      if (!error) {
        return data || [];
      }

      lastError = error;
      console.warn(
        `Kunne ikke hente public news fra ${source} (forsøg ${attempt}/2):`,
        error
      );

      const isConfigurationError = [
        "42P01", // relation does not exist
        "42501", // permission denied
        "PGRST205" // table/view not present in the schema cache
      ].includes(error.code);

      if (isConfigurationError || attempt === 2) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }

  const publicError = new Error(
    "Nyhederne kunne ikke hentes fra Supabase. Prøv igen om et øjeblik."
  );
  publicError.cause = lastError;
  throw publicError;
},

    async updateCurrentProfile(updates) {
      const user = await this.getCurrentUser();

      if (!user) {
        throw new Error("Du skal være logget ind for at opdatere din profil.");
      }

      const allowedUpdates = {
        display_name: updates.display_name || "",
        discord: updates.discord || "",
        avatar_url: updates.avatar_url || null
      };

      const { data, error } = await db
        .from("profiles")
        .update(allowedUpdates)
        .eq("id", user.id)
        .select()
        .single();

      if (error) {
        console.error("Kunne ikke opdatere profile:", error);
        throw error;
      }

      return data;
    },

    async getMyClaimedPlayer() {
  const user = await this.getCurrentUser();

  if (!user) return null;

  const { data, error } = await db
    .from("players")
    .select("*")
    .eq("claimed_by_profile_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Kunne ikke hente claimed player:", error);
    return null;
  }

  return data;
},

async updateMyClaimedPlayer(updates) {
  const user = await this.getCurrentUser();

  if (!user) {
    throw new Error("Du skal være logget ind for at opdatere din player profile.");
  }

  const allowedUpdates = {
    discord: updates.discord || "",
    primary_role: updates.primary_role || "",
    level: updates.level || "",
    bio: updates.bio || "",
    is_free_agent: Boolean(updates.is_free_agent),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from("players")
    .update(allowedUpdates)
    .eq("claimed_by_profile_id", user.id)
    .select()
    .single();

  if (error) {
    console.error("Kunne ikke opdatere claimed player:", error);
    throw error;
  }

  return data;
},

async createMyFreeAgentProfile(profile) {
  const { data, error } = await db.rpc("create_my_free_agent_profile", {
    p_alias: profile.alias || "",
    p_discord: profile.discord || "",
    p_primary_role: profile.primary_role || "",
    p_level: profile.level || "",
    p_bio: profile.bio || ""
  });

  if (error) {
    console.error("Kunne ikke oprette Free Agent profile:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},
async getMyCaptainTeam() {
  const claimedPlayer = await this.getMyClaimedPlayer();

  if (!claimedPlayer) {
    return null;
  }

  const { data: team, error: teamError } = await db
    .from("teams")
    .select("*")
    .eq("captain_player_id", claimedPlayer.id)
    .maybeSingle();

  if (teamError) {
    console.error("Kunne ikke hente captain team:", teamError);
    return null;
  }

  if (!team) {
    return null;
  }

  const { data: members, error: membersError } = await db
    .from("team_members")
    .select(`
      id,
      player_id,
      member_role,
      roster_status,
      joined_at,
      players (
  id,
  slug,
  alias,
  primary_role,
  claim_status,
  claimed_by_profile_id
)
    `)
    .eq("team_id", team.id)
    .is("left_at", null);

  if (membersError) {
    console.error("Kunne ikke hente captain team roster:", membersError);
    return {
      team,
      captain_player: claimedPlayer,
      members: []
    };
  }

  return {
    team,
    captain_player: claimedPlayer,
    members: members || []
  };
},

async captainCreateClaimInvite(playerId) {
  const { data, error } = await db.rpc("captain_create_claim_invite", {
    p_player_id: playerId
  });

  if (error) {
    console.error("Kunne ikke lave claim invite:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},

async getClaimInviteByToken(token) {
  const { data, error } = await db.rpc("get_claim_invite_by_token", {
    p_token: token
  });

  if (error) {
    console.error("Kunne ikke hente claim invite:", error);
    return null;
  }

  return Array.isArray(data) ? data[0] : data;
},

async acceptClaimInvite(token) {
  const { data, error } = await db.rpc("accept_claim_invite", {
    p_token: token
  });

  if (error) {
    console.error("Kunne ikke claime player profile:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},
async updateMyCaptainTeam(updates) {
  const { data, error } = await db.rpc("update_my_captain_team", {
    p_name: updates.name || "",
    p_tagline: updates.tagline || "",
    p_description: updates.description || "",
    p_tier: updates.tier || "Academy",
    p_status: updates.status || "active"
  });

  if (error) {
    console.error("Kunne ikke opdatere captain team:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},

async updateMyCaptainTeamLogo(logoUrl) {
  const cleanLogoUrl = String(logoUrl || "").trim();

  if (!cleanLogoUrl) {
    throw new Error("Logo URL mangler.");
  }

  const { data, error } = await db.rpc("update_my_captain_team_logo", {
    p_logo_url: cleanLogoUrl
  });

  if (error) {
    console.error("Kunne ikke opdatere captain team logo:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},

async transferMyTeamCaptain(newCaptainPlayerId) {
  const { data, error } = await db.rpc("transfer_my_team_captain", {
    p_new_captain_player_id: newCaptainPlayerId
  });

  if (error) {
    console.error("Kunne ikke overdrage captain:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},

async captainRemoveRosterMember(teamMemberId) {
  const { data, error } = await db.rpc("captain_remove_roster_member", {
    p_team_member_id: teamMemberId
  });

  if (error) {
    console.error("Kunne ikke fjerne spiller fra roster:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},

    /* =========================
       TOURNAMENTS
    ========================= */

    async getPublicTournaments() {
      const { data, error } = await db
        .from("public_tournaments_view")
        .select("*")
        .order("starts_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Kunne ikke hente turneringer:", error);
        throw error;
      }

      return data || [];
    },


    async getMyActiveTeamContext() {
      const user = await this.getCurrentUser();
      if (!user) return null;

      const { data, error } = await db.rpc("get_my_active_team_context");

      if (error) {
        console.error("Kunne ikke hente aktiv team-kontekst:", error);
        throw error;
      }

      return Array.isArray(data) ? data[0] || null : data || null;
    },

    async getMyTeamTournamentEntries() {
      const user = await this.getCurrentUser();
      if (!user) return [];

      const { data, error } = await db.rpc("get_my_team_tournament_entries");

      if (error) {
        console.error("Kunne ikke hente holdets turneringstilmeldinger:", error);
        throw error;
      }

      return data || [];
    },

    async getLiveTournamentMatches() {
      const [{ data: matches, error: matchesError }, { data: liveTournaments, error: tournamentsError }] = await Promise.all([
        db
          .from("public_tournament_matches_view")
          .select("*")
          .eq("status", "live")
          .order("updated_at", { ascending: false }),
        db
          .from("tournaments")
          .select("*")
          .eq("status", "live")
          .order("updated_at", { ascending: false })
      ]);

      if (matchesError) {
        console.warn("Kunne ikke hente live turneringskampe:", matchesError);
      }

      if (tournamentsError) {
        console.warn("Kunne ikke hente live turneringer:", tournamentsError);
      }

      const liveMatchRows = Array.isArray(matches) ? matches : [];
      const tournamentRows = Array.isArray(liveTournaments) ? liveTournaments : [];
      const tournamentIdsFromMatches = [
        ...new Set(liveMatchRows.map((match) => match.tournament_id).filter(Boolean))
      ];

      let matchTournaments = [];

      if (tournamentIdsFromMatches.length) {
        const { data, error } = await db
          .from("tournaments")
          .select("*")
          .in("id", tournamentIdsFromMatches);

        if (error) {
          console.warn("Kunne ikke hente turneringerne til live-kampene:", error);
        } else {
          matchTournaments = data || [];
        }
      }

      const tournamentMap = new Map();
      [...tournamentRows, ...matchTournaments].forEach((tournament) => {
        if (tournament?.id) tournamentMap.set(tournament.id, tournament);
      });

      const enrichedMatches = liveMatchRows.map((match) => {
        const tournament = tournamentMap.get(match.tournament_id) || {};
        const streamUrl = match.twitch_url || tournament.stream_url || null;

        return {
          ...match,
          twitch_url: streamUrl,
          tournament_stream_url: tournament.stream_url || null,
          tournament_name: tournament.name || "VCL-turnering",
          tournament_slug: tournament.slug || "",
          tournament_series_slug: tournament.series_slug || "",
          tournament_status: tournament.status || "live",
          broadcast_only: false
        };
      });

      const tournamentsWithLiveMatch = new Set(
        enrichedMatches.map((match) => match.tournament_id).filter(Boolean)
      );

      const tournamentOnlyBroadcasts = tournamentRows
        .filter((tournament) => !tournamentsWithLiveMatch.has(tournament.id))
        .map((tournament) => ({
          id: `tournament-${tournament.id}`,
          tournament_id: tournament.id,
          tournament_name: tournament.name || "VCL-turnering",
          tournament_slug: tournament.slug || "",
          tournament_series_slug: tournament.series_slug || "",
          tournament_status: tournament.status || "live",
          twitch_url: tournament.stream_url || null,
          tournament_stream_url: tournament.stream_url || null,
          updated_at: tournament.updated_at || tournament.starts_at || tournament.created_at,
          status: "live",
          broadcast_only: true
        }));

      return [...enrichedMatches, ...tournamentOnlyBroadcasts].sort((a, b) => {
        const matchDifference = Number(Boolean(a.broadcast_only)) - Number(Boolean(b.broadcast_only));
        if (matchDifference !== 0) return matchDifference;

        const streamDifference = Number(Boolean(b.twitch_url)) - Number(Boolean(a.twitch_url));
        if (streamDifference !== 0) return streamDifference;

        return (
          new Date(b.updated_at || 0).getTime() -
          new Date(a.updated_at || 0).getTime()
        );
      });
    },

    async getTournamentBySlug(slug) {
      const { data, error } = await db
        .from("public_tournaments_view")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();

      if (error) {
        console.error("Kunne ikke hente turneringen:", error);
        return null;
      }

      return data;
    },

    async getTournamentEntries(tournamentId) {
      const { data, error } = await db
        .from("public_tournament_entries_view")
        .select("*")
        .eq("tournament_id", tournamentId)
        .order("seed", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Kunne ikke hente turneringshold:", error);
        return [];
      }

      return data || [];
    },

    async getTournamentMatches(tournamentId) {
      const { data, error } = await db
        .from("public_tournament_matches_view")
        .select("*")
        .eq("tournament_id", tournamentId)
        .order("round_number", { ascending: true })
        .order("match_number", { ascending: true });

      if (error) {
        console.error("Kunne ikke hente turneringskampe:", error);
        return [];
      }

      return data || [];
    },

    async getAdminTournaments() {
      const { data, error } = await db
        .from("tournaments")
        .select("*")
        .order("starts_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Kunne ikke hente admin turneringer:", error);
        throw error;
      }

      return data || [];
    },

    async createTournament(tournament) {
      const user = await this.getCurrentUser();
      if (!user) throw new Error("Du skal være logget ind som admin.");

      const { data, error } = await db
        .from("tournaments")
        .insert({ ...tournament, created_by: user.id })
        .select()
        .single();

      if (error) {
        console.error("Kunne ikke oprette turnering:", error);
        throw error;
      }

      return data;
    },

    async updateTournament(tournamentId, updates) {
      const { data, error } = await db
        .from("tournaments")
        .update(updates)
        .eq("id", tournamentId)
        .select()
        .single();

      if (error) {
        console.error("Kunne ikke opdatere turnering:", error);
        throw error;
      }

      return data;
    },

    async deleteTournament(tournamentId) {
      if (!tournamentId) throw new Error("Turnerings-id mangler.");

      const { error } = await db
        .from("tournaments")
        .delete()
        .eq("id", tournamentId);

      if (error) {
        console.error("Kunne ikke slette turnering:", error);
        throw error;
      }

      return true;
    },

    async getAdminTournamentEntries(tournamentId) {
      const { data, error } = await db
        .from("tournament_entries")
        .select(`
          *,
          teams:team_id (
            id,
            slug,
            name,
            logo_url
          )
        `)
        .eq("tournament_id", tournamentId)
        .order("seed", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Kunne ikke hente admin tournament entries:", error);
        return [];
      }

      return data || [];
    },

    async updateTournamentEntry(entryId, updates) {
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([, value]) => value !== undefined)
      );

      const { data, error } = await db
        .from("tournament_entries")
        .update(cleanUpdates)
        .eq("id", entryId)
        .select()
        .single();

      if (error) {
        console.error("Kunne ikke opdatere tournament entry:", error);
        throw error;
      }

      return data;
    },


    async reviewTournamentEntry(entryId, decision, adminNote = "") {
      const { data, error } = await db.rpc("admin_review_tournament_entry", {
        p_entry_id: entryId,
        p_decision: decision,
        p_admin_note: adminNote || null
      });

      if (error) {
        console.error("Kunne ikke behandle tournament entry:", error);
        throw error;
      }

      return Array.isArray(data) ? data[0] || null : data || null;
    },

    async generateTournamentBracket(tournamentId) {
      const { data, error } = await db.rpc(
        "admin_generate_single_elimination_bracket",
        { p_tournament_id: tournamentId }
      );

      if (error) {
        console.error("Kunne ikke generere bracket:", error);
        throw error;
      }

      return data;
    },

    async getAdminTournamentMatches(tournamentId) {
      const { data, error } = await db
        .from("public_tournament_matches_view")
        .select("*")
        .eq("tournament_id", tournamentId)
        .order("round_number", { ascending: true })
        .order("match_number", { ascending: true });

      if (error) {
        console.error("Kunne ikke hente admin tournament matches:", error);
        return [];
      }

      return data || [];
    },

    async updateTournamentMatch(matchId, updates) {
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([, value]) => value !== undefined)
      );

      const { data, error } = await db
        .from("tournament_matches")
        .update(cleanUpdates)
        .eq("id", matchId)
        .select()
        .single();

      if (error) {
        console.error("Kunne ikke opdatere turneringskamp:", error);
        throw error;
      }

      return data;
    },


    async completeTournamentMatch({
      matchId,
      winnerTeamId,
      teamAScore = null,
      teamBScore = null,
      scheduledAt = null,
      twitchUrl = null
    }) {
      const { data, error } = await db.rpc("admin_complete_tournament_match", {
        p_match_id: matchId,
        p_winner_team_id: winnerTeamId,
        p_team_a_score: teamAScore,
        p_team_b_score: teamBScore,
        p_scheduled_at: scheduledAt,
        p_twitch_url: twitchUrl
      });

      if (error) {
        console.error("Kunne ikke afslutte turneringskampen:", error);
        throw error;
      }

      return data;
    },

    async getTournamentSettlementPreview(tournamentId) {
      const { data, error } = await db.rpc("admin_preview_tournament_settlement", {
        p_tournament_id: tournamentId
      });

      if (error) {
        console.error("Kunne ikke beregne point-preview:", error);
        throw error;
      }

      return data || null;
    },

    async finalizeTournament(tournamentId) {
      const { data, error } = await db.rpc("admin_finalize_tournament", {
        p_tournament_id: tournamentId
      });

      if (error) {
        console.error("Kunne ikke afslutte turneringen:", error);
        throw error;
      }

      return data || null;
    },

    async getTournamentResults(tournamentId) {
      const { data, error } = await db
        .from("public_tournament_team_results_view")
        .select("*")
        .eq("tournament_id", tournamentId)
        .order("placement", { ascending: true })
        .order("team_name", { ascending: true });

      if (error) {
        console.warn("Kunne ikke hente turneringsresultater:", error);
        return [];
      }

      return data || [];
    },

    onAuthChange(callback) {
      return db.auth.onAuthStateChange(callback);
    },

    /* =========================
       LEADERBOARD / PLAYERS
    ========================= */

    async getLeaderboard() {
      const liveSources = [
        "public_vcl_leaderboard_view"
      ];

      for (const source of liveSources) {
        try {
          const { data, error } = await db
            .from(source)
            .select("*")
            .order("points", { ascending: false })
            .order("championship_wins", { ascending: false })
            .order("contender_wins", { ascending: false })
            .order("academy_wins", { ascending: false })
            .order("alias", { ascending: true });

          if (error) {
            throw error;
          }

          if (Array.isArray(data) && data.length) {
            return data.map((row, index) =>
              normalizeLeaderboardRow(row, index + 1)
            );
          }

          console.warn(`${source} returnerede ingen spillere.`);
        } catch (error) {
          console.warn(`Kunne ikke hente leaderboard fra ${source}:`, error);
        }
      }

      console.warn("Live leaderboard var utilgængeligt.");
      return [];
    },

    async getTeamIdentities() {
      const { data, error } = await db
        .from("teams")
        .select("id, slug, name, logo_url, status")
        .order("name", { ascending: true });

      if (error) {
        console.error("Kunne ikke hente team identities:", error);
        return [];
      }

      return (data || []).map((team) => ({
        id: team.id,
        slug: team.slug,
        name: team.name,
        logo: team.logo_url || "assets/teams/default-team.png",
        logo_url: team.logo_url || "assets/teams/default-team.png",
        status: team.status || ""
      }));
    },

    async getPlayerBySlug(slug) {
  const [{ data, error }, avatarResult] = await Promise.all([
    db
      .from("public_player_profiles_view")
      .select("*")
      .eq("player_slug", slug)
      .maybeSingle(),
    db
      .from("players")
      .select("slug, avatar_url")
      .eq("slug", slug)
      .maybeSingle()
  ]);

  if (error) {
    console.error("Kunne ikke hente player:", error);
    return null;
  }

  return data
    ? { ...data, avatar_url: avatarResult?.data?.avatar_url || data.avatar_url || null }
    : null;
},

    async getPlayerAvatarMap() {
      const { data, error } = await db
        .from("players")
        .select("slug, avatar_url")
        .not("avatar_url", "is", null);

      if (error) {
        console.warn("Kunne ikke hente spilleravatars:", error);
        return {};
      }

      return Object.fromEntries(
        (data || []).filter((row) => row.slug && row.avatar_url).map((row) => [row.slug, row.avatar_url])
      );
    },

    async getPlayerProfileContext(slug) {
      const [player, leaderboard, teams] = await Promise.all([
        this.getPlayerBySlug(slug),
        this.getLeaderboard(),
        this.getTeamIdentities()
      ]);

      if (!player) {
        return null;
      }

      const normalize = (value) =>
        String(value || "")
          .trim()
          .toLocaleLowerCase("da-DK");

      const leaderboardEntry = (leaderboard || []).find((entry) => {
        const entrySlug = entry.player_slug || entry.playerId || entry.slug || "";
        return normalize(entrySlug) === normalize(slug);
      }) || null;

      const currentTeamId =
        player.current_team_id ||
        leaderboardEntry?.current_team_id ||
        "";
      const currentTeamSlug =
        player.current_team_slug ||
        leaderboardEntry?.current_team_slug ||
        "";
      const currentTeamName =
        player.current_team_name ||
        leaderboardEntry?.current_team_name ||
        "";

      const team = (teams || []).find((candidate) => {
        return (
          (currentTeamId && String(candidate.id) === String(currentTeamId)) ||
          (currentTeamSlug && normalize(candidate.slug) === normalize(currentTeamSlug)) ||
          (currentTeamName && normalize(candidate.name) === normalize(currentTeamName))
        );
      }) || null;

      return {
        player,
        leaderboardEntry,
        team: team
          ? {
              id: team.id,
              slug: team.slug,
              name: team.name,
              logo_url: team.logo_url || team.logo || "assets/teams/default-team.png",
              status: team.status || ""
            }
          : null
      };
    },

    async getPlayerHistory(slug) {
      const [historicalResult, tournamentResult] = await Promise.all([
        db
          .from("player_history_view")
          .select("*")
          .eq("player_slug", slug)
          .order("event_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false }),
        db
          .from("public_tournament_player_results_view")
          .select("*")
          .eq("player_slug", slug)
          .order("event_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
      ]);

      if (historicalResult.error) {
        console.warn("Kunne ikke hente historisk player history:", historicalResult.error);
      }
      if (tournamentResult.error) {
        console.warn("Kunne ikke hente tournament player history:", tournamentResult.error);
      }

      const rows = [
        ...(historicalResult.data || []),
        ...(tournamentResult.data || [])
      ];
      const seen = new Set();

      return rows
        .filter((row) => {
          const key = `${row.tournament_id || row.event_name || "event"}:${row.player_id || row.player_slug || slug}:${row.placement || 0}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => {
          const dateA = new Date(a.event_date || a.created_at || 0).getTime();
          const dateB = new Date(b.event_date || b.created_at || 0).getTime();
          return dateB - dateA;
        });
    },

    async getPlayers() {
      const { data: teams, error: teamsError } = await db
        .from("teams")
        .select("id, slug, name");

      if (teamsError) {
        console.error("Kunne ikke hente teams til players:", teamsError);
        return [];
      }

      const teamSlugById = new Map(
        (teams || []).map((team) => [team.id, team.slug])
      );

      const { data, error } = await db
        .from("players")
        .select("*")
        .order("alias", { ascending: true });

      if (error) {
        console.error("Kunne ikke hente players:", error);
        return [];
      }

      return (data || []).map((player) => ({
        id: player.slug,
        alias: player.alias,
        country: "DK",
        role: player.primary_role || "Player",
        status: player.claim_status === "retired" ? "inactive" : "active",
        currentTeamId: player.current_team_id
          ? teamSlugById.get(player.current_team_id) || ""
          : "",
        formerTeamIds: [],
        achievements: [],
        socials: {
          discord: player.discord || "",
          twitch: "",
          x: ""
        }
      }));
    },

  async getFreeAgents() {
  const { data, error } = await db
    .from("players")
    .select(`
      id,
      alias,
      slug,
      discord,
      primary_role,
      level,
      bio,
      avatar_url,
      is_free_agent,
      claim_status,
      current_team_id,
      teams:current_team_id (
        name,
        slug
      )
    `)
    .eq("is_free_agent", true)
    .is("current_team_id", null)
    .neq("claim_status", "retired")
    .order("alias", { ascending: true });

  if (error) {
    console.error("Kunne ikke hente free agents:", error);
    return [];
  }

  return data || [];
},
async sendTeamInviteToFreeAgent(playerId, message = "") {
  const { data, error } = await db.rpc("send_team_invite_to_free_agent", {
    p_player_id: playerId,
    p_message: message
  });

  if (error) {
    console.error("Kunne ikke sende team invite:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},

async getMyTeamInvites() {
  const claimedPlayer = await this.getMyClaimedPlayer();

  // Team invites belong to a VCL player profile, not merely to any logged-in account.
  // Without a claimed player there can therefore never be a valid personal invite.
  if (!claimedPlayer?.id) {
    return [];
  }

  const { data, error } = await db
    .from("team_invites_view")
    .select("*")
    .eq("status", "pending")
    .eq("invited_player_id", claimedPlayer.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Kunne ikke hente mine team invites:", error);
    return [];
  }

  return data || [];
},

async acceptTeamInvite(inviteId) {
  const { data, error } = await db.rpc("accept_team_invite", {
    p_invite_id: inviteId
  });

  if (error) {
    console.error("Kunne ikke acceptere team invite:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},

async declineTeamInvite(inviteId) {
  const { data, error } = await db.rpc("decline_team_invite", {
    p_invite_id: inviteId
  });

  if (error) {
    console.error("Kunne ikke afvise team invite:", error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
},

    /* =========================
       TEAMS
    ========================= */

    async getTeams() {
      const { data: teams, error: teamsError } = await db
        .from("teams")
        .select("*")
        .order("name", { ascending: true });

      if (teamsError) {
        console.error("Kunne ikke hente teams:", teamsError);
        return [];
      }

      const { data: members, error: membersError } = await db
        .from("team_members")
        .select(`
          team_id,
          member_role,
          roster_status,
          left_at,
          players (
            slug,
            alias,
            primary_role
          )
        `)
        .is("left_at", null);

      if (membersError) {
        console.error("Kunne ikke hente team members:", membersError);
        return [];
      }

      const membersByTeamId = new Map();

      (members || []).forEach((member) => {
        if (!membersByTeamId.has(member.team_id)) {
          membersByTeamId.set(member.team_id, []);
        }

        membersByTeamId.get(member.team_id).push(member);
      });

      return (teams || []).map((team) => {
        const teamMembers = membersByTeamId.get(team.id) || [];

        const starters = teamMembers
          .filter((member) => member.roster_status === "active")
          .map((member) => member.players?.slug)
          .filter(Boolean);

        const bench = teamMembers
          .filter((member) => member.roster_status === "bench")
          .map((member) => member.players?.slug)
          .filter(Boolean);

        const captain = teamMembers.find(
          (member) => member.member_role === "captain"
        );

        return {
  id: team.slug,
  name: team.name,
  tagline: formatTeamTagline(team),
  description: team.description || "",
  logo: team.logo_url || "assets/teams/default-team.png",
  status: team.status,
  tier: team.tier,
          captainId: captain?.players?.slug || "",
          roster: {
            starters,
            bench
          },
          achievements: []
        };
      });
    },

    async getTeamProfile(teamSlug) {
  const { data: team, error: teamError } = await db
    .from("teams")
    .select("*")
    .eq("slug", teamSlug)
    .maybeSingle();

  if (teamError) {
    console.error("Kunne ikke hente team profile:", teamError);
    return null;
  }

  if (!team) {
    return null;
  }

  const { data: members, error: membersError } = await db
    .from("team_members")
    .select(`
      id,
      team_id,
      player_id,
      member_role,
      roster_status,
      joined_at,
      players (
        id,
        slug,
        alias,
        primary_role,
        level
      )
    `)
    .eq("team_id", team.id)
    .is("left_at", null);

  if (membersError) {
    console.error("Kunne ikke hente team roster:", membersError);
  }

  const rosterMembers = members || [];

  const captainMember = rosterMembers.find(
    (member) =>
      member.player_id === team.captain_player_id ||
      member.member_role === "captain"
  );

  return {
    team,
    members: rosterMembers,
    captain: captainMember?.players || null
  };
},

async getTeamAchievements(teamSlug) {
  const [historicalResult, tournamentResult] = await Promise.all([
    db
      .from("team_achievements_view")
      .select("*")
      .eq("team_slug", teamSlug)
      .order("placement", { ascending: true }),
    db
      .from("public_tournament_team_results_view")
      .select("*")
      .eq("team_slug", teamSlug)
      .order("event_date", { ascending: false, nullsFirst: false })
  ]);

  if (historicalResult.error) {
    console.warn("Kunne ikke hente historiske team achievements:", historicalResult.error);
  }
  if (tournamentResult.error) {
    console.warn("Kunne ikke hente tournament team achievements:", tournamentResult.error);
  }

  const tournamentRows = (tournamentResult.data || []).map((row) => ({
    ...row,
    title: row.event_name,
    description: `${Number(row.points_per_player || 0)} VCL Points pr. spiller`
  }));

  const rows = [...(historicalResult.data || []), ...tournamentRows];
  const seen = new Set();

  return rows.filter((row) => {
    const key = `${row.tournament_id || row.event_name || row.title}:${row.team_id || row.team_slug}:${row.placement}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
},

    /* =========================
       TEAM SIGNUPS / LOGOS
    ========================= */

    async uploadTeamLogo(file, teamName = "team") {
      if (!file) return "";

      const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
      const maxSize = 2 * 1024 * 1024;

      if (!allowedTypes.includes(file.type)) {
        throw new Error("Logo skal være PNG, JPG eller WEBP.");
      }

      if (file.size > maxSize) {
        throw new Error("Logo må maks være 2 MB.");
      }

      const extension = file.name.split(".").pop().toLowerCase();
      const safeTeamName = String(teamName || "team")
        .toLowerCase()
        .replace(/æ/g, "ae")
        .replace(/ø/g, "oe")
        .replace(/å/g, "aa")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      const filePath = `pending/${safeTeamName || "team"}-${Date.now()}.${extension}`;

      const { data, error } = await db.storage
        .from("team-logos")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false
        });

      if (error) {
        console.error("Kunne ikke uploade team logo:", error);
        throw error;
      }

      const { data: publicData } = db.storage
        .from("team-logos")
        .getPublicUrl(data.path);

      return publicData.publicUrl;
    },

    async submitTeamSignup(signup) {
      const { error } = await db
        .from("team_signups")
        .insert(signup);

      if (error) {
        console.error("Kunne ikke sende team signup:", error);
        throw error;
      }

      return true;
    }
  };

  console.log("VCL data-layer ready");
  window.dispatchEvent(new Event("vcldata:ready"));
  console.log("VCL Supabase auth active");
})();