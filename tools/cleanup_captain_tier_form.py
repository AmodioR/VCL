from pathlib import Path

html_path = Path('team-dashboard.html')
html = html_path.read_text(encoding='utf-8')
hidden_tier = '        <input type="hidden" name="tier" value="Academy">\n\n'
if html.count(hidden_tier) != 1:
    raise SystemExit(f'Expected one hidden captain tier field, found {html.count(hidden_tier)}')
html_path.write_text(html.replace(hidden_tier, '', 1), encoding='utf-8')

js_path = Path('script.js')
text = js_path.read_text(encoding='utf-8')

load_old = '''  const tierField = teamSettingsForm.elements.namedItem("tier");
  const statusField = teamSettingsForm.elements.namedItem("status");
  if (tierField) tierField.value = team.tier || "Academy";
  if (statusField) statusField.value = team.status || "active";'''
load_new = '''  const statusField = teamSettingsForm.elements.namedItem("status");
  if (statusField) statusField.value = team.status || "active";'''
if text.count(load_old) != 1:
    raise SystemExit(f'Expected one captain tier form loader, found {text.count(load_old)}')
text = text.replace(load_old, load_new, 1)

submit_old = '''      description: String(formData.get("description") || "").trim(),
      tier: String(formData.get("tier") || "Academy").trim(),
      status: String(formData.get("status") || "active").trim()'''
submit_new = '''      description: String(formData.get("description") || "").trim(),
      tier: String(currentDashboardTeam?.tier || "Academy").trim(),
      status: String(formData.get("status") || "active").trim()'''
if text.count(submit_old) != 1:
    raise SystemExit(f'Expected one captain tier submit field, found {text.count(submit_old)}')
text = text.replace(submit_old, submit_new, 1)

if 'formData.get("tier")' in text or 'namedItem("tier")' in text:
    raise SystemExit('Captain tier is still sourced from editable form state')

js_path.write_text(text, encoding='utf-8')
