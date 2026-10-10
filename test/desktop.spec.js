// Die Mac-App (Electron) durchspielen: Start, Geräteauswahl, automatische Sicherung, Wiederherstellung.
// Läuft mit eigenem Datenordner (WATTBUCH_DATA), echte Daten bleiben unberührt.
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test.skip(process.platform !== 'darwin', 'nur auf dem Mac');
test.describe.configure({ mode: 'serial' });

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-test-'));
const launch = (dir = data, env = { WATTBUCH_UPDATE: '0' }) => electron.launch({ args: [path.join(__dirname, '..')], env: { ...process.env, WATTBUCH_DATA: dir, ...env } });

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
  await page.click('#chkDemo');
  await page.click('[data-a="start"]');
  await page.waitForTimeout(16_000); // 3 s Countdown + 13 s Fahrt
  await page.click('[data-a="end"]');
  await page.click('[data-a="save"]');
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
