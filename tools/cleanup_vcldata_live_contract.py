from pathlib import Path

path = Path('assets/js/vclData.js')
text = path.read_text(encoding='utf-8')

# Team display copy must come from live team data, not hardcoded team slugs.
old_tagline = '''  if (team.slug === "dysteria") return "VCL Champions 2026";
  if (team.slug === "frontline") return "Academy Cup Winners";
  if (team.slug === "frontline-ghost") return "Frontlines second team";

  return `${team.tier || "VCL"} roster`;'''
new_tagline = '''  return `${team.tier || "VCL"} roster`;'''
if text.count(old_tagline) != 1:
    raise SystemExit(f'Expected one hardcoded team tagline block, found {text.count(old_tagline)}')
text = text.replace(old_tagline, new_tagline, 1)

# The production website has one canonical public news view now.
old_sources = '''  const sources = [
    // Preferred public view. It exposes published posts only.
    "public_news_posts_view",
    // Safe fallback when the table already has a public SELECT policy.
    "news_posts",
    // Compatibility fallback for installations that still expose the previous public view.
    "news_posts_view"
  ];'''
new_sources = '''  const sources = ["public_news_posts_view"];'''
if text.count(old_sources) != 1:
    raise SystemExit(f'Expected one public news compatibility source block, found {text.count(old_sources)}')
text = text.replace(old_sources, new_sources, 1)

# Team registration targets the current live schema; schema drift should fail loudly
# instead of silently retrying a retired pre-tournament payload.
old_signup = '''    async submitTeamSignup(signup) {
      const { error } = await db
        .from("team_signups")
        .insert(signup);

      if (!error) return true;

      const missingTournamentColumns = ["PGRST204", "42703"].includes(error.code);

      if (missingTournamentColumns) {
        console.warn(
          "Tournament migration er ikke kørt endnu. Sender signup uden de nye tournament-felter.",
          error
        );

        const compatSignup = { ...signup };
        delete compatSignup.tournament_id;
        delete compatSignup.tournament_slug;
        delete compatSignup.discord_confirmed;
        delete compatSignup.checkin_confirmed;

        const { error: compatError } = await db
          .from("team_signups")
          .insert(compatSignup);

        if (!compatError) return true;
        console.error("Kunne ikke sende schema-kompatibel team registration:", compatError);
        throw compatError;
      }

      console.error("Kunne ikke sende team signup:", error);
      throw error;
    }'''
new_signup = '''    async submitTeamSignup(signup) {
      const { error } = await db
        .from("team_signups")
        .insert(signup);

      if (error) {
        console.error("Kunne ikke sende team signup:", error);
        throw error;
      }

      return true;
    }'''
if text.count(old_signup) != 1:
    raise SystemExit(f'Expected one legacy team signup compatibility block, found {text.count(old_signup)}')
text = text.replace(old_signup, new_signup, 1)

for stale in [
    'team.slug === "dysteria"',
    'team.slug === "frontline"',
    'team.slug === "frontline-ghost"',
    'Compatibility fallback for installations',
    'const compatSignup',
    'Tournament migration er ikke kørt endnu',
    'schema-kompatibel team registration',
]:
    if stale in text:
        raise SystemExit(f'Stale VCLData compatibility remains: {stale}')

path.write_text(text, encoding='utf-8')
