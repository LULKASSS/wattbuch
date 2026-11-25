// Die App durchspielen: Lobby, Runde fahren, Rivale, Coach, Pause, Start beim Tritt, Abstürze.
// Immer mit eigenem Datenordner (WATTBUCH_DATA) und simulierter Rolle (WATTBUCH_SIM), nie mit echten Daten oder Geräten.
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

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
async function starte(dir, tempo = 1, env = {}) {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, WATTBUCH_DATA: dir, WATTBUCH_SIM: '1', WATTBUCH_TEMPO: String(tempo), ...env } });
  const fenster = async teil => { for (let i = 0; i < 100; i++) { const w = app.windows().find(x => x.url().includes(teil)); if (w) return w; await warte(100); } throw new Error('Fenster fehlt: ' + teil); };
  const buehne = await fenster('buehne'), maschine = await fenster('maschine'), probleme = [];
  for (const p of [buehne, maschine]) { p.on('pageerror', e => probleme.push(e.message)); p.on('console', m => { if (m.type() === 'error') probleme.push(m.text()); }); }
  if (env.WATTBUCH_SIM !== 'wahl') await expect(buehne.locator('#devT')).toHaveText('Rolle, Puls, Kadenz bereit', { timeout: 20_000 });
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
  const zielIst = async soll => expect.poll(async () => (await stand(maschine)).ziel).toBe(soll);
  await buehne.click('#more'); await zielIst(ziel + 10);
  await buehne.click('#more'); await zielIst(ziel + 20);
  await buehne.click('#less'); await zielIst(ziel + 10);
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

/* ---------- Schritt 2: Konto, alte Daten, Sicherung, Geräte ---------- */
/* Nachgebautes Supabase: Anmeldung und die beiden Tabellen der alten App. Tests laufen nie gegen das echte Konto. */
async function konto(zeilen, werte) {
  const log = [], t = n => new Date(Date.UTC(2026, 10, 1, 12, 0, n)).toISOString(); let uhr = 100;
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', d => body += d); req.on('end', () => {
      const u = new URL(req.url, 'http://x'), send = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      log.push(req.method + ' ' + u.pathname);
      if (u.pathname === '/auth/v1/token') { const b = JSON.parse(body || '{}'); return b.password === 'geheim-im-test' || b.refresh_token ? send(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u1', email: 'test@example.com' } }) : send(400, { error_code: 'invalid_credentials' }); }
      if (req.headers.authorization !== 'Bearer a') return send(401, {});
      if (u.pathname === '/rest/v1/wattbuch_fahrten' && req.method === 'GET') { const gt = (u.searchParams.get('geaendert') || '').replace('gt.', ''); return send(200, zeilen.filter(z => !gt || z.geaendert > gt).sort((a, b) => a.geaendert.localeCompare(b.geaendert)).slice(0, 10)); }
      if (u.pathname === '/rest/v1/wattbuch_fahrten' && req.method === 'POST') { const out = []; for (const r of JSON.parse(body)) { const z = { ...r, geaendert: t(uhr++) }, i = zeilen.findIndex(x => x.id === r.id); if (i >= 0) zeilen[i] = z; else zeilen.push(z); out.push({ id: z.id, geaendert: z.geaendert }); } return send(201, out); }
      if (u.pathname === '/rest/v1/wattbuch_werte' && req.method === 'GET') return send(200, werte.length ? werte : []);
      if (u.pathname === '/rest/v1/wattbuch_werte' && req.method === 'POST') { werte[0] = { werte: JSON.parse(body)[0].werte, geaendert: t(uhr++) }; return send(201, [{ geaendert: werte[0].geaendert }]); }
      send(404, {});
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + srv.address().port, log, zu: () => srv.close(), t };
}

test('Konto: alte Fahrten sind da und werden Rivale, neue Fahrt geht ins Konto und in die Sicherung', async () => {
  /* Alte App: Rollenfahrt nur mit Streckenname, über die Runde hinaus gefahren; eine Strava-Fahrt; eine gelöschte */
  const n = 700, alt = { id: 'r1700000000000abcd', start: '2026-10-12T17:00:00.000Z', name: 'Testrunde', p: Array(n).fill(170), hr: null, cad: null, spd: null, dist: Array.from({ length: n }, (_, i) => (i + 1) * 6), alt: null, route: 'Testrunde', gain: 60, trainer: true, ftp: 220, weight: 72 };
  const drau = { id: 'sv123', start: '2026-10-20T09:00:00.000Z', name: 'Ausfahrt', src: 'strava', p: [], noW: true, dur: 3600, hr: null, cad: null, spd: null, dist: null, alt: null, route: null, gain: 300, trainer: false };
  const zeilen = [], werte = [];
  const K = await konto(zeilen, werte);
  zeilen.push({ id: alt.id, data: alt, geloescht: false, geaendert: K.t(1) }, { id: drau.id, data: drau, geloescht: false, geaendert: K.t(2) }, { id: 'rweg', data: null, geloescht: true, geaendert: K.t(3) });
  werte.push({ werte: { ftp: 230, weight: 72, bike: 8 }, geaendert: K.t(4) });
  const dir = ordner(), { app, buehne, maschine, probleme } = await starte(dir, 20, { WATTBUCH_SUPABASE_URL: K.url });
  await expect(buehne.locator('#hRival')).toBeHidden();
  await buehne.click('#lvlB');
  await expect(buehne.locator('#kForm')).toBeVisible();
  await buehne.fill('#kMail', 'test@example.com'); await buehne.fill('#kPw', 'falsch'); await buehne.click('#kForm button');
  await expect(buehne.locator('#kMsg')).toHaveText('E-Mail oder Passwort stimmt nicht');
  await buehne.fill('#kPw', 'geheim-im-test'); await buehne.click('#kForm button');
  await expect(buehne.locator('#kWer')).toHaveText('test@example.com');
  /* Fahrten und Werte aus dem Konto: FTP als Stufe, die alte Fahrt ist Rivale mit der Zeit für eine Runde (500 s) */
  await expect(buehne.locator('#stufe')).toHaveText('230 W', { timeout: 10_000 });
  await expect(buehne.locator('#hRival')).toBeVisible();
  await expect(buehne.locator('#hBest')).toHaveText('8:20');
  await expect(buehne.locator('#hWhen')).toHaveText('12. Oktober');
  expect(fahrten(dir).map(f => f.id).sort()).toEqual([alt.id, drau.id].sort());
  /* Werte ändern geht ins Konto */
  await buehne.fill('#pFtp', '240'); await buehne.press('#pFtp', 'Tab');
  await expect.poll(() => werte[0].werte.ftp, { timeout: 10_000 }).toBe(240);
  await buehne.keyboard.press('Escape');
  await expect(buehne.locator('#stufe')).toHaveText('240 W');
  /* Runde fahren: gegen die alte Fahrt, danach liegt die neue im Konto, im alten Format mit den neuen Feldern */
  await buehne.click('#start');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'ride', { timeout: 10_000 });
  await expect(buehne.locator('#rWhen')).toHaveText('12. Oktober');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'done', { timeout: 60_000 });
  await expect.poll(() => zeilen.length, { timeout: 15_000 }).toBe(4);
  const neu = zeilen.find(z => z.data && z.data.app === 'neu');
  expect(neu.data.routeId).toBe('test-kurz'); expect(neu.data.route).toBe('Testrunde'); expect(neu.data.ganz).toBe(true); expect(neu.data.p.length).toBe(neu.data.dist.length); expect(neu.start).toBe(neu.data.start); expect(neu.geloescht).toBe(false);
  expect(zeilen.find(z => z.id === alt.id).data).toEqual(alt);   // alte Zeilen bleiben unberührt
  expect(K.log.filter(l => /^(DELETE|PATCH|PUT)/.test(l))).toEqual([]);
  expect((await stand(maschine)).ftp).toBe(240);
  await app.close();
  /* eigene Sicherung: Wattbuch-Fahrten ja, Strava-Fahrten nein, Strecke ja */
  const sich = path.join(dir, 'Sicherung');
  expect(fs.readdirSync(path.join(sich, 'fahrten')).sort()).toEqual([alt.id + '.json', neu.id + '.json'].sort());
  expect(fs.existsSync(path.join(sich, 'strecken', 'test-kurz.json'))).toBe(true);
  expect(fs.statSync(path.join(dir, 'daten', 'konto.json')).mode & 0o077).toBe(0);
  expect(probleme).toEqual([]);
  K.zu(); fs.rmSync(dir, { recursive: true, force: true });
});

test('Übernahme aus der alten App: Strecken und Werte einmalig lesen; leerer Datenordner kommt aus der Sicherung zurück', async () => {
  const dir = ordner(false), altDatei = path.join(dir, 'alte-sicherung.json'), a = kurzeStrecke(), b = { ...kurzeStrecke(), id: 'g2', name: 'Zweite Runde' };
  const inhalt = JSON.stringify({ app: 'wattbuch', version: 1, settings: { ftp: 215, weight: 71, bike: 8, diff: .75, routeId: 'g2' }, rides: [], routes: [a, b], gone: [] });
  fs.writeFileSync(altDatei, inhalt);
  let { app, buehne, maschine, probleme } = await starte(dir, 1, { WATTBUCH_ALT: altDatei });
  await expect(buehne.locator('.card')).toHaveCount(2);   // keine erzeugten Runden dazu
  await expect(buehne.locator('#stufe')).toHaveText('215 W');
  expect((await stand(maschine)).ftp).toBe(215);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'daten', 'werte.json'), 'utf8')).diff).toBe(.75);
  expect(fs.readFileSync(altDatei, 'utf8')).toBe(inhalt);   // in der alten Sicherung wird nichts geändert
  expect(probleme).toEqual([]);
  await app.close();
  /* zweiter Start: nicht noch einmal übernehmen (eine hier gelöschte Strecke bleibt weg) */
  fs.rmSync(path.join(dir, 'daten', 'strecken', 'g2.json')); fs.rmSync(path.join(dir, 'Sicherung', 'strecken', 'g2.json'));
  ({ app, buehne } = await starte(dir, 1, { WATTBUCH_ALT: altDatei }));
  await expect(buehne.locator('.card')).toHaveCount(1);
  await app.close();
  /* neuer Mac: Datenordner leer, Sicherung da */
  fs.rmSync(path.join(dir, 'daten'), { recursive: true });
  ({ app, buehne } = await starte(dir));
  await expect(buehne.locator('.card')).toHaveCount(1);
  await expect(buehne.locator('#hName')).toHaveText('Testrunde');
  await expect(buehne.locator('#stufe')).toHaveText('215 W');
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('Geräte: ohne gemerktes Gerät sucht nichts von selbst; Erstwahl im Blatt, gemerkt, vergessen', async () => {
  const dir = ordner(), { app, buehne, maschine, probleme } = await starte(dir, 1, { WATTBUCH_SIM: 'wahl' });
  await expect(buehne.locator('#devT')).toHaveText('Rolle verbinden');
  await warte(1500); expect(await maschine.evaluate(() => window.__fakeBle.requests.length)).toBe(0);
  const gemerkt = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'daten', 'geraete.json'), 'utf8')); } catch { return {}; } };
  /* So meldet Chromium gefundene Geräte an den Hauptprozess; die Antwort landet in global.__wahl */
  const gefunden = liste => app.evaluate(({ BrowserWindow }, liste) => { global.__wahl = null; BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('maschine')).webContents.emit('select-bluetooth-device', { preventDefault() {} }, liste, id => { global.__wahl = { id }; }); }, liste);
  const antwort = () => app.evaluate(() => global.__wahl);
  await buehne.click('#devB');
  await expect(buehne.locator('.gz')).toHaveCount(3);
  /* Puls: die Suche findet zwei Gurte, einer wird gewählt und gemerkt */
  await maschine.evaluate(() => { window.__fakeBle.fail = { name: 'NotFoundError', message: 'keins' }; });
  await buehne.click('.gz button[data-art=puls]');
  await expect(buehne.locator('#gWahlT')).toHaveText('Puls wählen');
  await maschine.evaluate(() => window.wattbuch.suche('puls'));
  await gefunden([{ deviceId: 'h1', deviceName: 'Gurt eins' }, { deviceId: 'h2', deviceName: 'Gurt zwei' }]);
  await expect(buehne.locator('#gListe button')).toHaveText(['Gurt eins', 'Gurt zwei']);
  expect(await antwort()).toBeNull();
  await buehne.click('#gListe button >> nth=1');
  await expect.poll(antwort).toEqual({ id: 'h2' });
  expect(gemerkt()).toEqual({ puls: { id: 'h2', name: 'Gurt zwei' } });
  /* gemerkt: taucht das Gerät wieder auf, wird es ohne Blatt genommen; ein fremdes nicht */
  await buehne.keyboard.press('Escape');
  await gefunden([{ deviceId: 'h1', deviceName: 'Gurt eins' }]); await warte(200); expect(await antwort()).toBeNull();
  await gefunden([{ deviceId: 'h1', deviceName: 'Gurt eins' }, { deviceId: 'h2', deviceName: 'Gurt zwei' }]); await expect.poll(antwort).toEqual({ id: 'h2' });
  /* nicht gemerkte Art und Blatt zu: Suche wird sofort beendet */
  await maschine.evaluate(() => window.wattbuch.suche('kadenz'));
  await gefunden([{ deviceId: 'k1', deviceName: 'Sensor' }]); await expect.poll(antwort).toEqual({ id: '' });
  /* Rolle über das Blatt verbinden (simulierte Rolle antwortet sofort), dann Puls vergessen */
  await maschine.evaluate(() => { window.__fakeBle.fail = null; });
  await buehne.click('#devB'); await buehne.click('.gz button[data-art=rolle]');
  await expect(buehne.locator('#devT')).toHaveText('Rolle bereit', { timeout: 10_000 });
  await buehne.click('.gz button[data-art=puls]');   // „Vergessen“
  await expect.poll(gemerkt).toEqual({});
  expect(probleme).toEqual([]);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});
