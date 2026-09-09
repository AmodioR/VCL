import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules']);

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

const files = walk(root);
const relative = (file) => path.relative(root, file).replaceAll('\\', '/');
const read = (file) => fs.readFileSync(file, 'utf8');
const allPaths = new Set(files.map(relative));
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const jsFiles = files.filter((file) => file.endsWith('.js') && !relative(file).startsWith('tools/'));
const cssFiles = files.filter((file) => file.endsWith('.css'));

const errors = [];
const warnings = [];
const info = [];
const pageDependencies = new Map();
const referencedCss = new Map(cssFiles.map((file) => [relative(file), 0]));
const referencedJs = new Map(jsFiles.map((file) => [relative(file), 0]));

function attrValues(html, attr) {
  const values = [];
  const regex = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'gi');
  let match;
  while ((match = regex.exec(html))) values.push(match[1]);
  return values;
}

function resolveLocal(sourceFile, raw) {
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

for (const file of htmlFiles) {
  const html = read(file);
  const page = relative(file);
  const isRedirect = /http-equiv=["']refresh["']/i.test(html);
  const dependencies = [];

  for (const attr of ['href', 'src']) {
    for (const raw of attrValues(html, attr)) {
      const resolved = resolveLocal(file, raw);
      if (!resolved) continue;
      const target = relative(resolved);
      dependencies.push(target);
      if (!allPaths.has(target)) errors.push(`${page}: manglende lokal ${attr} -> ${raw}`);
      if (referencedCss.has(target)) referencedCss.set(target, referencedCss.get(target) + 1);
      if (referencedJs.has(target)) referencedJs.set(target, referencedJs.get(target) + 1);
    }
  }

  pageDependencies.set(page, dependencies);

  const ids = attrValues(html, 'id');
  for (const id of new Set(ids.filter((value, index) => ids.indexOf(value) !== index))) {
    errors.push(`${page}: duplicate id="${id}"`);
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    if (!/\balt\s*=/.test(tag)) warnings.push(`${page}: <img> uden alt-attribut`);
  }

  for (const tag of html.match(/<(?:a|form)\b[^>]*target=["']_blank["'][^>]*>/gi) || []) {
    if (!/\brel=["'][^"']*noopener/i.test(tag)) warnings.push(`${page}: target=_blank uden rel=noopener`);
  }

  const scripts = attrValues(html, 'src');
  const localScripts = scripts.filter((value) => value.endsWith('.js') || value.includes('.js?'));
  const hasSdk = scripts.some((value) => value.includes('@supabase/supabase-js'));
  const clientIndex = localScripts.findIndex((value) => value.includes('supabaseClient.js'));
  const dataIndex = localScripts.findIndex((value) => value.includes('vclData.js'));
  const mainIndex = localScripts.findIndex((value) => /(?:^|\/)script\.js(?:\?|$)/.test(value));

  if (!isRedirect && dataIndex >= 0 && clientIndex < 0) errors.push(`${page}: vclData.js loader uden supabaseClient.js`);
  if (!isRedirect && clientIndex >= 0 && !hasSdk) errors.push(`${page}: supabaseClient.js loader uden Supabase JS SDK`);
  if (clientIndex >= 0 && dataIndex >= 0 && clientIndex > dataIndex) errors.push(`${page}: vclData.js loader før supabaseClient.js`);
  if (dataIndex >= 0 && mainIndex >= 0 && dataIndex > mainIndex) warnings.push(`${page}: script.js loader før vclData.js`);

  if (!isRedirect && !/<!doctype html>/i.test(html)) warnings.push(`${page}: mangler <!doctype html>`);
  if (!isRedirect && !/<meta\s+name=["']viewport["']/i.test(html)) warnings.push(`${page}: mangler viewport meta`);
  if (!isRedirect && !/<html\b[^>]*lang=["']da["']/i.test(html)) warnings.push(`${page}: html lang er ikke da`);
}

// Count component files loaded dynamically by JavaScript.
for (const file of jsFiles) {
  const code = read(file);
  const regex = /["']((?:assets\/)?(?:css|js)\/[^"']+\.(?:css|js))(?:\?[^"']*)?["']/g;
  let match;
  while ((match = regex.exec(code))) {
    let target = match[1];
    if (!target.startsWith('assets/')) target = `assets/${target}`;
    if (referencedCss.has(target)) referencedCss.set(target, referencedCss.get(target) + 1);
    if (referencedJs.has(target)) referencedJs.set(target, referencedJs.get(target) + 1);
  }
}

for (const [file, count] of referencedCss) {
  if (count === 0) warnings.push(`CSS-kandidat uden HTML/JS-reference: ${file}`);
}
for (const [file, count] of referencedJs) {
  if (count === 0) warnings.push(`JS-kandidat uden HTML/JS-reference: ${file}`);
}

const relationRefs = new Map();
const rpcRefs = new Map();
const bucketRefs = new Map();

function remember(map, name, file) {
  if (!map.has(name)) map.set(name, new Set());
  map.get(name).add(file);
}

for (const file of jsFiles) {
  const code = read(file);
  const fileName = relative(file);
  let match;

  const bucketRegex = /\.storage\s*\.from\(["']([^"']+)["']\)/g;
  while ((match = bucketRegex.exec(code))) remember(bucketRefs, match[1], fileName);

  const relationRegex = /\.from\(["']([^"']+)["']\)/g;
  while ((match = relationRegex.exec(code))) {
    const before = code.slice(Math.max(0, match.index - 30), match.index);
    if (/\.storage\s*$/.test(before)) continue;
    remember(relationRefs, match[1], fileName);
  }

  const rpcRegex = /\.rpc\(["']([^"']+)["']/g;
  while ((match = rpcRegex.exec(code))) remember(rpcRefs, match[1], fileName);
}

const manifestPath = path.join(root, 'supabase/live-object-manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(read(manifestPath));
  const liveRelations = new Set([...(manifest.tables || []), ...(manifest.views || [])]);
  const liveFunctions = new Set(manifest.functions || []);
  const liveBuckets = new Set(manifest.storage_buckets || []);

  for (const [name, callers] of relationRefs) {
    if (!liveRelations.has(name)) errors.push(`Frontend relation findes ikke live: ${name} <- ${[...callers].join(', ')}`);
  }
  for (const [name, callers] of rpcRefs) {
    if (!liveFunctions.has(name)) errors.push(`Frontend RPC findes ikke live: ${name} <- ${[...callers].join(', ')}`);
  }
  for (const [name, callers] of bucketRefs) {
    if (!liveBuckets.has(name)) errors.push(`Frontend Storage bucket findes ikke live: ${name} <- ${[...callers].join(', ')}`);
  }

  info.push(`Live Supabase manifest: ${manifest.snapshot_date || 'ukendt dato'}`);
  info.push(`Frontend bruger ${relationRefs.size} tabeller/views, ${rpcRefs.size} RPC-navne og ${bucketRefs.size} buckets.`);
}

for (const file of files) {
  if (!['.js', '.css', '.html'].includes(path.extname(file))) continue;
  const size = fs.statSync(file).size;
  if (size >= 100_000) warnings.push(`Stor frontend-fil: ${relative(file)} (${Math.round(size / 1024)} KB)`);
}

function referenceLines(map) {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, refs]) => `- \`${name}\` <- ${[...refs].sort().join(', ')}`);
}

const output = [
  '# VCL static audit',
  '',
  `HTML: ${htmlFiles.length} · runtime JS: ${jsFiles.length} · CSS: ${cssFiles.length}`,
  '',
  `## Errors (${errors.length})`,
  ...(errors.length ? errors.map((item) => `- ${item}`) : ['- Ingen statiske errors fundet.']),
  '',
  `## Warnings (${warnings.length})`,
  ...(warnings.length ? warnings.map((item) => `- ${item}`) : ['- Ingen warnings.']),
  '',
  '## Backend cross-check',
  ...info.map((item) => `- ${item}`),
  '',
  '### Relations',
  ...referenceLines(relationRefs),
  '',
  '### RPCs',
  ...referenceLines(rpcRefs),
  '',
  '### Storage buckets',
  ...referenceLines(bucketRefs),
  '',
  '## HTML dependency map',
  ...[...pageDependencies.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([page, refs]) => {
      const code = refs.filter((value) => value.endsWith('.js') || value.endsWith('.css'));
      return `- \`${page}\`: ${code.length ? code.map((value) => `\`${value}\``).join(', ') : 'redirect/no local code'}`;
    })
];

console.log(output.join('\n'));
if (errors.length) process.exitCode = 1;
