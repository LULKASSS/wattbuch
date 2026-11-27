/* Fährt die App mit simulierter Rolle durch und legt Bilder ab: Lobby, Countdown, Fahrt, Pause, Ergebnis.
 * Aufruf: node scripts/bilder.mjs [Zielordner] [Sekunden Fahrt]. Eigener Datenordner, echte Daten bleiben unberührt. */
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const ziel = path.resolve(process.argv[2] || 'test-results/bilder'), fahrt = +(process.argv[3] || 25);
fs.mkdirSync(ziel, { recursive: true });
const data = process.env.WATTBUCH_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-bilder-'));
/* SAISON=1: erfundene Fahrten der letzten zehn Wochen und ein Ziel, damit Saison und Fortschritt etwas zeigen */
if (process.env.SAISON) {
  const d = path.join(data, 'daten'), tag = n => new Date(Date.now() - n * 864e5), iso = x => x.toISOString().slice(0, 10);
  fs.mkdirSync(path.join(d, 'fahrten'), { recursive: true });
  let k = 0;
  for (let w = 10; w >= 0; w--) for (const [wt, min, watt] of [[1, 45, 150 + (10 - w) * 2], [3, 40, 172 + (10 - w) * 3], [5, 80 + (10 - w) * 4, 148]]) {
    const n = w * 7 + (6 - wt) - 3; if (n < 1) continue;
    const sek = min * 60, p = Array.from({ length: sek }, (_, i) => Math.round(watt + 18 * Math.sin(i / 37 + k))), dist = Array.from({ length: sek }, (_, i) => Math.round((i + 1) * 7.6 * 10) / 10), start = tag(n); start.setHours(18, 0, 0, 0);
    fs.writeFileSync(path.join(d, 'fahrten', `rbild${k}.json`), JSON.stringify({ id: 'rbild' + k++, start: start.toISOString(), name: 'Rollentraining', p, hr: null, cad: null, spd: null, dist, alt: null, route: null, gain: 0, trainer: true, ftp: 200, weight: 75, app: 'neu' }));
  }
  fs.writeFileSync(path.join(d, 'saison.json'), JSON.stringify({ art: 'ftp', ziel: 220, bis: iso(tag(-63)), von: iso(tag(21)), ftp0: 200, last0: 190 }));
}
const app = await electron.launch({ args: ['.'], env: { ...process.env, WATTBUCH_DATA: data, WATTBUCH_SIM: '1' } });
const warte = ms => new Promise(r => setTimeout(r, ms));
let page; for (let i = 0; i < 50 && !page; i++) { page = app.windows().find(w => w.url().includes('buehne')); if (!page) await warte(200); }
page.on('console', m => { if (m.type() === 'error') console.log('Konsole:', m.text()); }); page.on('pageerror', e => console.log('Fehler:', e.message));
const bild = n => page.screenshot({ path: path.join(ziel, n + '.png') });
await page.waitForFunction(() => window.__wb && window.__wb.z && window.__wb.z.geraete.rolle === 'an', null, { timeout: 20000 });
await warte(5000); await bild('0-start'); await page.click('nav button[data-s=lobby]'); await warte(1200); await bild('1-lobby');
/* RIVALE=1: die Runde nehmen, auf der schon ein Versuch liegt (falls sie nicht ohnehin gewählt ist) */
if (process.env.RIVALE) { const k = page.locator('.card', { hasText: 'Rivale wartet' }); if (await k.count()) { await k.first().click(); await warte(3500); } await bild('1c-lobby-rivale'); }
if (process.env.SAISON) { await page.click('nav button[data-s=fahrten]'); await warte(1200); await bild('1f-fahrten'); await page.locator('.fh').first().click(); await warte(3500); await bild('1g-fahrt'); await page.keyboard.press('Escape'); await warte(900); await page.click('nav button[data-s=lobby]'); await warte(800); }
if (process.env.PROFIL) { await page.click('#lvlB'); await warte(900); await bild('1e-profil'); await page.keyboard.press('Escape'); await warte(600); }
if (process.env.RUNDE) { await page.keyboard.press('ArrowRight'); await warte(3000); await bild('1b-lobby'); }
await page.click('#start'); await warte(1400); await bild('2-countdown'); await warte(1200); await bild('2b-countdown');
await warte(4000); await bild('3-fahrt'); await warte(fahrt * 1000); await bild('3b-fahrt');
console.log('Welt:', JSON.stringify(await page.evaluate(() => window.__wb.welt)));
await page.keyboard.press('c'); await warte(1500); await bild('4-coach-aus'); await page.keyboard.press('c');
await page.keyboard.press(' '); await warte(1200); await bild('5-pause'); await page.keyboard.press(' ');
await warte(800); await page.click('#end'); await warte(2600); await bild('6-ergebnis');
await app.close(); console.log('Bilder in', ziel);
