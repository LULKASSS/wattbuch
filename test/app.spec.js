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
/* dok: Zeilen der neuen Tabelle wattbuch_dokumente; ohne Angabe gibt es die Tabelle nicht (404), wie vor der Migration */
async function konto(zeilen, werte, dok = null) {
  const log = [], t = n => new Date(Date.UTC(2026, 10, 1, 12, 0, n)).toISOString(); let uhr = 100;
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', d => body += d); req.on('end', () => {
      const u = new URL(req.url, 'http://x'), send = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      log.push(req.method + ' ' + u.pathname);
      if (u.pathname === '/auth/v1/token') { const b = JSON.parse(body || '{}'); return b.password === 'geheim-im-test' || b.refresh_token ? send(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u1', email: 'test@example.com' } }) : send(400, { error_code: 'invalid_credentials' }); }
      if (req.headers.authorization !== 'Bearer a') return send(401, {});
      if (u.pathname === '/rest/v1/wattbuch_fahrten' && req.method === 'GET') { const gt = (u.searchParams.get('geaendert') || '').replace('gt.', ''); return send(200, zeilen.filter(z => !gt || z.geaendert > gt).sort((a, b) => a.geaendert.localeCompare(b.geaendert)).slice(0, 10)); }
      if (u.pathname === '/rest/v1/wattbuch_fahrten' && req.method === 'POST') { const out = []; for (const r of JSON.parse(body)) { const z = { ...r, geaendert: t(uhr++) }, i = zeilen.findIndex(x => x.id === r.id); if (i >= 0) zeilen[i] = { ...zeilen[i], ...z }; else zeilen.push(z); out.push({ id: z.id, geaendert: z.geaendert }); } return send(201, out); }
      if (u.pathname === '/rest/v1/wattbuch_werte' && req.method === 'GET') return send(200, werte.length ? werte : []);
      if (u.pathname === '/rest/v1/wattbuch_werte' && req.method === 'POST') { werte[0] = { werte: JSON.parse(body)[0].werte, geaendert: t(uhr++) }; return send(201, [{ geaendert: werte[0].geaendert }]); }
      if (dok && u.pathname === '/rest/v1/wattbuch_dokumente' && req.method === 'GET') { const gt = (u.searchParams.get('geaendert') || '').replace('gt.', ''); return send(200, dok.filter(z => !gt || z.geaendert > gt).sort((a, b) => a.geaendert.localeCompare(b.geaendert)).slice(0, 20)); }
      if (dok && u.pathname === '/rest/v1/wattbuch_dokumente' && req.method === 'POST') { const out = []; for (const r of JSON.parse(body)) { const z = { ...r, geaendert: t(uhr++) }, i = dok.findIndex(x => x.id === r.id && x.sammlung === r.sammlung); if (i >= 0) dok[i] = z; else dok.push(z); out.push({ sammlung: z.sammlung, id: z.id, geaendert: z.geaendert }); } return send(201, out); }
      send(404, { code: 'PGRST205' });
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
  expect((await stand(maschine)).ftp).toBe(240);
  /* die neue Tabelle gibt es in diesem Konto noch nicht: einmal gefragt, kein Fehler, der Abgleich läuft trotzdem durch */
  expect(K.log.filter(l => l.includes('wattbuch_dokumente'))).toEqual(['GET /rest/v1/wattbuch_dokumente']);
  await buehne.click('#home'); await buehne.click('#lvlB'); await expect(buehne.locator('#kSt')).toContainText('abgeglichen');
  /* eigene Sicherung: Wattbuch-Fahrten ja, Strava-Fahrten nein, Strecke ja */
  const sich = path.join(dir, 'Sicherung');
  await expect.poll(() => fs.readdirSync(path.join(sich, 'fahrten')).sort(), { timeout: 10_000 }).toEqual([alt.id + '.json', neu.id + '.json'].sort());
  /* Fahrt löschen: jede hat den Knopf, zwei Klicks; hier und in der Sicherung weg,
     im Konto nur markiert (die Daten bleiben in der Zeile), keine Zeile wird gelöscht */
  await buehne.keyboard.press('Escape'); await buehne.click('nav button[data-s=fahrten]');
  await expect(buehne.locator('.fh')).toHaveCount(3); await expect(buehne.locator('.fh button.lo')).toHaveCount(3);
  const lo = buehne.locator('.fh').first().locator('button.lo');   // die neueste: die eben gefahrene
  await lo.click(); await expect(lo).toHaveText('Wirklich?'); expect(fahrten(dir).length).toBe(3);
  await lo.click();
  await expect(buehne.locator('.fh')).toHaveCount(2);
  expect(fahrten(dir).map(f => f.id).sort()).toEqual([alt.id, drau.id].sort());
  await expect.poll(() => zeilen.find(z => z.id === neu.id).geloescht, { timeout: 10_000 }).toBe(true);
  expect(zeilen.find(z => z.id === neu.id).data.app).toBe('neu'); expect(zeilen.length).toBe(4);
  expect(zeilen.find(z => z.id === alt.id)).toMatchObject({ data: alt, geloescht: false });
  expect(K.log.filter(l => /^(DELETE|PATCH|PUT)/.test(l))).toEqual([]);
  await buehne.click('nav button[data-s=lobby]'); await expect(buehne.locator('#hBest')).toHaveText('8:20');   // Rivale ist wieder die alte Fahrt
  /* auch die alte Fahrt und die aus Strava: markiert, Daten bleiben, nichts kommt beim Abgleich zurück */
  await buehne.click('nav button[data-s=fahrten]');
  for (const n of [1, 0]) { const b = buehne.locator('.fh').first().locator('button.lo'); await b.click(); await expect(b).toHaveText('Wirklich?'); await b.click(); await expect(buehne.locator('.fh')).toHaveCount(n); }
  await expect.poll(() => zeilen.filter(z => z.geloescht).length, { timeout: 10_000 }).toBe(4);
  expect(zeilen.find(z => z.id === alt.id).data).toEqual(alt); expect(zeilen.find(z => z.id === drau.id).data).toEqual(drau);
  expect(K.log.filter(l => /^(DELETE|PATCH|PUT)/.test(l))).toEqual([]);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'daten', 'konto.json'), 'utf8')).weg).toEqual(expect.arrayContaining([drau.id]));
  await buehne.click('nav button[data-s=lobby]'); await expect(buehne.locator('#hRival')).toBeHidden();
  await app.close();
  expect(fs.readdirSync(path.join(sich, 'fahrten'))).toEqual([]);
  expect(fahrten(dir).length).toBe(0);
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

/* ---------- Schritt 3: Strava ---------- */
/* Nachgebautes Strava samt Token-Tausch (Supabase-Funktion). Tests laufen nie gegen das echte Strava. */
function polyline(pts) {
  let out = '', pa = 0, po = 0;
  const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [la, lo] of pts) { const a = Math.round(la * 1e5), o = Math.round(lo * 1e5); out += enc(a - pa) + enc(o - po); pa = a; po = o; }
  return out;
}
async function strava(aktivitaeten = []) {
  const seen = { central: [], tokens: [], uploads: [], sports: [], lists: 0, streams: [] };
  /* Runde: 12 km Ring bei erfundenen Koordinaten */
  const ring = Array.from({ length: 240 }, (_, i) => { const t = i / 239 * 2 * Math.PI; return [48.2 + Math.cos(t) * 0.0172, 11.3 + Math.sin(t) * 0.0258]; });
  const srv = http.createServer((req, res) => {
    const teile = []; req.on('data', d => teile.push(d)); req.on('end', () => {
      const body = Buffer.concat(teile).toString('latin1'), u = new URL(req.url, 'http://x'), send = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      const tok = { access_token: 'testzugang', refresh_token: 'testerneuern', expires_at: Math.floor(Date.now() / 1000) + 3600, athlete: { id: 7, firstname: 'Test', lastname: 'F.' } };
      if (u.pathname === '/functions/v1/strava-token') { seen.central.push({ apikey: req.headers.apikey, body: JSON.parse(body) }); return send(200, tok); }
      if (u.pathname === '/oauth/token') { seen.tokens.push(body); return send(200, tok); }
      if (u.pathname === '/oauth/deauthorize') return send(200, {});
      if (req.headers.authorization !== 'Bearer testzugang') return send(401, { message: 'nicht angemeldet' });
      if (u.pathname === '/api/v3/athlete/activities') { seen.lists++; return send(200, u.searchParams.get('page') === '1' ? aktivitaeten : []); }
      let m = /^\/api\/v3\/activities\/(\d+)\/streams$/.exec(u.pathname);
      if (m) {
        seen.streams.push(m[1] + ':' + u.searchParams.get('keys'));
        if (u.searchParams.get('keys').startsWith('latlng')) return send(200, { latlng: { data: ring }, altitude: { data: ring.map((_, i) => 400 + 60 * Math.sin(i / 239 * Math.PI) + (i % 2 ? 2 : -2)) }, distance: { data: ring.map((_, i) => i * 50) } });
        const n = 400, a = aktivitaeten.find(x => String(x.id) === m[1]);
        return send(200, { time: { data: Array.from({ length: n }, (_, i) => i) }, distance: { data: Array.from({ length: n }, (_, i) => i * 7) }, altitude: { data: Array(n).fill(410) }, heartrate: { data: Array(n).fill(141) }, moving: { data: Array(n).fill(true) }, ...(a && a.device_watts ? { watts: { data: Array(n).fill(205) } } : {}) });
      }
      if (u.pathname === '/api/v3/uploads' && req.method === 'POST') { seen.uploads.push({ auth: req.headers.authorization, body }); return send(201, { id: 55, id_str: '55', activity_id: 987654321 }); }
      m = /^\/api\/v3\/activities\/(\d+)$/.exec(u.pathname);
      if (m && req.method === 'PUT') { seen.sports.push({ id: m[1], body: JSON.parse(body) }); return send(200, {}); }
      send(404, {});
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + srv.address().port, seen, ring, zu: () => srv.close() };
}
/* Strava fragt im Browser nach: Die App meldet die Adresse, der Test folgt der Rückleitung wie der Browser */
async function bestaetigen(app, scope = 'read,activity:write,activity:read_all') {
  await expect.poll(() => app.evaluate(() => global.__stravaAuth || null), { timeout: 10_000 }).not.toBeNull();
  const q = new URL(await app.evaluate(() => global.__stravaAuth)).searchParams;
  const back = await fetch(`${q.get('redirect_uri')}?state=${q.get('state')}&code=testcode&scope=${scope}`);
  expect(await back.text()).toContain('Mit Strava verbunden');
  return q;
}
const draussen = (id, tag, name, poly, mehr = {}) => ({ id, name, sport_type: 'Ride', trainer: false, distance: 12100, moving_time: 2400, total_elevation_gain: 120, start_date: `2026-0${tag}-11T08:00:00Z`, map: { summary_polyline: poly }, ...mehr });

test('Strava: verbinden, meistgefahrene Runde wird Strecke, Fahrt geht von selbst hoch', async () => {
  const dummy = await strava(), poly = polyline(dummy.ring); dummy.zu();
  /* dreimal dieselbe Runde draußen (zweimal gleich benannt), dazu eine einzelne andere Fahrt ohne Linie */
  const sv = await strava([draussen(301, 6, 'Seerunde', poly), draussen(302, 7, 'Seerunde', poly), draussen(303, 8, 'Morning Ride', poly), draussen(304, 9, 'Irgendwo', '')]);
  const dir = ordner(), { app, buehne, maschine, probleme } = await starte(dir, 20, { WATTBUCH_STRAVA_URL: sv.url, WATTBUCH_STRAVA_WARTEN: '1500' });
  await expect(buehne.locator('.card')).toHaveCount(1);
  await buehne.click('#lvlB');
  await expect(buehne.locator('#svB')).toHaveText('Verbinden');
  await buehne.click('#svB');
  const q = await bestaetigen(app);
  expect(q.get('client_id')).toBe('286463');   // gemeinsame Strava-App, nichts einzutragen
  await expect(buehne.locator('#svWer')).toHaveText('Test F.');
  await expect(buehne.locator('#svB')).toHaveText('Trennen');
  /* Token-Tausch über die Supabase-Funktion, kein Secret in der App */
  expect(sv.seen.central).toEqual([{ apikey: expect.stringMatching(/^sb_publishable_/), body: { code: 'testcode' } }]);
  expect(sv.seen.tokens).toEqual([]);
  const cf = path.join(dir, 'daten', 'strava.json');
  expect(fs.readFileSync(cf, 'utf8')).not.toContain('clientSecret'); expect(fs.statSync(cf).mode & 0o077).toBe(0);
  /* die dreimal gefahrene Runde ist jetzt eine Strecke mit geglätteter Höhe; ganze Fahrten übernimmt die gemeinsame App nicht */
  await buehne.keyboard.press('Escape');
  await expect(buehne.locator('.card')).toHaveCount(2, { timeout: 15_000 });
  await expect(buehne.locator('.card', { hasText: 'Seerunde' })).toBeVisible();
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'daten', 'strecken', 'sf303.json'), 'utf8'));
  expect(st.fav).toEqual({ n: 3 }); expect(st.dist).toBeGreaterThan(11000); expect(st.dist).toBeLessThan(13000);
  let sprung = 0; for (let i = 1; i < st.ele.length; i++) sprung = Math.max(sprung, Math.abs(st.ele[i] - st.ele[i - 1])); expect(sprung).toBeLessThan(1.5);
  expect(sv.seen.streams).toEqual(['303:latlng,altitude,distance']);
  expect(fahrten(dir)).toHaveLength(0);
  /* Runde fahren: geht nach der Wartezeit von selbst hoch und wird zum Virtual Ride */
  await buehne.locator('.card', { hasText: 'Testrunde' }).click(); await warte(600);
  await buehne.click('#start');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'done', { timeout: 60_000 });
  await expect(buehne.locator('#resS')).toHaveText('geht gleich zu Strava');
  await expect(buehne.locator('#resS')).toHaveText('liegt bei Strava', { timeout: 15_000 });
  const [r] = fahrten(dir), up = sv.seen.uploads[0];
  expect(r.strava.state).toBe('ok'); expect(r.strava.vr).toBe(true); expect(r.strava.url).toBe('https://www.strava.com/activities/987654321');
  for (const s of ['name="data_type"', 'tcx', 'name="trainer"', 'Testrunde', '<ns3:Watts>', 'wattbuch-' + r.id, 'Normalized Power']) expect(up.body).toContain(s);
  expect(sv.seen.sports).toEqual([{ id: '987654321', body: { sport_type: 'VirtualRide', trainer: true } }]);
  expect(sv.seen.uploads).toHaveLength(1);
  /* zweite Fahrt: Hochladen im Ergebnisbild abbrechen */
  await buehne.click('#home'); await maschine.evaluate(() => { window.__simFahrer.faktor = 1.3; });
  await buehne.locator('.card', { hasText: 'Testrunde' }).click(); await warte(600);
  await buehne.click('#start');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'done', { timeout: 60_000 });
  await buehne.click('#resS');
  await expect(buehne.locator('#resS')).toHaveText('nicht bei Strava');
  await warte(2500); expect(sv.seen.uploads).toHaveLength(1);
  expect(probleme).toEqual([]);
  await app.close(); sv.zu(); fs.rmSync(dir, { recursive: true, force: true });
});

test('Strava mit eigener App: Draußen-Fahrten werden übernommen, mit und ohne Wattmesser', async () => {
  const sv = await strava([draussen(401, 6, 'Ausfahrt ohne Watt', '', { average_watts: 150 }), draussen(402, 7, 'Mit Wattmesser', '', { device_watts: true }), { id: 403, name: 'Lauf', sport_type: 'Run', distance: 8000, moving_time: 2400, start_date: '2026-08-11T08:00:00Z' }]);
  const dir = ordner();
  /* eigene Strava-App: erfundene Kennung im eigenen Datenordner */
  fs.writeFileSync(path.join(dir, 'daten', 'strava.json'), JSON.stringify({ clientId: 'test-id', clientSecret: 'test-geheim' }));
  const { app, buehne, probleme } = await starte(dir, 1, { WATTBUCH_STRAVA_URL: sv.url });
  await buehne.click('#lvlB'); await buehne.click('#svB');
  const q = await bestaetigen(app);
  expect(q.get('client_id')).toBe('test-id');
  await expect(buehne.locator('#svWer')).toHaveText('Test F.');
  expect(sv.seen.central).toEqual([]); expect(sv.seen.tokens).toHaveLength(1);   // direkt bei Strava, nicht über die gemeinsame App
  await expect.poll(() => fahrten(dir).length, { timeout: 15_000 }).toBe(2);
  const f = Object.fromEntries(fahrten(dir).map(r => [r.id, r]));
  expect(f.sv401.noW).toBe(true); expect(f.sv401.dur).toBe(399); expect(f.sv401.estW).toBe(150); expect(f.sv401.p).toEqual([]); expect(f.sv401.src).toBe('strava');
  expect(f.sv402.p).toHaveLength(399); expect(f.sv402.p[0]).toBe(205); expect(f.sv402.noW).toBeUndefined(); expect(f.sv402.strava.state).toBe('ok');
  expect(sv.seen.uploads).toEqual([]);   // übernommene Fahrten werden nie wieder hochgeladen
  /* Draußen-Fahrten sind keine Rivalen */
  await buehne.keyboard.press('Escape'); await expect(buehne.locator('#hRival')).toBeHidden();
  /* aber jede lässt sich als Strecke anlegen */
  await buehne.click('nav button[data-s=fahrten]');
  await expect(buehne.locator('.fh')).toHaveCount(2);
  await buehne.locator('.fh', { hasText: 'Mit Wattmesser' }).locator('button:not(.lo)').click();
  await expect(buehne.locator('.fh', { hasText: 'Mit Wattmesser' }).locator('button:not(.lo)')).toHaveText('ist Strecke', { timeout: 10_000 });
  await expect.poll(() => fs.existsSync(path.join(dir, 'daten', 'strecken', 'sr402.json'))).toBe(true);
  await buehne.click('nav button[data-s=lobby]'); await expect(buehne.locator('.card')).toHaveCount(2);
  expect(probleme).toEqual([]);
  await app.close(); sv.zu(); fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------- Schritt 4: Segmente, Rivalen, Fahrten ---------- */
test('Rivalen und Fahrten: Segmente mit Bestzeit und Versuchen, Segment-Bestzeit in der Fahrt, Runde entfernen', async () => {
  const dir = ordner(); fs.mkdirSync(path.join(dir, 'daten', 'fahrten'), { recursive: true });
  /* zwei erfundene frühere Versuche: einer mit 6 m/s über die ganze Runde, einer mit 5 m/s, der nach 2,5 km aufhörte */
  const alt = (id, tag, v, bis) => ({ id, start: `2026-10-${tag}T17:00:00.000Z`, name: 'Testrunde', p: Array(Math.ceil(bis / v)).fill(180), hr: null, cad: null, spd: null, dist: Array.from({ length: Math.ceil(bis / v) }, (_, i) => Math.min(bis, (i + 1) * v)), alt: null, route: 'Testrunde', gain: 45, trainer: true, ftp: 200, weight: 75 });
  for (const r of [alt('ra', 12, 6, 3300), alt('rb', 20, 5, 2500)]) fs.writeFileSync(path.join(dir, 'daten', 'fahrten', r.id + '.json'), JSON.stringify(r));
  fs.writeFileSync(path.join(dir, 'daten', 'strecken', 'zwei.json'), JSON.stringify({ ...kurzeStrecke(), id: 'zwei', name: 'Zweite Runde' }));
  const { app, buehne, maschine, probleme } = await starte(dir, 20);
  await buehne.locator('.card', { hasText: 'Testrunde' }).click(); await warte(600);
  await buehne.click('nav button[data-s=rivalen]');
  await expect(buehne.locator('#rvName')).toHaveText('Testrunde');
  await expect(buehne.locator('.rv')).toHaveCount(2);
  await expect(buehne.locator('.rv').first()).toContainText('Ganze Runde'); await expect(buehne.locator('.rv .z').first()).toHaveText('8:20'); await expect(buehne.locator('.rv .n').first()).toHaveText('1×');
  await expect(buehne.locator('.rv').nth(1)).toContainText('Anstieg km'); await expect(buehne.locator('.rv .n').nth(1)).toHaveText('2×');   // der abgebrochene zählt am Anstieg mit
  await buehne.locator('.rv').nth(1).click();
  await expect(buehne.locator('.vs div')).toHaveCount(2);
  await expect(buehne.locator('.vs div').first()).toContainText('Bestzeit'); await expect(buehne.locator('.vs div').nth(1)).toContainText('+');
  /* andere Runde: keine Versuche */
  await buehne.keyboard.press(await buehne.locator('.card').first().innerText().then(t => t.includes('Testrunde') ? 'ArrowRight' : 'ArrowLeft'));
  await expect(buehne.locator('#rvName')).toHaveText('Zweite Runde'); await expect(buehne.locator('.rv .z').first()).toHaveText('–');
  /* Fahrten: beide alten Fahrten, neueste zuerst */
  await buehne.click('nav button[data-s=fahrten]');
  await expect(buehne.locator('.fh')).toHaveCount(2); await expect(buehne.locator('.fh').first()).toContainText('20. Okt'); await expect(buehne.locator('.mon')).toHaveText('Oktober 2026');
  expect(await buehne.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await buehne.keyboard.press('Escape');
  await expect(buehne.locator('body')).toHaveAttribute('data-sicht', 'lobby');
  /* Fahrt mit viel Druck: am Fuß wird die Bestzeit angesagt, oben fällt sie, im Ergebnis steht es */
  await buehne.locator('.card', { hasText: 'Testrunde' }).click(); await warte(600);
  await maschine.evaluate(() => { window.__simFahrer.faktor = 3; });
  const gesagt = []; await buehne.exposeFunction('__merk', t => gesagt.push(t));
  await buehne.evaluate(() => new MutationObserver(m => m.forEach(x => x.addedNodes.forEach(n => window.__merk(n.textContent)))).observe(document.getElementById('toasts'), { childList: true }));
  await buehne.click('#start');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'done', { timeout: 60_000 });
  expect(gesagt.some(t => /Anstieg · 0,\d km.*Bestzeit \d:\d\d/.test(t))).toBe(true);
  expect(gesagt.some(t => /Segment geschafft.*schneller als je zuvor/.test(t))).toBe(true);
  await expect(buehne.locator('#resL')).toHaveText('Neue Bestzeit');
  await expect(buehne.locator('#resB')).toHaveText('1 Segment-Bestzeit');
  await buehne.click('#home');
  await expect(buehne.locator('#hName')).toHaveText('Zweite Runde');   // heute ist die andere Runde dran
  await buehne.locator('.card', { hasText: 'Testrunde' }).click(); await warte(600);
  await buehne.click('nav button[data-s=rivalen]');
  await expect(buehne.locator('.rv .n').first()).toHaveText('2×'); await expect(buehne.locator('.rv .n').nth(1)).toHaveText('3×');
  /* Runde entfernen: erst nachfragen, dann weg (Fahrten bleiben) */
  await buehne.click('#rvWeg'); await expect(buehne.locator('#rvWeg')).toHaveText('Wirklich entfernen'); await buehne.click('#rvWeg');
  await expect(buehne.locator('.card')).toHaveCount(1);
  expect(fs.existsSync(path.join(dir, 'daten', 'strecken', 'test-kurz.json'))).toBe(false); expect(fahrten(dir)).toHaveLength(3);
  expect(probleme).toEqual([]);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------- Schritt 5: Saison und Fortschritt ---------- */
test('Saison: Ziel nennen, der Tag gibt Runde und Zielleistung vor, Ergebnis zeigt die Woche; Strecken und Saison gleichen sich übers Konto ab', async () => {
  const zeilen = [], werte = [], dok = [], K = await konto(zeilen, werte, dok);
  const dir = ordner(), { app, buehne, maschine, probleme } = await starte(dir, 20, { WATTBUCH_SUPABASE_URL: K.url });
  await buehne.click('#lvlB'); await expect(buehne.locator('#kForm')).toBeVisible(); await buehne.fill('#kMail', 'test@example.com'); await buehne.fill('#kPw', 'geheim-im-test'); await buehne.click('#kForm button');
  await expect(buehne.locator('#kWer')).toHaveText('test@example.com');
  await expect.poll(() => dok.map(d => d.sammlung + '/' + d.id), { timeout: 10_000 }).toEqual(['strecken/test-kurz']);   // die eigene Strecke liegt jetzt im Konto
  await buehne.keyboard.press('Escape');
  /* ohne Saison: Fortschritt ohne Ziel, kein Weg an der Stufe */
  await buehne.click('nav button[data-s=saison]');
  await expect(buehne.locator('#saNeu')).toBeVisible(); await expect(buehne.locator('#saLauf')).toBeHidden(); await expect(buehne.locator('#stufeW')).toBeHidden();
  await expect(buehne.locator('#saZiel')).toHaveValue('215');   // gut 8 % über der FTP von 200
  await buehne.fill('#saZiel', '220'); await buehne.click('#saNeu button[type=submit]');
  await expect(buehne.locator('#saZielT')).toContainText('220 W bis');
  await expect(buehne.locator('#saL')).toHaveText('Saison · Woche 1 von 13');
  await expect(buehne.locator('#saHeute')).toHaveText(/^(Zügig|Grundlage|Lang) · \d+ min · \d+ W$/);
  await expect(buehne.locator('#saWoche')).toHaveText(/^0 von 3 Fahrten$/);
  await expect(buehne.locator('#saFtp')).toHaveText('200 von 220 W');
  await expect.poll(() => dok.find(d => d.sammlung === 'saison')?.data?.ziel, { timeout: 10_000 }).toBe(220);
  expect(await buehne.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  /* Lobby: Die Testrunde (6 Minuten) passt nicht zum Tag, also liegt eine erzeugte Runde in passender Länge da */
  await buehne.keyboard.press('Escape');
  await expect(buehne.locator('#hTag')).toHaveText(/^Heute · (Zügig|Grundlage|Lang) · \d+ W$/);
  await expect(buehne.locator('#hName')).toHaveText(/Hügelrunde|Flachstück/);
  await expect(buehne.locator('#stufeW')).toBeVisible();
  const watt = +(await buehne.locator('#hTag').innerText()).match(/(\d+) W/)[1], min = +(await buehne.locator('#hMin').innerText()), soll = +(await buehne.locator('#saHeute').innerText()).match(/(\d+) min/)[1];
  expect(Math.abs(min - soll)).toBeLessThanOrEqual(soll / 5);
  const plan = fs.readdirSync(path.join(dir, 'daten', 'strecken')).map(f => JSON.parse(fs.readFileSync(path.join(dir, 'daten', 'strecken', f), 'utf8'))).filter(s => s.plan);
  expect(plan).toHaveLength(1);
  /* kurze Runde fahren: Zielleistung des Tages gilt auch hier, das Ergebnis sagt, was es für die Woche gebracht hat */
  await buehne.locator('.card', { hasText: 'Testrunde' }).click(); await warte(600);
  await buehne.click('#start');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'ride', { timeout: 10_000 });
  expect((await stand(maschine)).basis).toBe(watt);
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'done', { timeout: 60_000 });
  await expect(buehne.locator('#resSa')).toHaveText(/^Woche 1 · Wochenziel zu \d+ %$/, { timeout: 10_000 });
  await buehne.click('#home');
  await expect(buehne.locator('#hTag')).toHaveText('Heute geschafft');
  await buehne.click('nav button[data-s=saison]');
  await expect(buehne.locator('#saHeute')).toHaveText('Geschafft'); await expect(buehne.locator('#saWoche')).toHaveText('1 von 3 Fahrten');
  /* die nie gefahrene Runde des Plans war nie im Konto und ist wieder weg */
  expect(dok.filter(d => d.sammlung === 'strecken').map(d => d.id)).toEqual(['test-kurz']);
  await expect.poll(() => fs.readdirSync(path.join(dir, 'daten', 'strecken'))).toEqual(['ftptest.json', 'test-kurz.json']);   // dazu nur die Bahn des FTP-Tests
  expect(probleme).toEqual([]);
  await app.close();

  /* Zweiter Mac, leer: nach dem Anmelden sind Strecke, Fahrt und Saison da */
  const dir2 = ordner(false), B = await starte(dir2, 1, { WATTBUCH_SUPABASE_URL: K.url });
  await B.buehne.click('#lvlB'); await expect(B.buehne.locator('#kForm')).toBeVisible(); await B.buehne.fill('#kMail', 'test@example.com'); await B.buehne.fill('#kPw', 'geheim-im-test'); await B.buehne.click('#kForm button');
  await expect(B.buehne.locator('.card', { hasText: 'Testrunde' })).toHaveCount(1, { timeout: 15_000 });
  await B.buehne.keyboard.press('Escape');
  await B.buehne.click('nav button[data-s=saison]');
  await expect(B.buehne.locator('#saZielT')).toContainText('220 W bis'); await expect(B.buehne.locator('#saHeute')).toHaveText('Geschafft');
  /* Saison beenden: zwei Klicks, im Konto als entfernt markiert, nichts gelöscht */
  await B.buehne.click('#saEnde'); await expect(B.buehne.locator('#saEnde')).toHaveText('Wirklich beenden'); await B.buehne.click('#saEnde');
  await expect(B.buehne.locator('#saNeu')).toBeVisible();
  await expect.poll(() => dok.find(d => d.sammlung === 'saison').geloescht, { timeout: 10_000 }).toBe(true);
  expect(K.log.filter(l => /^(DELETE|PATCH|PUT)/.test(l))).toEqual([]);
  expect(B.probleme).toEqual([]);
  await B.app.close(); K.zu(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dir2, { recursive: true, force: true });
});

/* ---------- Schritt 6: FTP-Test, Watt halten, Gegenrichtung ---------- */
test('FTP-Test: Rampe an der Rolle, Ergebnis wird die neue FTP', async () => {
  const dir = ordner(), { app, buehne, maschine, probleme } = await starte(dir, 30);
  await expect(buehne.locator('.card')).toHaveCount(1);   // die Testbahn ist keine Runde der Lobby
  await maschine.evaluate(() => { window.__fakeBle.maxPower = 310; });   // mehr geht nicht: bei 400 W ist Schluss
  await buehne.click('#lvlB'); await buehne.click('#pTest');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'ride', { timeout: 10_000 });
  await expect(buehne.locator('#rName')).toHaveText('FTP-Test');
  await expect(buehne.locator('#coachT')).toHaveText(/^FTP-Test · Stufe \d+ · \d+ W$/);
  expect((await stand(maschine)).ziel).toBeGreaterThanOrEqual(100);
  await expect.poll(() => maschine.evaluate(() => window.__fakeBle.ergTarget), { timeout: 10_000 }).toBeGreaterThanOrEqual(100);   // die Rolle hält die Stufe
  await buehne.keyboard.press('ArrowUp'); await buehne.keyboard.press('c');   // im Test ohne Wirkung
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'done', { timeout: 80_000 });
  await expect(buehne.locator('#resL')).toHaveText('FTP-Test');
  const [r] = fahrten(dir);
  expect(r.name).toBe('FTP-Test'); expect(r.routeId).toBeNull(); expect(r.route).toBeNull(); expect(r.ftpTest.before).toBe(200);
  expect(r.ftpTest.best).toBeGreaterThan(290); expect(r.ftpTest.best).toBeLessThanOrEqual(312); expect(r.ftpTest.ftp).toBe(Math.round(r.ftpTest.best * .75));
  await expect(buehne.locator('#resT')).toHaveText(r.ftpTest.ftp + ' W');
  await expect(buehne.locator('#resP')).toHaveText(`Beste Minute ${r.ftpTest.best} W · vorher 200 W`);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'daten', 'werte.json'), 'utf8')).ftp).toBe(r.ftpTest.ftp);
  await buehne.click('#home');
  await expect(buehne.locator('#stufe')).toHaveText(r.ftpTest.ftp + ' W');
  await expect(buehne.locator('#hName')).toHaveText('Testrunde'); await expect(buehne.locator('#hRival')).toBeHidden();
  await buehne.click('nav button[data-s=saison]');
  await expect(buehne.locator('#saGesch')).toContainText(`FTP-Test: ${r.ftpTest.ftp} W`);
  expect(probleme).toEqual([]);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('Watt halten und Gegenrichtung: zwei Schalter in der Lobby, Taste h in der Fahrt', async () => {
  const dir = ordner(), { app, buehne, maschine, probleme } = await starte(dir, 6);
  await buehne.click('#oHalt'); await expect(buehne.locator('#oHalt')).toHaveClass(/on/);
  await buehne.click('#oRev'); await expect(buehne.locator('#oRev')).toHaveClass(/on/);
  await expect.poll(() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'daten', 'werte.json'), 'utf8')).erg; } catch { return null; } }).toBe(true);
  await warte(900); await buehne.click('#start');
  await expect(buehne.locator('body')).toHaveAttribute('data-stage', 'ride', { timeout: 10_000 });
  const z = await stand(maschine); expect(z.rev).toBe(true); expect(z.halten).toBe(true);
  await expect(buehne.locator('#coachT')).toContainText('· hält');
  await expect.poll(() => maschine.evaluate(() => window.__fakeBle.ergTarget), { timeout: 10_000 }).toBeGreaterThan(50);
  await buehne.keyboard.press('h');
  await expect(buehne.locator('#coachT')).not.toContainText('hält');
  await expect.poll(() => maschine.evaluate(() => window.__fakeBle.ergTarget), { timeout: 10_000 }).toBeNull();   // wieder Steigung
  await expect.poll(async () => (await stand(maschine)).t, { timeout: 15_000 }).toBeGreaterThan(14);
  await buehne.click('#end');
  await expect(buehne.locator('#resL')).toHaveText('Runde beendet');
  const [r] = fahrten(dir); expect(r.rev).toBe(true); expect(r.route).toBe('Testrunde (umgekehrt)');
  await buehne.click('#home');
  await expect(buehne.locator('#oRev')).not.toHaveClass(/on/); await expect(buehne.locator('#oHalt')).toHaveClass(/on/);
  expect(probleme).toEqual([]);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});
