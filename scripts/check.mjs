/* Fehlercheck ohne App: keine persönlichen Daten oder Schlüssel im Repo, die simulierte Rolle kommt nicht in die App,
 * die App lädt nichts aus dem Netz nach, alle IDs der Bühne gibt es. Aufruf: node scripts/check.mjs */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const fehler = [];
const dateien = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n').filter(f => f && fs.existsSync(f) && !f.startsWith('entwurf/three'));
const text = f => /\.(ts|js|cjs|mjs|json|html|css|md|yml)$/.test(f) ? fs.readFileSync(f, 'utf8') : '';

/* 1. Persönliche Daten: keine Fahrten, Sicherungen, GPX/TCX/FIT */
for (const f of dateien) if (/\.(gpx|tcx|fit)$/i.test(f) || /sicherung.*\.json$/i.test(f) || /^(daten|\.sim)\//.test(f) || /strava\.json$/.test(f)) fehler.push(`persönliche Datei im Repo: ${f}`);
/* 2. Schlüssel: nur der öffentliche Supabase-Schlüssel (sb_publishable_…) ist erlaubt */
const geheim = [/sb_secret_[A-Za-z0-9_-]{8,}/, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, /client_secret["'\s:=]+[0-9a-f]{20,}/i, /clientSecret["'\s:=]+["'][0-9a-f]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /gh[pousr]_[A-Za-z0-9]{30,}/];
for (const f of dateien) { const t = text(f); for (const re of geheim) if (re.test(t)) fehler.push(`möglicher Schlüssel in ${f}: ${re}`); }
/* 3. Simulierte Rolle und Fahrer nur in test/, nie in der App */
for (const f of dateien.filter(f => /^(src\/|buehne\.html|maschine\.html)/.test(f))) if (/fake-ble|sim-fahrer/.test(text(f))) fehler.push(`simulierte Rolle in der App: ${f}`);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.build.files.some(x => /test/.test(x))) fehler.push('test/ darf nicht in die gebaute App');
if (pkg.build.appId === 'de.rueckborn.wattbuch') fehler.push('App-Kennung der alten App: der Neubau muss eine eigene haben');
/* 4. Nichts aus dem Netz nachladen: keine Seiten-, Schrift- oder Skriptadressen in der Oberfläche */
for (const f of dateien.filter(f => /^(src\/(buehne|kern|stil)|buehne\.html|maschine\.html)/.test(f))) { const m = text(f).match(/https?:\/\/[^\s"')]+/g); if (m) fehler.push(`Netzadresse in der Oberfläche ${f}: ${m[0]}`); }
if (/github\.io|releases\/latest|manifest\.json/.test(text('app/main.cjs'))) fehler.push('app/main.cjs lädt etwas von Pages oder aus Releases');
/* 5. IDs: jede in buehne.ts benutzte ID steht in buehne.html, keine doppelt */
const html = text('buehne.html'), ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
for (const id of new Set(ids)) if (ids.filter(x => x === id).length > 1) fehler.push(`doppelte ID: ${id}`);
for (const m of text('src/buehne/buehne.ts').matchAll(/\$(?:<[^>]+>)?\('([^']+)'\)/g)) if (!ids.includes(m[1])) fehler.push(`ID fehlt in buehne.html: ${m[1]}`);

if (fehler.length) { console.error('Fehlercheck:\n- ' + fehler.join('\n- ')); process.exit(1); }
console.log(`Fehlercheck in Ordnung (${dateien.length} Dateien)`);
