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

/* 1. Syntax */
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) errors.push('index.html: kein <script> gefunden');
scripts.forEach((code, i) => {
  try { new vm.Script(code, { filename: `index.html <script #${i + 1}>` }); }
  catch (e) { errors.push(`Syntaxfehler in Script ${i + 1}: ${e.message}`); }
});

/* 2. HTML und IDs */
for (const need of ['<!doctype html>', '<meta charset', 'name="viewport"', '<title>'])
  if (!html.toLowerCase().includes(need.toLowerCase())) errors.push(`index.html: ${need} fehlt`);
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const dynamicIds = new Set(['zpTxt']); /* werden zur Laufzeit gesetzt */
const used = new Set([...scripts.join('\n').matchAll(/\$\(\s*'#([\w-]+)'(?!\s*\+)/g)].map(m => m[1])); /* nur feste IDs, keine zusammengesetzten */
for (const id of used) if (!ids.has(id) && !dynamicIds.has(id)) errors.push(`#${id} wird im Script benutzt, steht aber nicht im HTML`);
const dupes = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) !== i);
for (const d of new Set(dupes)) errors.push(`ID doppelt vergeben: #${d}`);
if (/<script[^>]+src="\/?test\//.test(html)) errors.push('index.html lädt Testcode (test/…) – darf nie veröffentlicht werden');

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
  if (!/node_modules/.test(f) && /\.(js|mjs|html|md|json|yml)$/.test(f)) {
    const t = await readFile(root + f, 'utf8').catch(() => '');
    if (/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9-]{20,}/.test(t)) errors.push(`Möglicher Zugangsschlüssel in ${f}`);
  }
}

for (const w of warns) console.log('⚠️  ' + w);
if (errors.length) { console.log('❌ Fehlercheck fehlgeschlagen:'); for (const e of errors) console.log('   • ' + e); process.exit(1); }
console.log(`✅ Fehlercheck ok (${scripts.length} Script, ${ids.size} IDs, ${files.length} Dateien geprüft)`);
