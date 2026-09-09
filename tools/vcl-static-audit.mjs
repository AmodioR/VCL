import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(root);
const rel = (file) => path.relative(root, file).replaceAll('\\', '/');
const read = (file) => fs.readFileSync(file, 'utf8');
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const runtimeJsFiles = files.filter((f) => f.endsWith('.js') && !rel(f).startsWith('tools/'));
const auditJsFiles = files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
const cssFiles = files.filter((f) => f.endsWith('.css'));
const allRel = new Set(files.map(rel));

const report = [];
const errors = [];
const warnings = [];
const info = [];

const add = (bucket, message) => bucket.push(message);

function normalizeLocalRef(sourceFile, raw) {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.startsWith('#')) return null;
  if (/^(?:https?:|mailto:|tel:|data:|javascript:|blob:)/i.test(value)) return null;
  if (value.includes('${') || value.includes('{{')) return null;
  const clean = value.split('#')[0].split('?')[0];
  if (!clean) return null;
  const base = clean.startsWith('/') ? root : path.dirname(sourceFile);
  return path.resolve(base, clean.replace(/^\/+/, ''));
}

function extractAttrs(html, attr) {
  const values = [];
  const re = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'gi');
  let match;
  while ((match = re.exec(html))) values.push(match[1]);
  return values;
}

const pageDeps = new Map();
const referencedCss = new Map(cssFiles.map((f) => [rel(f), 0]));
const referencedJs = new Map(runtimeJsFiles.map((f) => [rel(f), 0]));

for (const file of htmlFiles) {
  const html = read(file);
  const page = rel(file);
  const isRedirect = /http-equiv=["']refresh["']/i.test(html);
  const refs = [];

  for (const attr of ['href', 'src']) {
    for (const raw of extractAttrs(html, attr)) {
      const resolved = normalizeLocalRef(file, raw);
      if (!resolved) continue;
      const target = rel(resolved);
      refs.push(target);
      if (!allRel.has(target)) add(errors, `${page}: manglende lokal ${attr} -> ${raw}`);
      if (referencedCss.has(target)) referencedCss.set(target, referencedCss.get(target) + 1);
      if (referencedJs.has(target)) referencedJs.set(target, referencedJs.get(target) + 1);
    }
  }

  pageDeps.set(page, refs);

  const ids = extractAttrs(html, 'id');
  const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  for (const id of duplicates) add(errors, `${page}: duplicate id="${id}"`);

  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of imgTags) {
    if (!/\balt\s*=/.test(tag)) add(warnings, `${page}: <img> uden alt-attribut: ${tag.slice(0, 120)}`);
  }

  const blankTags = html.match(/<(?:a|form)\b[^>]*target=["']_blank["'][^>]*>/gi) || [];
  for (const tag of blankTags) {
    if (!/\brel=["'][^"']*noopener/i.test(tag)) add(warnings, `${page}: target=_blank uden rel=noopener`);
  }

  const allScriptRefs = extractAttrs(html, 'src');
  const localScriptRefs = allScriptRefs.filter((v) => v.endsWith('.js') || v.includes('.js?'));
  const hasSupabaseSdk = allScriptRefs.some((v) => v.includes('@supabase/supabase-js'));
  const clientIndex = localScriptRefs.findIndex((v) => v.includes('supabaseClient.js'));
  const dataIndex = localScriptRefs.findIndex((v) => v.includes('vclData.js'));
  const mainIndex = localScriptRefs.findIndex((v) => /(?:^|\/)script\.js(?:\?|$)/.test(v));
  if (!isRedirect && dataIndex >= 0 && clientIndex < 0) add(errors, `${page}: vclData.js loader uden supabaseClient.js`);
  if (!isRedirect && clientIndex >= 0 && !hasSupabaseSdk) add(errors, `${page}: supabaseClient.js loader uden Supabase JS SDK`);
  if (clientIndex >= 0 && dataIndex >= 0 && clientIndex > dataIndex) add(errors, `${page}: vclData.js loader før supabaseClient.js`);
  if (dataIndex >= 0 && mainIndex >= 0 && dataIndex > mainIndex) add(warnings, `${page}: script.js loader før vclData.js`);

  if (!isRedirect && !/<!doctype html>/i.test(html)) add(warnings, `${page}: mangler <!doctype html>`);
  if (!isRedirect && !/<meta\s+name=["']viewport["']/i.test(html)) add(warnings, `${page}: mangler viewport meta`);
  if (!isRedirect && !/<html\b[^>]*lang=["']da["']/i.test(html)) add(warnings, `${page}: html lang er ikke da`);
}

// Dynamic CSS/JS loaders also count as active references.
for (const file of runtimeJsFiles) {
  const code = read(file);
  const assetRe = /["']((?:assets\/)?(?:css|js)\/[^"']+\.(?:css|js))(?:\?[^"']*)?["']/g;
  let m;
  while ((m = assetRe.exec(code))) {
    let target = m[1];
    if (!target.startsWith('assets/')) target = `assets/${target}`;
    if (referencedCss.has(target)) referencedCss.set(target, referencedCss.get(target) + 1);
    if (referencedJs.has(target)) referencedJs.set(target, referencedJs.get(target) + 1);
  }
}

for (const [file, count] of referencedCss) {
  if (count === 0) add(warnings, `CSS-kandidat uden HTML/JS-reference: ${file}`);
}
for (const [file, count] of referencedJs) {
  if (count === 0) add(warnings, `JS-kandidat uden HTML/JS-reference: ${file}`);
}

const vclDataPath = path.join(root, 'assets/js/vclData.js');
if (fs.existsSync(vclDataPath)) {
  const source = read(vclDataPath);
  const defs = new Set();
  const defRe = /^\s{4}async\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let defMatch;
  while ((defMatch = defRe.exec(source))) defs.add(defMatch[1]);

  const calls = new Map();
  for (const file of runtimeJsFiles.filter((f) => rel(f) !== 'assets/js/vclData.js')) {
    const code = read(file);
    const patterns = [
      /\bVCLData\.([A-Za-z_$][\w$]*)\s*\(/g,
      /\bwindow\.VCLData\.([A-Za-z_$][\w$]*)\s*\(/g,
      /waitForVCLData\(["']([A-Za-z_$][\w$]*)["']/g
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(code))) {
        if (!calls.has(m[1])) calls.set(m[1], new Set());
        calls.get(m[1]).add(rel(file));
      }
    }
  }

  for (const [name, callers] of calls) {
    if (!defs.has(name)) add(errors, `Frontend kalder manglende VCLData.${name}() fra ${[...callers].join(', ')}`);
  }

  const maybeUnused = [...defs].filter((name) => !calls.has(name));
  info.push(`VCLData async-metoder defineret: ${defs.size}`);
  info.push(`VCLData async-metoder med statisk fundet caller: ${defs.size - maybeUnused.length}`);
  if (maybeUnused.length) info.push(`VCLData cleanup-kandidater (kræver manuel kontrol): ${maybeUnused.sort().join(', ')}`);
}

const backendTables = new Map();
const backendRpcs = new Map();
const storageBuckets = new Map();
for (const file of runtimeJsFiles) {
  const code = read(file);
  const fileName = rel(file);

  const storageRe = /\.storage\s*\.from\(["']([^"']+)["']\)/g;
  let m;
  while ((m = storageRe.exec(code))) {
    if (!storageBuckets.has(m[1])) storageBuckets.set(m[1], new Set());
    storageBuckets.get(m[1]).add(fileName);
  }

  const fromRe = /\.from\(["']([^"']+)["']\)/g;
  while ((m = fromRe.exec(code))) {
    const before = code.slice(Math.max(0, m.index - 24), m.index);
    if (/\.storage\s*$/.test(before)) continue;
    if (!backendTables.has(m[1])) backendTables.set(m[1], new Set());
    backendTables.get(m[1]).add(fileName);
  }

  const rpcRe = /\.rpc\(["']([^"']+)["']/g;
  while ((m = rpcRe.exec(code))) {
    if (!backendRpcs.has(m[1])) backendRpcs.set(m[1], new Set());
    backendRpcs.get(m[1]).add(fileName);
  }
}

const manifestPath = path.join(root, 'supabase/live-object-manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(read(manifestPath));
  const liveRelations = new Set([...(manifest.tables || []), ...(manifest.views || [])]);
  const liveFunctions = new Set(manifest.functions || []);
  const liveBuckets = new Set(manifest.storage_buckets || []);

  for (const [name, callers] of backendTables) {
    if (!liveRelations.has(name)) add(errors, `Frontend relation findes ikke i live manifest: ${name} <- ${[...callers].join(', ')}`);
  }
  for (const [name, callers] of backendRpcs) {
    if (!liveFunctions.has(name)) add(errors, `Frontend RPC findes ikke i live manifest: ${name} <- ${[...callers].join(', ')}`);
  }
  for (const [name, callers] of storageBuckets) {
    if (!liveBuckets.has(name)) add(errors, `Frontend Storage bucket findes ikke i live manifest: ${name} <- ${[...callers].join(', ')}`);
  }

  info.push(`Live Supabase manifest: ${manifest.snapshot_date || 'ukendt dato'}`);
  info.push(`Frontend bruger ${backendTables.size} tabeller/views, ${backendRpcs.size} RPC-navne og ${storageBuckets.size} buckets.`);
}

const bigFiles = files
  .filter((f) => ['.js', '.css', '.html'].includes(path.extname(f)))
  .map((f) => ({ file: rel(f), size: fs.statSync(f).size }))
  .filter((item) => item.size >= 100_000)
  .sort((a, b) => b.size - a.size);
for (const item of bigFiles) add(warnings, `Stor frontend-fil: ${item.file} (${Math.round(item.size / 1024)} KB)`);

function mapToLines(map) {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, refs]) => `- \`${name}\` <- ${[...refs].sort().join(', ')}`);
}

report.push('# VCL static audit');
report.push('');
report.push(`HTML: ${htmlFiles.length} · runtime JS: ${runtimeJsFiles.length} · CSS: ${cssFiles.length}`);
report.push('');
report.push(`## Errors (${errors.length})`);
report.push(errors.length ? errors.map((x) => `- ${x}`).join('\n') : '- Ingen statiske errors fundet.');
report.push('');
report.push(`## Warnings (${warnings.length})`);
report.push(warnings.length ? warnings.map((x) => `- ${x}`).join('\n') : '- Ingen warnings.');
report.push('');
report.push('## Data-layer info');
report.push(info.length ? info.map((x) => `- ${x}`).join('\n') : '- Ingen.');
report.push('');
report.push('## Frontend table/view references');
report.push(...mapToLines(backendTables));
report.push('');
report.push('## Frontend RPC references');
report.push(...mapToLines(backendRpcs));
report.push('');
report.push('## Frontend Storage bucket references');
report.push(...mapToLines(storageBuckets));
report.push('');
report.push('## HTML dependency map');
for (const [page, refs] of [...pageDeps.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const localCode = refs.filter((x) => x.endsWith('.js') || x.endsWith('.css'));
  report.push(`- \`${page}\`: ${localCode.length ? localCode.map((x) => `\`${x}\``).join(', ') : 'redirect/no local code'}`);
}

console.log(report.join('\n'));

if (errors.length) process.exitCode = 1;
