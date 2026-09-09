from pathlib import Path

path = Path('script.js')
text = path.read_text(encoding='utf-8')

old = '''          if (freeAgentForm) {
  freeAgentForm.hidden = true;
  await loadTeamInvites();
  await loadClaimInvite();
}
'''
new = '''          if (freeAgentForm) {
  freeAgentForm.hidden = true;
}
'''
if text.count(old) != 1:
    raise SystemExit(f'Expected one claim-loading block in claimed-player branch, found {text.count(old)}')
text = text.replace(old, new, 1)

anchor = '''}
      }
    }

    if (playerAvatarInput) {'''
replacement = '''}
      }

      // Invitations belong to the signed-in account flow, not only to users who
      // already have a claimed player. This is especially important after login
      // with ?claim=, where an existing account may not have a player yet.
      await loadTeamInvites();
      await loadClaimInvite();
    }

    if (playerAvatarInput) {'''
if text.count(anchor) != 1:
    raise SystemExit(f'Expected one account loader end anchor, found {text.count(anchor)}')
text = text.replace(anchor, replacement, 1)

expected = '''      await loadTeamInvites();
      await loadClaimInvite();
    }

    if (playerAvatarInput) {'''
if expected not in text:
    raise SystemExit('Claim/team invitation loading was not moved to the account-level flow')
if old in text:
    raise SystemExit('Claim loading still depends on the claimed-player free-agent branch')

path.write_text(text, encoding='utf-8')
