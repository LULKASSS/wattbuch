// Die Mac-App (Electron) durchspielen: Start, Geräteauswahl, automatische Sicherung, Wiederherstellung.
// Läuft mit eigenem Datenordner (WATTBUCH_DATA), echte Daten bleiben unberührt.
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test.skip(process.platform !== 'darwin', 'nur auf dem Mac');
test.describe.configure({ mode: 'serial' });

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-test-'));
const launch = (dir = data, env = { WATTBUCH_UPDATE: '0' }) => electron.launch({ args: [path.join(__dirname, '..')], env: { ...process.env, WATTBUCH_DATA: dir, WATTBUCH_ONBOARD: '0', ...env } });

test.afterAll(() => fs.rmSync(data, { recursive: true, force: true }));

test('App startet, Bluetooth ist da, Geräteauswahl funktioniert', async () => {
  const app = await launch();
  const page = await app.firstWindow();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  await expect(page.locator('#v-live')).toHaveClass(/active/);
  await expect(page).toHaveTitle('Wattbuch');
  await expect(page.locator('#noBt')).toBeHidden();
  expect(await page.evaluate(() => typeof window.wattbuchDesktop.backup)).toBe('function');

  // Auswahlfenster wie bei einer echten Suche öffnen und füllen
  await app.evaluate(({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.send('bt:open'); wc.send('bt:list', [{ id: 'a', name: 'Van Rysel D100' }, { id: 'b', name: 'HRM-Pro' }]); });
  await expect(page.locator('#btPick')).toBeVisible();
  await expect(page.locator('#btPick li')).toHaveText(['Van Rysel D100', 'HRM-Pro']);
  await page.click('#btPick .cancel');
  await expect(page.locator('#btPick')).toHaveCount(0);
  expect(problems).toEqual([]);
  await app.close();
});

test('Fahrt wird automatisch gesichert und in neuer Installation wiederhergestellt', async () => {
  test.setTimeout(75_000);
  const app = await launch();
  const page = await app.firstWindow();
  await expect(page.locator('#v-live')).toHaveClass(/active/);
  await page.addScriptTag({ path: path.join(__dirname, 'fake-ble.js') }); // simulierte Rolle statt Bluetooth
  await page.click('#btnTr');
  await expect(page.locator('#trSub')).toHaveText('Fake D100 · FTMS');
  await page.click('[data-a="start"]');
  await page.waitForTimeout(16_000); // 3 s Countdown + 13 s Fahrt
  await page.click('#fCtrl [data-a="end"]');
  await page.click('#fCtrl [data-a="save"]');
  await expect(page.locator('#toast')).toHaveText('Fahrt gespeichert');
  await expect(page.locator('#dlgSum')).toBeVisible();

  const file = path.join(data, 'Wattbuch', 'wattbuch-sicherung.json');
  await expect.poll(() => fs.existsSync(file)).toBe(true);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(backup.rides).toHaveLength(1);
  expect(fs.readdirSync(path.join(data, 'Wattbuch', 'Verlauf'))).toHaveLength(1);
  await app.close();

  // Neues Profil (leerer Browser-Speicher), gleicher Sicherungsordner
  fs.rmSync(path.join(data, 'profil'), { recursive: true, force: true });
  const app2 = await launch();
  const page2 = await app2.firstWindow();
  await expect(page2.locator('#toast')).toHaveText('1 Fahrten aus der Sicherung wiederhergestellt');
  expect(await page2.evaluate(() => S.rides.filter(r => !r.sample).length)).toBe(1);
  await app2.close();
});

test('Dateien im Import-Ordner werden beim Start übernommen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-imp-'));
  fs.mkdirSync(path.join(dir, 'Wattbuch', 'Import'), { recursive: true });
  let pts = '';
  for (let i = 0; i <= 80; i++) pts += `<trkpt lat="${(47 + i * 25 / 111320).toFixed(6)}" lon="10"><ele>${600 + i * 2}</ele></trkpt>`;
  fs.writeFileSync(path.join(dir, 'Wattbuch', 'Import', 'pass.gpx'), `<?xml version="1.0"?><gpx><trk><name>Testpass</name><trkseg>${pts}</trkseg></trk></gpx>`);
  const app = await launch(dir);
  const page = await app.firstWindow();
  await expect(page.locator('#toast')).toHaveText('1 Strecke geladen');
  await expect(page.locator('#rtList')).toContainText('Testpass');
  await expect.poll(() => fs.existsSync(path.join(dir, 'Wattbuch', 'Import', 'Erledigt', 'pass.gpx'))).toBe(true);
  expect(fs.existsSync(path.join(dir, 'Wattbuch', 'Import', 'pass.gpx'))).toBe(false);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/* Kleiner Webserver, der eine veränderte Oberfläche samt Manifest ausliefert */
async function updateServer(change, { breakHash = false } = {}) {
  const http = require('node:http');
  const web = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-web-')) + path.sep;
  const root = path.join(__dirname, '..') + path.sep;
  fs.mkdirSync(web + 'js');
  for (const f of ['index.html', 'app.css', ...fs.readdirSync(root + 'js').map(f => 'js/' + f)]) fs.copyFileSync(root + f, web + f);
  fs.writeFileSync(web + 'index.html', change(fs.readFileSync(web + 'index.html', 'utf8')));
  const { build } = await import(path.join(root, 'scripts/manifest.mjs'));
  const m = await build(web);
  if (breakHash) m.files['index.html'] = '0'.repeat(64);
  fs.writeFileSync(web + 'manifest.json', JSON.stringify(m));
  const hits = [];
  const srv = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(1); hits.push(p); try { res.end(fs.readFileSync(web + p)); } catch { res.statusCode = 404; res.end(); } });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, hits, version: m.version, close: () => { srv.close(); fs.rmSync(web, { recursive: true, force: true }); } };
}

test('Update: neue Oberfläche wird beim Start geladen und bleibt offline erhalten', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-upd-'));
  const srv = await updateServer(h => h.replace('<title>Wattbuch</title>', '<title>Wattbuch Neu</title>'));
  const app = await launch(dir, { WATTBUCH_UPDATE_URL: srv.url });
  const page = await app.firstWindow();
  await expect(page).toHaveTitle('Wattbuch Neu');
  await expect(page.locator('#v-live')).toHaveClass(/active/); // Rest der App läuft normal
  expect(srv.hits).toContain('index.html');
  expect(srv.hits).not.toContain('js/basis.js'); // unveränderte Dateien werden nicht neu geladen
  await app.close();
  srv.close();
  // Ohne Server (offline): letzte gute Version bleibt aktiv
  const app2 = await launch(dir, { WATTBUCH_UPDATE_URL: 'http://127.0.0.1:9' });
  const page2 = await app2.firstWindow();
  await expect(page2).toHaveTitle('Wattbuch Neu');
  await app2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Update mit falscher Prüfsumme wird verworfen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-upd-'));
  const srv = await updateServer(h => h.replace('<title>Wattbuch</title>', '<title>Manipuliert</title>'), { breakHash: true });
  const app = await launch(dir, { WATTBUCH_UPDATE_URL: srv.url });
  const page = await app.firstWindow();
  await expect(page.locator('#v-live')).toHaveClass(/active/);
  await expect(page).toHaveTitle('Wattbuch');
  await app.close();
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Geräteauswahl hängt nicht, wenn die Seite während einer Suche neu lädt', async () => {
  const app = await launch();
  const page = await app.firstWindow();
  await expect(page.locator('#v-live')).toHaveClass(/active/);
  // Suche beginnt (wie Chromium es meldet), Auswahl ist offen
  const emit = () => app.evaluate(({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; global.__picked = global.__picked || []; wc.emit('select-bluetooth-device', { preventDefault() {} }, [{ deviceId: 'd1', deviceName: 'Van Rysel D100' }], id => global.__picked.push(id)); });
  await emit();
  await expect(page.locator('#btPick li')).toHaveText(['Van Rysel D100']);
  // Seite lädt neu (z. B. Update) → offene Suche wird sauber abgebrochen
  await page.reload();
  await expect(page.locator('#v-live')).toHaveClass(/active/);
  expect(await app.evaluate(() => global.__picked)).toEqual(['']);
  // Nächstes „Verbinden“: Auswahl erscheint wieder und die Wahl kommt an
  await emit();
  await expect(page.locator('#btPick li')).toHaveText(['Van Rysel D100']);
  await page.click('#btPick li button');
  await expect(page.locator('#btPick')).toHaveCount(0);
  expect(await app.evaluate(() => global.__picked)).toEqual(['', 'd1']);
  await app.close();
});

/* Nachgebauter Strava-Server: Anmeldung, Token, Upload mit Verarbeitung. Spielt auch die Edge Function strava-token (gemeinsame App) */
async function fakeStrava() {
  const http = require('node:http');
  const seen = { uploads: [], tokens: [], central: [], lists: [], streams: [], sports: [] };
  const srv = http.createServer((req, res) => {
    let body = []; req.on('data', d => body.push(d)); req.on('end', () => {
      body = Buffer.concat(body).toString('utf8');
      const u = new URL(req.url, 'http://x'), send = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
      const tok = { access_token: 'testzugang', refresh_token: 'testerneuern', expires_at: Math.floor(Date.now() / 1000) + 3600, athlete: { id: 7, firstname: 'Lukas', lastname: 'R.' } };
      if (u.pathname === '/functions/v1/strava-token') { seen.central.push({ apikey: req.headers.apikey, body: JSON.parse(body) }); return send(tok); }
      if (u.pathname === '/oauth/token') { seen.tokens.push(body); return send({ access_token: 'testzugang', refresh_token: 'testerneuern', expires_at: Math.floor(Date.now() / 1000) + 3600, athlete: { id: 7, firstname: 'Lukas', lastname: 'R.' } }); }
      const pm = /^\/api\/v3\/activities\/(\d+)$/.exec(u.pathname);
      if (pm && req.method === 'PUT') { seen.sports.push({ id: pm[1], body: JSON.parse(body) }); return send({ id: +pm[1] }); }
      if (u.pathname === '/api/v3/uploads' && req.method === 'POST') { seen.uploads.push({ auth: req.headers.authorization, body }); return send({ id: 55, id_str: '55', status: 'Your activity is still being processed.' }); }
      if (u.pathname === '/api/v3/uploads/55') return send({ id: 55, id_str: '55', activity_id: 987654321, status: 'Your activity is ready.' });
      /* Eigene Aktivitäten: draußen ohne Wattmesser, Zwift mit Watt, eine aus Wattbuch hochgeladene, eine Wanderung, eine zu kurze */
      if (u.pathname === '/api/v3/athlete/activities') {
        seen.lists.push(u.search);
        if (u.searchParams.get('page') !== '1') return send([]);
        return send([
          { id: 111, name: 'Hausrunde', sport_type: 'Ride', start_date: '2026-09-20T15:00:00Z', moving_time: 3000, total_elevation_gain: 380, average_watts: 190, device_watts: false, trainer: false },
          { id: 222, name: 'Zwift - Watopia', sport_type: 'VirtualRide', start_date: '2026-09-18T17:00:00Z', moving_time: 1200, total_elevation_gain: 90, average_watts: 200, device_watts: true, trainer: false },
          { id: 333, name: 'Rollentraining', sport_type: 'Ride', start_date: '2026-09-17T17:00:00Z', moving_time: 1800, external_id: 'wattbuch-r1.tcx', trainer: true },
          { id: 444, name: 'Wanderung', sport_type: 'Hike', start_date: '2026-09-16T09:00:00Z', moving_time: 9000 },
          { id: 555, name: 'Zum Bäcker', sport_type: 'Ride', start_date: '2026-09-15T09:00:00Z', moving_time: 120 }
        ]);
      }
      const sm = /^\/api\/v3\/activities\/(\d+)\/streams$/.exec(u.pathname);
      if (sm) {
        seen.streams.push(sm[1]);
        const n = sm[1] === '111' ? 3600 : 1200, time = [], d = [];
        /* 111: nach 1500 s steht man 10 min an der Ampel (Lücke im Zeitstrom) */
        for (let i = 0; i < n; i++) { time.push(sm[1] === '111' && i >= 1500 ? i + 600 : i); d.push(i * 8); }
        const out = { time: { data: time }, distance: { data: d }, heartrate: { data: time.map(() => 150) }, cadence: { data: time.map(() => 85) }, altitude: { data: time.map((_, i) => 150 + i / 100) }, moving: { data: time.map(() => true) } };
        if (sm[1] === '222') out.watts = { data: time.map(() => 200) };
        if ((u.searchParams.get('keys') || '').includes('latlng')) out.latlng = { data: time.map((_, i) => [50 + i * 8 / 111320, 8]) }; // gerade nach Norden
        return send(out);
      }
      res.statusCode = 404; res.end();
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => srv.close() };
}

test('Strava: verbinden und Fahrt hochladen', async () => {
  test.setTimeout(60_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-strava-'));
  const sv = await fakeStrava();
  let app = await launch(dir, { WATTBUCH_UPDATE: '0', WATTBUCH_STRAVA_URL: sv.url });
  let page = await app.firstWindow();
  await expect(page.locator('#v-live')).toHaveClass(/active/);
  // Gemeinsame Strava-App: nichts eintragen, nur verbinden
  await page.click('#btnSet');
  await expect(page.locator('#svBox input')).toHaveCount(0);
  await page.click('#svConnect');
  // Strava würde jetzt im Browser fragen – wir folgen der Rückleitung wie der Browser
  const auth = await expect.poll(() => app.evaluate(() => global.__stravaAuth || null)).not.toBeNull().then(() => app.evaluate(() => global.__stravaAuth));
  const q = new URL(auth).searchParams;
  expect(q.get('client_id')).toBe('286463');
  expect(q.get('scope')).toBe('read,activity:write,activity:read_all'); // hochladen und Runden als Strecken lesen
  const back = await fetch(`${q.get('redirect_uri')}?state=${q.get('state')}&code=testcode&scope=read,activity:write,activity:read_all`);
  expect(await back.text()).toContain('Mit Strava verbunden');
  await expect(page.locator('#svBox')).toContainText('Verbunden als Lukas R.');
  // Token-Tausch über die Edge Function, ohne Secret in der App
  expect(sv.seen.central).toEqual([{ apikey: expect.stringMatching(/^sb_publishable_/), body: { code: 'testcode' } }]);
  expect(sv.seen.tokens).toEqual([]);
  expect(fs.readFileSync(path.join(dir, 'profil', 'strava.json'), 'utf8')).not.toContain('clientSecret');
  await expect(page.locator('#svInSt')).toHaveCount(0); // ganze Fahrten übernimmt die gemeinsame App nicht
  await expect(page.locator('#svBox')).not.toContainText('Neu verbinden');
  await expect(page.locator('#svBox')).toContainText('meistgefahrenen Runden');
  await expect.poll(() => sv.seen.lists.length).toBeGreaterThan(0); // Runden werden gleich gesucht
  await app.close();
  // Zugang abgelaufen: beim Neustart erneuert die Edge Function ihn
  const cf = path.join(dir, 'profil', 'strava.json');
  fs.writeFileSync(cf, JSON.stringify({ ...JSON.parse(fs.readFileSync(cf, 'utf8')), expires: 0 }));
  app = await launch(dir, { WATTBUCH_UPDATE: '0', WATTBUCH_STRAVA_URL: sv.url });
  page = await app.firstWindow();
  await page.click('#btnSet');
  // Zugang liegt nur für den eigenen Benutzer lesbar im App-Datenordner
  const st = fs.statSync(path.join(dir, 'profil', 'strava.json'));
  expect(st.mode & 0o077).toBe(0);
  await page.click('#dlgSet .dlg-foot button');
  // Fahrt laden und hochladen
  const ride = { id: 'u1', start: '2026-10-09T17:30:00.000Z', name: 'Rollentraining am Abend', p: Array(600).fill(150), hr: Array(600).fill(130), cad: Array(600).fill(88), spd: null, dist: Array.from({ length: 600 }, (_, i) => i * 8), alt: null };
  await page.setInputFiles('#anyFile', { name: 'f.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'wattbuch', rides: [ride] })) });
  await page.evaluate(() => { S.detail = 'u1'; go('detail'); });
  await page.click('#btnStrava');
  await expect(page.locator('#btnStrava')).toHaveText('Auf Strava ansehen', { timeout: 15000 });
  await expect(page.locator('#btnStrava')).toHaveAttribute('href', 'https://www.strava.com/activities/987654321');
  const up = sv.seen.uploads[0];
  expect(up.auth).toBe('Bearer testzugang');
  expect(sv.seen.central[1].body).toEqual({ refresh_token: 'testerneuern' });
  for (const s of ['name="data_type"', 'tcx', 'name="trainer"', 'Rollentraining am Abend', '<ns3:Watts>150</ns3:Watts>', 'wattbuch-u1']) expect(up.body).toContain(s);
  expect(await page.evaluate(() => S.rides.find(r => r.id === 'u1').strava.state)).toBe('ok');
  // Danach zum Virtual Ride gemacht (beim Hochladen lässt Strava die Sportart nicht zu)
  expect(sv.seen.sports).toEqual([{ id: '987654321', body: { sport_type: 'VirtualRide', trainer: true } }]);
  expect(await page.evaluate(() => S.rides.find(r => r.id === 'u1').strava.vr)).toBe(true);
  await app.close();
  sv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Strava: alle Fahrten übernehmen, mit und ohne Wattmesser', async () => {
  test.setTimeout(60_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-strava-in-'));
  const sv = await fakeStrava();
  // Eigene Strava-App (Lukas' alte Einrichtung, ausgedachte Testwerte): direkt bei Strava, mit Übernehmen
  fs.mkdirSync(path.join(dir, 'profil'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'profil', 'strava.json'), JSON.stringify({ clientId: '12345', clientSecret: 'b'.repeat(40) }), { mode: 0o600 });
  const app = await launch(dir, { WATTBUCH_UPDATE: '0', WATTBUCH_STRAVA_URL: sv.url });
  const page = await app.firstWindow();
  await expect(page.locator('#v-live')).toHaveClass(/active/);
  await page.click('#btnSet');
  await page.click('#svConnect');
  const auth = await expect.poll(() => app.evaluate(() => global.__stravaAuth || null)).not.toBeNull().then(() => app.evaluate(() => global.__stravaAuth));
  const q = new URL(auth).searchParams;
  expect(q.get('client_id')).toBe('12345');
  expect(q.get('scope')).toContain('activity:read_all');
  await fetch(`${q.get('redirect_uri')}?state=${q.get('state')}&code=testcode&scope=read,activity:write,activity:read_all`);
  await expect(page.locator('#svInSt')).toHaveText('2 Fahrten aus Strava in Wattbuch', { timeout: 15000 });
  expect(sv.seen.tokens[0]).toContain('b'.repeat(40));
  expect(sv.seen.central).toEqual([]);
  expect(sv.seen.streams.sort()).toEqual(['111', '222']); // Wattbuch-Upload, Wanderung, zu kurz: gar nicht erst geholt
  const rides = await page.evaluate(() => S.rides.filter(r => r.src === 'strava').map(r => ({ id: r.id, noW: !!r.noW, dur: stats(r).dur, p: r.p.length, km: Math.round(r.dist[r.dist.length - 1] / 1000), avg: Math.round(stats(r).avg), strava: r.strava.state })).sort((a, b) => a.id.localeCompare(b.id)));
  expect(rides).toEqual([
    { id: 'sv111', noW: true, dur: 3598, p: 0, km: 29, avg: 190, strava: 'ok' }, // Ampelpause fällt raus
    { id: 'sv222', noW: false, dur: 1199, p: 1199, km: 10, avg: 200, strava: 'ok' }
  ]);
  /* Zweiter Durchlauf holt nichts doppelt und fragt nur noch nach Neuem */
  await page.evaluate(() => stravaImport());
  expect(sv.seen.streams).toHaveLength(2);
  expect(sv.seen.lists[sv.seen.lists.length - 1]).toContain('after=');
  /* Detail einer Draußen-Fahrt */
  await page.click('#dlgSet .dlg-foot button');
  await page.evaluate(() => { S.detail = 'sv111'; go('detail'); });
  await expect(page.locator('#v-detail .hero')).toContainText('Ohne Wattmesser');
  await expect(page.locator('#btnStrava')).toHaveText('Auf Strava ansehen');
  /* Draußen-Fahrt als Strecke speichern, danach unter „Fahren“ wählbar */
  await page.click('#btnRouteFrom');
  await expect(page.locator('#btnRouteFrom')).toHaveText('Als Strecke gespeichert');
  await expect(page.locator('#btnRouteFrom')).toBeDisabled();
  const rt = await page.evaluate(() => { const r = S.routes.find(x => x.id === 'sr111'); return r && { name: r.name, km: Math.round(r.dist / 1000) }; });
  expect(rt).toEqual({ name: 'Hausrunde', km: 29 });
  await page.click('#nav [data-v="live"]');
  await expect(page.locator('#rtList [data-route="sr111"]')).toContainText('Hausrunde');
  await app.close();
  sv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Apple TV: koppeln, nach Neustart Tasten aus der Fahrt-Ansicht senden', async () => {
  test.setTimeout(60_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-atv-'));
  const log = path.join(dir, 'tasten.txt');
  const env = { WATTBUCH_UPDATE: '0', WATTBUCH_ATV_FAKE: log };
  let app = await launch(dir, env);
  let page = await app.firstWindow();
  await expect(page.locator('#v-live')).toHaveClass(/active/);
  await page.click('#btnSet');
  await page.click('#tvScan');
  await page.click('[data-tvdev="ATV1"]');
  await page.fill('#tvPin', '1234');
  await page.press('#tvPin', 'Enter');
  await expect(page.locator('#tvBox')).toContainText('zweiter Code');
  await page.fill('#tvPin', '5678');
  await page.press('#tvPin', 'Enter');
  await expect(page.locator('#tvBox')).toContainText('Wohnzimmer');
  const store = path.join(dir, 'profil', 'appletv', 'pyatv.json');
  expect(fs.statSync(store).mode & 0o777).toBe(0o600);
  await app.close();
  // Neustart: Kopplung bleibt, T öffnet die Fernbedienung und verbindet
  app = await launch(dir, env);
  page = await app.firstWindow();
  await expect(page.locator('#v-live')).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => !!S.tv.dev)).toBe(true); // Kopplung erst geladen, dann T
  await page.keyboard.press('t');
  await expect(page.locator('#fTvPad')).toBeVisible();
  await expect(page.locator('#fTvNow')).toHaveText('Testkino · Testfolge');
  for (const k of ['ArrowLeft', 'Enter', 'Escape']) await page.keyboard.press(k);
  await expect.poll(() => fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '').toBe('left\nselect\nmenu\n');
  // Trennen vergisst die Zugangsdaten
  await page.keyboard.press('t');
  await page.click('#fClose');
  await page.click('#btnSet');
  await page.click('#tvOff');
  await expect(page.locator('#tvScan')).toBeVisible();
  expect(fs.existsSync(store)).toBe(false);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('App lädt neue Version im Hintergrund, Einrichtung beim ersten Start', async () => {
  test.setTimeout(60_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-self-'));
  const http = require('node:http');
  const zip = Buffer.from('PK-Testinhalt');
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/app-version.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ version: '9.9.9' })); }
    if (u.pathname === '/Wattbuch-mac-arm64.zip') return res.end(zip);
    res.statusCode = 404; res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const app = await launch(dir, { WATTBUCH_UPDATE: '0', WATTBUCH_ONBOARD: '1', WATTBUCH_SELFUPDATE_URL: `http://127.0.0.1:${srv.address().port}` });
  const page = await app.firstWindow();
  // Erster Start, niemand angemeldet: Einrichtung erscheint
  await expect(page.locator('#dlgStart')).toBeVisible();
  await expect(page.locator('#dlgStart')).toContainText('Willkommen bei Wattbuch');
  await page.keyboard.press('Escape');
  await expect(page.locator('#dlgStart')).toBeHidden();
  // Neue Version liegt bereit
  await expect(page.locator('#toast')).toContainText('Wattbuch 9.9.9 ist geladen', { timeout: 15000 });
  expect(fs.readFileSync(path.join(dir, 'profil', 'neue-version', 'Wattbuch-mac-arm64.zip'))).toEqual(zip);
  await page.click('#btnSet');
  await expect(page.locator('#appBox')).toContainText('9.9.9');
  await expect(page.locator('#appBox #appInstall')).toBeVisible();
  await app.close();
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
