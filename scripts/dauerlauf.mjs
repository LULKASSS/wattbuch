/* Leistungsprüfung: fährt mit simulierter Rolle eine Weile und schreibt alle 30 s Bildzeit, Detailstufe, Kacheln,
 * Geometrien und Speicher. So zeigt sich, ob die Welt über die Zeit wächst. Aufruf: node scripts/dauerlauf.mjs [Minuten] */
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const minuten = +(process.argv[2] || 10), data = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-dauer-'));
const app = await electron.launch({ args: ['.'], env: { ...process.env, WATTBUCH_DATA: data, WATTBUCH_SIM: '1' } });
const warte = ms => new Promise(r => setTimeout(r, ms));
let page; for (let i = 0; i < 50 && !page; i++) { page = app.windows().find(w => w.url().includes('buehne')); if (!page) await warte(200); }
await page.waitForFunction(() => window.__wb && window.__wb.z && window.__wb.z.geraete.rolle === 'an', null, { timeout: 20000 });
await warte(1500); await page.click('#start');
for (let i = 1; i <= minuten * 2; i++) {
  await warte(30000);
  const w = await page.evaluate(() => ({ ...window.__wb.welt, km: Math.round(window.__wb.z.s / 100) / 10, mb: Math.round((performance.memory ? performance.memory.usedJSHeapSize : 0) / 1e6) }));
  console.log(`${(i / 2).toFixed(1)} min  ${w.km} km  Bild ${w.bildzeit.toFixed(1)} ms  Stufe ${w.stufe}  Kacheln ${w.kacheln}  Geometrien ${w.geometrien}  Dreiecke ${w.dreiecke}  Speicher ${w.mb} MB`);
}
await app.close(); fs.rmSync(data, { recursive: true, force: true });
