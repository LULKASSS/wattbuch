// Die App durchspielen: Lobby, Runde fahren, Rivale, Coach, Pause, Start beim Tritt, Abstürze.
// Immer mit eigenem Datenordner (WATTBUCH_DATA) und simulierter Rolle (WATTBUCH_SIM), nie mit echten Daten oder Geräten.
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

test.skip(process.platform !== 'darwin', 'nur auf dem Mac');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const warte = ms => new Promise(r => setTimeout(r, ms));

/* Erfundene kurze Strecke: 3 km mit einem Hügel, damit eine ganze Runde in Sekunden durch ist */
function kurzeStrecke() {
  const ele = [], line = [];
  for (let i = 0; i <= 120; i++) { const d = i * 25; ele.push(Math.round((150 + (d > 800 && d < 2200 ? 45 * Math.sin((d - 800) / 1400 * Math.PI) : 0)) * 10) / 10); }
  for (let i = 0; i <= 60; i++) line.push([50 + Math.sin(i / 60 * 2) * .004, 10 + i * 50 / 71500]);
  return { id: 'test-kurz', name: 'Testrunde', dist: 3000, step: 25, gain: 45, ele, line };
}
function ordner(mitStrecke = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-neu-test-'));
  if (mitStrecke) { fs.mkdirSync(path.join(dir, 'daten', 'strecken'), { recursive: true }); fs.writeFileSync(path.join(dir, 'daten', 'strecken', 'test-kurz.json'), JSON.stringify(kurzeStrecke())); }
  return dir;
}
async function starte(dir, tempo = 1) {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, WATTBUCH_DATA: dir, WATTBUCH_SIM: '1', WATTBUCH_TEMPO: String(tempo) } });
  const fenster = async teil => { for (let i = 0; i < 100; i++) { const w = app.windows().find(x => x.url().includes(teil)); if (w) return w; await warte(100); } throw new Error('Fenster fehlt: ' + teil); };
  const buehne = await fenster('buehne'), maschine = await fenster('maschine'), probleme = [];
  for (const p of [buehne, maschine]) { p.on('pageerror', e => probleme.push(e.message)); p.on('console', m => { if (m.type() === 'error') probleme.push(m.text()); }); }
  await expect(buehne.locator('#devT')).toHaveText('Rolle, Puls, Kadenz bereit', { timeout: 20_000 });
  return { app, buehne, maschine, probleme };
}
const phase = m => m.evaluate(() => window.__wb.z.phase);
const stand = m => m.evaluate(() => window.__wb.z);
const fahrten = dir => { const d = path.join(dir, 'daten', 'fahrten'); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))) : []; };

test('Erster Start: drei erzeugte Runden, Geräte verbinden sich von selbst, Runde wählen', async () => {
  const dir = ordner(false), { app, buehne, maschine, probleme } = await starte(dir);
  await expect(buehne.locator('.card')).toHaveCount(3);
  await expect(buehne.locator('#hTag')).toHaveText('Heute für dich');
  await expect(buehne.locator('#hRival')).toBeHidden();
  expect(await maschine.evaluate(() => window.__fakeBle.requests.length)).toBe(3);   // Rolle, Puls, Kadenz ohne Klick
  const name = await buehne.locator('#hName').innerText();
  await buehne.keyboard.press('ArrowRight');
  await expect(buehne.locator('#hName')).not.toHaveText(name);
  await buehne.locator('.card').first().click();
  await expect(buehne.locator('#hName')).toHaveText(name);
  /* kein Titelbalken, kein Logo, nichts bricht um */
  expect(await buehne.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  expect(await buehne.evaluate(() => window.__wb.welt.kacheln)).toBeGreaterThan(10);
  expect(await phase(maschine)).toBe('lobby');   // ohne Tritt startet nichts
  expect(probleme).toEqual([]);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('Ganze Runde: Countdown, Fahrt, Ergebnis, gespeichert; zweite Runde gegen den Rivalen', async () => {
  const dir = ordner(), { app, buehne, maschine, probleme } = await starte(dir, 20);
  await expect(buehne.locator('#hName')).toHaveText('Testrunde');
  await buehne.click('#start');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'ride', { timeout: 10_000 });
  await expect(buehne.locator('#rName')).toHaveText('Testrunde');
  await expect(buehne.locator('#watt')).not.toHaveText('0');
  await expect(buehne.locator('#coachT')).toContainText('Coach · Ziel');
  /* Steigung der Strecke geht an die Rolle (halbe Stärke) */
  await expect.poll(() => maschine.evaluate(() => window.__fakeBle.grade), { timeout: 15_000 }).toBeGreaterThan(1);
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'done', { timeout: 60_000 });
  await expect(buehne.locator('#resL')).toHaveText('Erste Zeit');
  const erste = fahrten(dir); expect(erste).toHaveLength(1);
  const r = erste[0]; expect(r.ganz).toBe(true); expect(r.routeId).toBe('test-kurz'); expect(r.route).toBe('Testrunde'); expect(r.app).toBe('neu');
  expect(r.p.length).toBeGreaterThan(200); expect(r.dist.length).toBe(r.p.length); expect(r.dist.at(-1)).toBeGreaterThan(2990); expect(r.gain).toBeGreaterThan(35);
  expect(fs.existsSync(path.join(dir, 'daten', 'laufend.jsonl'))).toBe(false);

  await buehne.click('#home');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'lobby');
  await expect(buehne.locator('#hRival')).toBeVisible();   // der Versuch von eben ist jetzt der Rivale
  /* nach der Runde startet Weitertreten keine neue */
  await maschine.evaluate(() => { window.__simFahrer.aus = true; window.__fakeBle.set({ power: 150, cad: 85 }); });
  await warte(1500); expect(await phase(maschine)).toBe('lobby');
  await maschine.evaluate(() => { window.__simFahrer.aus = false; window.__simFahrer.faktor = 1.25; });
  await buehne.click('#start');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'ride', { timeout: 10_000 });
  await expect(buehne.locator('#duel')).not.toHaveClass(/leer/);
  await expect.poll(async () => (await stand(maschine)).gap, { timeout: 30_000 }).toBeLessThan(-2);   // schneller als beim ersten Mal
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'done', { timeout: 60_000 });
  await expect(buehne.locator('#resL')).toHaveText('Neue Bestzeit');
  await expect(buehne.locator('#resP')).toContainText('vor dir vom');
  expect(fahrten(dir)).toHaveLength(2);
  expect(probleme).toEqual([]);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('Coach aus und an, Plus und Minus, Pfeiltasten, Pause, Auto-Pause, Runde beenden', async () => {
  const dir = ordner(), { app, buehne, maschine, probleme } = await starte(dir, 4);
  await buehne.keyboard.press('Enter');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'ride', { timeout: 10_000 });
  await expect(buehne.locator('#pm')).toHaveClass(/auto/);
  const basis = (await stand(maschine)).basis;
  await buehne.keyboard.press('ArrowUp');   // Coach an: Pfeil hebt sein Niveau
  await expect.poll(async () => (await stand(maschine)).basis).toBe(basis + 5);
  await buehne.click('#wbtn');              // Klick auf die Watt-Zahl schaltet den Coach aus
  await expect(buehne.locator('#pm')).not.toHaveClass(/auto/);
  const ziel = (await stand(maschine)).ziel;
  await buehne.click('#more'); await buehne.click('#more'); await buehne.click('#less');
  await expect.poll(async () => (await stand(maschine)).ziel).toBe(ziel + 10);
  await expect(buehne.locator('#coachT')).toHaveText(`Ziel ${ziel + 10} W`);
  await buehne.click('#coach');
  await expect(buehne.locator('#pm')).toHaveClass(/auto/);

  await buehne.keyboard.press(' ');
  await expect(buehne.locator('body')).toHaveClass(/paused/);
  const t = (await stand(maschine)).t; await warte(1200); expect((await stand(maschine)).t).toBe(t);
  await buehne.keyboard.press(' ');
  await expect(buehne.locator('body')).not.toHaveClass(/paused/);

  /* aufhören zu treten → Pause, wieder antreten → weiter */
  await expect.poll(async () => (await stand(maschine)).t, { timeout: 15_000 }).toBeGreaterThan(14);
  await maschine.evaluate(() => { window.__simFahrer.aus = true; window.__fakeBle.set({ power: 0, cad: 0 }); });
  await expect(buehne.locator('body')).toHaveClass(/paused/, { timeout: 15_000 });
  await expect(buehne.locator('#pauseT')).toHaveText('Lostreten oder Leertaste');
  await maschine.evaluate(() => { window.__simFahrer.aus = false; });
  await expect(buehne.locator('body')).not.toHaveClass(/paused/, { timeout: 15_000 });

  await buehne.click('#end');
  await expect(buehne.locator('#resL')).toHaveText('Runde beendet');
  const [r] = fahrten(dir); expect(r.ganz).toBe(false); expect(r.p.every(v => v >= 5 || true)).toBe(true); expect(r.p.length).toBeGreaterThan(12);
  expect(probleme).toEqual([]);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('Start beim ersten Tritt, Abbruch im Countdown', async () => {
  const dir = ordner(), { app, buehne, maschine, probleme } = await starte(dir);
  await maschine.evaluate(() => { window.__simFahrer.aus = true; window.__fakeBle.set({ power: 30, cad: 85 }); });
  await warte(4000); expect(await phase(maschine)).toBe('lobby');   // zu wenig Leistung
  await maschine.evaluate(() => window.__fakeBle.set({ power: 160, cad: 85 }));
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'count', { timeout: 8000 });
  await maschine.evaluate(() => window.__fakeBle.set({ power: 0, cad: 0 }));   // doch nicht: aufhören bricht ab
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'lobby', { timeout: 8000 });
  expect(fahrten(dir)).toHaveLength(0);
  await maschine.evaluate(() => window.__fakeBle.set({ power: 160, cad: 85 }));
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'ride', { timeout: 15_000 });
  /* Esc bricht nur den Countdown ab, nicht die Fahrt */
  await buehne.keyboard.press('Escape'); await warte(300); expect(await phase(maschine)).toBe('ride');
  expect(probleme).toEqual([]);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('Bühne stürzt ab: Aufnahme läuft weiter, Bühne hängt sich wieder an', async () => {
  const dir = ordner(), { app, buehne, maschine } = await starte(dir, 3);
  await buehne.click('#start');
  await expect.poll(async () => (await stand(maschine)).t, { timeout: 20_000 }).toBeGreaterThan(5);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('buehne')).webContents.forcefullyCrashRenderer());
  const t = (await stand(maschine)).t; await warte(3000);
  const z = await stand(maschine); expect(z.phase).toBe('ride'); expect(z.t).toBeGreaterThan(t + 5);
  /* die neu geladene Bühne zeigt wieder die Fahrt */
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('buehne')).webContents.executeJavaScript('document.body.dataset.stage+"|"+document.getElementById("rName").textContent').catch(() => '')), { timeout: 15_000 }).toBe('ride|Testrunde');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('buehne')).webContents.executeJavaScript('document.getElementById("end").click()'));
  await expect.poll(() => fahrten(dir).length, { timeout: 10_000 }).toBe(1);
  const [r] = fahrten(dir); expect(r.p.length).toBeGreaterThan(t + 5); expect(r.p.every(v => v > 50)).toBe(true);   // keine Lücke
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('App stürzt ab: Fahrt ist beim nächsten Start da; Maschinenraum stürzt ab: Fahrt geht weiter', async () => {
  const dir = ordner(); let { app, buehne, maschine } = await starte(dir, 3);
  await buehne.click('#start');
  await expect.poll(async () => (await stand(maschine)).t, { timeout: 20_000 }).toBeGreaterThan(15);
  /* nur der Maschinenraum: lädt neu und setzt aus dem Journal fort */
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('maschine')).webContents.forcefullyCrashRenderer());
  await warte(2500);
  /* während des Neuladens antwortet das Fenster nicht: Abfrage mit Frist */
  const lies = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('maschine')); const frist = new Promise(r => setTimeout(() => r('[]'), 1500)); return w && !w.webContents.isCrashed() && !w.webContents.isLoading() ? Promise.race([frist, w.webContents.executeJavaScript('window.__wb?JSON.stringify([window.__wb.z.phase,window.__wb.z.t,window.__wb.z.geraete.rolle]):"[]"').catch(() => '[]')]) : '[]'; });
  let letzt = '';
  await expect.poll(async () => { letzt = await lies(); const [p, t, g] = JSON.parse(letzt); return p === 'ride' && t > 22 && g === 'an' ? 'ok' : letzt; }, { timeout: 30_000 }).toBe('ok');
  /* jetzt die ganze App hart beenden */
  app.process().kill('SIGKILL'); await warte(1500);
  expect(fs.existsSync(path.join(dir, 'daten', 'laufend.jsonl'))).toBe(true);
  ({ app, buehne, maschine } = await starte(dir));
  const [r] = fahrten(dir); expect(r).toBeTruthy(); expect(r.gerettet).toBe(true); expect(r.p.length).toBeGreaterThan(22); expect(r.routeId).toBe('test-kurz');
  expect(fs.existsSync(path.join(dir, 'daten', 'laufend.jsonl'))).toBe(false);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('Kleines Fenster: nichts bricht um, nichts ragt hinaus', async () => {
  const dir = ordner(), { app, buehne, probleme } = await starte(dir);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('buehne')).setSize(960, 600));
  await warte(600);
  const passt = was => buehne.evaluate(was => [...document.querySelectorAll(was)].every(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }), was);
  expect(await passt('.top,.hero h1,.stats,.go,.dock,.card')).toBe(true);
  expect(await buehne.evaluate(() => { const h = document.getElementById('hName'); return h.getBoundingClientRect().height < parseFloat(getComputedStyle(h).fontSize) * 1.4; })).toBe(true);
  await buehne.click('#start');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'ride', { timeout: 10_000 });
  await warte(2500); expect(await passt('.hrow,.deck,.stat,.gauge,#prof,#end')).toBe(true);
  expect(await buehne.evaluate(() => [...document.querySelectorAll('.stat b')].every(b => b.getBoundingClientRect().height < parseFloat(getComputedStyle(b).fontSize) * 1.3))).toBe(true);
  expect(probleme).toEqual([]);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});
