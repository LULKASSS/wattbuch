/* Schneller Fehlercheck ohne Browser:
 * 1. JavaScript in index.html ist syntaktisch gültig
 * 2. HTML-Grundgerüst stimmt, jede per $('#id') angesprochene ID existiert
 * 3. Keine persönlichen Daten im Repo (Sicherungen, GPX, Fahrten, Schlüssel)
 * Exit-Code 1 bei Fehlern. */
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const errors = [], warns = [];
const html = await readFile(root + 'index.html', 'utf8');

/* 1. Syntax: jede eingebundene Datei einzeln, dann alle zusammen (gemeinsamer globaler Gültigkeitsbereich,
   findet doppelt deklarierte const/let über Dateigrenzen) */
const srcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
const scripts = [];
for (const src of srcs) {
  const code = await readFile(root + src, 'utf8').catch(() => null);
  if (code == null) { errors.push(`index.html bindet ${src} ein, Datei fehlt`); continue; }
  scripts.push(code);
  try { new vm.Script(code, { filename: src }); }
  catch (e) { errors.push(`Syntaxfehler in ${src}: ${e.message}`); }
}
for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) scripts.push(m[1]);
if (!scripts.length) errors.push('index.html: kein Script gefunden');
try { new vm.Script(scripts.join('\n;\n').replace(/'use strict';/g, ''), { filename: 'alle Scripts' }); }
catch (e) { errors.push(`Scripts passen nicht zusammen: ${e.message}`); }
for (const l of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g))
  if (!/^https?:/.test(l[1])) await readFile(root + l[1]).catch(() => errors.push(`index.html bindet ${l[1]} ein, Datei fehlt`));

/* 2. HTML und IDs */
for (const need of ['<!doctype html>', '<meta charset', 'name="viewport"', '<title>'])
  if (!html.toLowerCase().includes(need.toLowerCase())) errors.push(`index.html: ${need} fehlt`);
/* IDs aus dem HTML und aus den Vorlagen in den Scripts (Ansichten werden per innerHTML gebaut) */
const ids = new Set([...(html + scripts.join('\n')).matchAll(/\bid="([^"$]+)"/g)].map(m => m[1]));
const dynamicIds = new Set(['zpTxt', 'sumStrava', 'btnStrava']); /* werden zur Laufzeit gesetzt */
const used = new Set([...scripts.join('\n').matchAll(/\$\(\s*'#([\w-]+)'(?!\s*\+)/g)].map(m => m[1])); /* nur feste IDs, keine zusammengesetzten */
for (const id of used) if (!ids.has(id) && !dynamicIds.has(id)) errors.push(`#${id} wird im Script benutzt, steht aber nicht im HTML`);
const dupes = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) !== i);
for (const d of new Set(dupes)) errors.push(`ID doppelt vergeben: #${d}`);
if (/<script[^>]+src="\/?test\//.test(html)) errors.push('index.html lädt Testcode (test/…) – darf nie veröffentlicht werden');

/* Manifest für das automatische Update der Mac-App muss zu den Dateien passen */
{
  const { build } = await import('./manifest.mjs');
  const want = await build();
  const have = JSON.parse(await readFile(root + 'manifest.json', 'utf8').catch(() => '{}'));
  if (have.version !== want.version) errors.push('manifest.json ist veraltet → node scripts/manifest.mjs');
}

/* 3. Persönliche Daten */
let files = [];
try { files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); }
catch { warns.push('git nicht verfügbar, Datencheck übersprungen'); }
const allowed = /^test\/fixtures\//;
for (const f of files) {
  if (allowed.test(f)) continue;
  if (/\.(gpx|tcx|fit)$/i.test(f)) errors.push(`Streckendatei/Fahrt im Repo: ${f} (gehört nach daten/ oder test/fixtures/)`);
  if (/sicherung|backup/i.test(f) && /\.json$/i.test(f)) errors.push(`Sicherung im Repo: ${f}`);
  if (/\.json$/i.test(f) && !/^(package(-lock)?\.json|\.claude\/)/.test(f)) {
    const t = await readFile(root + f, 'utf8').catch(() => '');
    if (/"app"\s*:\s*"wattbuch"/.test(t) || /"rides"\s*:\s*\[/.test(t)) errors.push(`Datei sieht nach Wattbuch-Sicherung aus: ${f}`);
  }
  if (!/node_modules/.test(f) && /\.(js|mjs|css|html|md|json|yml)$/.test(f)) {
    const t = await readFile(root + f, 'utf8').catch(() => '');
    if (/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9-]{20,}/.test(t)) errors.push(`Möglicher Zugangsschlüssel in ${f}`);
  }
}

for (const w of warns) console.log('⚠️  ' + w);
if (errors.length) { console.log('❌ Fehlercheck fehlgeschlagen:'); for (const e of errors) console.log('   • ' + e); process.exit(1); }
console.log(`✅ Fehlercheck ok (${scripts.length} Scripts, ${ids.size} IDs, ${files.length} Dateien geprüft)`);
