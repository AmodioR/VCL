from pathlib import Path

path = Path('script.js')
text = path.read_text(encoding='utf-8')

replacements = {
    'error.message || "Tjek at tournament-migrationen er kørt i Supabase."': 'error.message || "Turneringen kunne ikke indlæses. Prøv igen om et øjeblik."',
    'setPlayerAvatarMessage("Avatarstatus kunne ikke hentes. Har du kørt avatar-migrationen i Supabase?", "error");': 'setPlayerAvatarMessage("Avatarstatus kunne ikke hentes. Prøv igen om et øjeblik.", "error");',
    '<p>Kontrollér Supabase-migrationen og prøv igen.</p>': '<p>Kontrollér turneringsdataene og prøv igen.</p>',
    'adminAvatarList.innerHTML = `<article><span>Fejl</span><strong>Kunne ikke hente profilbilleder</strong><p>Kør avatar-migrationen i Supabase og prøv igen.</p></article>`;': 'adminAvatarList.innerHTML = `<article><span>Fejl</span><strong>Kunne ikke hente profilbilleder</strong><p>Prøv igen om et øjeblik.</p></article>`;',
    '''        adminTournamentList.innerHTML = `
          <article class="admin-setup-required">
            <span>Setup required</span>
            <strong>Turneringsmodulet mangler i Supabase</strong>
            <p>Kør <code>20260715_tournament_core.sql</code> i Supabase SQL Editor.</p>
          </article>
        `;''': '''        adminTournamentList.innerHTML = `
          <article class="admin-setup-required">
            <span>Fejl</span>
            <strong>Turneringerne kunne ikke hentes</strong>
            <p>Prøv igen om et øjeblik. Hvis fejlen fortsætter, kontrollér forbindelsen til VCL-databasen.</p>
          </article>
        `;''',
}

for old, new in replacements.items():
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected one stale setup copy occurrence, found {count}: {old[:80]}')
    text = text.replace(old, new, 1)

for stale in ['tournament-migrationen', 'avatar-migrationen', '20260715_tournament_core.sql', 'Kontrollér Supabase-migrationen']:
    if stale in text:
        raise SystemExit(f'Stale setup copy still remains: {stale}')

path.write_text(text, encoding='utf-8')
