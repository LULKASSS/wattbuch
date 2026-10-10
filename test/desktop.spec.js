// Die Mac-App (Electron) durchspielen: Start, Geräteauswahl, automatische Sicherung, Wiederherstellung.
// Läuft mit eigenem Datenordner (WATTBUCH_DATA), echte Daten bleiben unberührt.
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test.skip(process.platform !== 'darwin', 'nur auf dem Mac');
test.describe.configure({ mode: 'serial' });

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'wattbuch-test-'));
const launch = (dir = data) => electron.launch({ args: [path.join(__dirname, '..')], env: { ...process.env, WATTBUCH_DATA: dir } });

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
