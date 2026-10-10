/* Baut Wattbuch-Strecken aus Punktlisten (z. B. Strava-Streams) mit derselben Logik wie die App
 * (buildRoute aus js/strecken.js) und schreibt eine Datei, die die App über „Datei laden“ einliest.
 *
 *   node scripts/strecke-aus-punkten.mjs eingabe.json ausgabe.json
 *
 * eingabe.json: [{ "name": "…", "location": [[lat,lng],…], "altitude": [m,…] }, …]
 * Persönliche Strecken nie ins Repo legen: Ausgabe nach iCloud Drive/Wattbuch/Import/. */
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [inp, out] = process.argv.slice(2);
if (!inp || !out) { console.error('Aufruf: node scripts/strecke-aus-punkten.mjs eingabe.json ausgabe.json'); process.exit(1); }

/* App-Code laden, nur die Rechenfunktionen werden gebraucht */
const ctx = vm.createContext({ console, Intl, Math, Map, Set, Number, String, Array, JSON, Date, isFinite, navigator: {}, performance: { now: () => 0 } });
for (const f of ['basis', 'strecken']) vm.runInContext((await readFile(root + `js/${f}.js`, 'utf8')).replace(/^'use strict';/, ''), ctx, { filename: f });
const buildRoute = vm.runInContext('buildRoute', ctx);

const list = JSON.parse(await readFile(inp, 'utf8'));
const routes = [];
for (const r of list) {
  const pts = r.location.map((p, i) => [p[0], p[1], r.altitude[i]]).filter(p => p.every(Number.isFinite));
  const rt = buildRoute(r.name, pts);
  routes.push(rt);
  console.log(`${rt.name}: ${(rt.dist / 1000).toFixed(1)} km, ${rt.gain} Hm`);
}
await writeFile(out, JSON.stringify({ app: 'wattbuch', version: 1, routes }));
console.log(`→ ${out}`);
