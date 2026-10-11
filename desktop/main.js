/* Wattbuch als Mac-App (Electron).
 * Lädt dieselbe index.html wie die Webseite. Dazu kommt, was der Browser nicht kann:
 * Bluetooth-Geräteauswahl ohne Chrome, automatische Sicherung nach iCloud Drive und
 * eine Rückfrage, bevor das Fenster während einer Aufnahme geschlossen wird. */
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const { createUpdater } = require('./update');
const { createStrava } = require('./strava');
const ROOT = path.join(__dirname, '..');
/* Woher Updates kommen; in Tests per WATTBUCH_UPDATE_URL umgelenkt, WATTBUCH_UPDATE=0 schaltet ab */
const UPDATE_URL = process.env.WATTBUCH_UPDATE_URL || 'https://lulkasss.github.io/wattbuch';
const UPDATES = process.env.WATTBUCH_UPDATE !== '0';
let updater = null, mainWin = null;
const ICLOUD = path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs');
let backupDir = null;

/* Eigenes Schema statt file://: feste Herkunft für IndexedDB und sicherer Kontext für Bluetooth */
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/* Tests (WATTBUCH_DATA=Ordner): eigener Speicher und Sicherungsordner, nie die echten Daten */
const TEST_DATA = process.env.WATTBUCH_DATA;
if (TEST_DATA) app.setPath('userData', path.join(TEST_DATA, 'profil'));

async function resolveBackupDir() {
  if (TEST_DATA) { const d = path.join(TEST_DATA, 'Wattbuch'); await fs.mkdir(path.join(d, 'Verlauf'), { recursive: true }); return d; }
  let base = path.join(os.homedir(), 'Documents');
  try { await fs.access(ICLOUD); base = ICLOUD; } catch {}
  const dir = path.join(base, 'Wattbuch');
  await fs.mkdir(path.join(dir, 'Verlauf'), { recursive: true });
  return dir;
}

/* Sicherung: aktuelle Datei plus eine pro Tag (die letzten 60 Tage bleiben) */
async function writeBackup(json) {
  const data = JSON.parse(json);
  if (data.app !== 'wattbuch') throw new Error('keine Wattbuch-Sicherung');
  const day = new Date().toISOString().slice(0, 10);
  const tmp = path.join(backupDir, '.wattbuch-sicherung.tmp');
  await fs.writeFile(tmp, json);
  await fs.rename(tmp, path.join(backupDir, 'wattbuch-sicherung.json'));
  /* Eine leere Sicherung überschreibt nie einen Tagesstand mit Fahrten */
  const dayFile = path.join(backupDir, 'Verlauf', `wattbuch-${day}.json`);
  if (data.rides.length) await fs.writeFile(dayFile, json);
  const old = (await fs.readdir(path.join(backupDir, 'Verlauf'))).filter(f => /^wattbuch-\d{4}-\d\d-\d\d\.json$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 60))) await fs.rm(path.join(backupDir, 'Verlauf', f));
  return { dir: backupDir, rides: data.rides.length };
}

/* Import-Ordner: Dateien darin übernimmt die App beim Start, danach wandern sie nach Import/Erledigt */
async function pendingImports() {
  const dir = path.join(backupDir, 'Import');
  await fs.mkdir(dir, { recursive: true });
  const names = (await fs.readdir(dir)).filter(f => /\.(json|gpx)$/i.test(f) && !f.startsWith('.'));
  return Promise.all(names.map(async name => ({ name, text: await fs.readFile(path.join(dir, name), 'utf8') })));
}
async function importsDone(names) {
  const dir = path.join(backupDir, 'Import'), done = path.join(dir, 'Erledigt');
  await fs.mkdir(done, { recursive: true });
  for (const n of names) if (!n.includes('/') && !n.includes('..')) await fs.rename(path.join(dir, n), path.join(done, n)).catch(() => {});
}

async function readBackup() {
  try { return JSON.parse(await fs.readFile(path.join(backupDir, 'wattbuch-sicherung.json'), 'utf8')); }
  catch { return null; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 880, minWidth: 380, minHeight: 600,
    title: 'Wattbuch', backgroundColor: '#0b0b0f', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  win.once('ready-to-show', () => win.show());

  /* Bluetooth: Chromium liefert die gefundenen Geräte laufend nach, die Auswahl zeigt die Seite (preload.js) */
  let pick = null;
  win.webContents.on('select-bluetooth-device', (event, list, callback) => {
    event.preventDefault();
    if (!pick) win.webContents.send('bt:open');
    pick = callback;
    win.webContents.send('bt:list', list.map(d => ({ id: d.deviceId, name: d.deviceName || 'Unbekanntes Gerät' })));
  });
  ipcMain.removeAllListeners('bt:choose');
  ipcMain.on('bt:choose', (_e, id) => { if (pick) { const cb = pick; pick = null; cb(id || ''); } });
  /* Lädt die Seite neu (z. B. nach einem Update), während eine Suche offen ist: Suche sauber abbrechen,
     sonst hängt sie und jedes weitere „Verbinden“ bleibt ohne Auswahlfenster */
  const dropPick = () => { if (pick) { const cb = pick; pick = null; try { cb(''); } catch {} } };
  win.webContents.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => { if (isMainFrame) dropPick(); });
  win.webContents.on('render-process-gone', dropPick);

  /* Aufnahme läuft (beforeunload der Seite) → nachfragen statt still nicht zu schließen */
  win.webContents.on('will-prevent-unload', event => {
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Weiterfahren', 'Trotzdem schließen'], defaultId: 0, cancelId: 0,
      message: 'Es läuft eine Aufnahme.', detail: 'Beim Schließen wird die Fahrt bis hierhin gesichert und beim nächsten Start wiederhergestellt.'
    });
    if (r === 1) event.preventDefault();
  });

  /* Links nach außen im Standardbrowser öffnen, nie im App-Fenster */
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });

  win.loadURL('app://wattbuch/index.html');
  return win;
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Ablage', submenu: [
      { label: 'Nach Updates suchen …', click: () => backgroundUpdate(true) },
      { type: 'separator' },
      { label: 'Sicherungsordner öffnen', accelerator: 'CmdOrCtrl+Shift+S', click: () => shell.openPath(backupDir) },
      { type: 'separator' }, { role: 'close' }
    ] },
    { role: 'editMenu' },
    { label: 'Darstellung', submenu: [{ role: 'reload', label: 'Neu laden' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' }] },
    { role: 'windowMenu' }
  ]));
}

function setAbout() {
  app.setAboutPanelOptions({ applicationName: 'Wattbuch', applicationVersion: app.getVersion(), version: `Oberfläche ${updater.active.version}` });
}
/* Update im laufenden Betrieb: neu laden nur, wenn gerade keine Aufnahme läuft (fragt die Seite) */
async function backgroundUpdate(manual) {
  let fresh = false, err = null;
  try { fresh = await updater.check(); } catch (e) { err = e; }
  setAbout();
  const win = mainWin && !mainWin.isDestroyed() ? mainWin : null;
  if (fresh && win) win.webContents.send('update:ready', updater.active.version);
  if (manual && win) dialog.showMessageBox(win, { type: err ? 'warning' : 'info', message: err ? 'Update gerade nicht möglich' : fresh ? 'Neue Version geladen' : 'Wattbuch ist aktuell', detail: err ? err.message : `Oberfläche ${updater.active.version}` });
}

app.setName('Wattbuch');
app.whenReady().then(async () => {
  backupDir = await resolveBackupDir();

  updater = createUpdater({ bundledRoot: ROOT, dataDir: app.getPath('userData'), baseUrl: UPDATE_URL, log: m => console.log(m) });
  updater.init();

  /* Oberfläche aus der aktiven Version (heruntergeladen oder eingebaut), alles andere aus der App */
  protocol.handle('app', async req => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    for (const root of [updater.active.root, ROOT]) {
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root + path.sep)) return new Response('verboten', { status: 403 });
      try { await fs.access(file); return net.fetch(pathToFileURL(file).toString()); } catch {}
    }
    return new Response('nicht gefunden', { status: 404 });
  });

  /* Bluetooth und Bildschirm-wach-halten erlauben, alles andere nicht */
  const allowed = new Set(['bluetooth', 'screen-wake-lock', 'persistent-storage', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  session.defaultSession.setDevicePermissionHandler(d => d.deviceType === 'bluetooth');

  ipcMain.handle('backup:write', (_e, json) => writeBackup(json));
  ipcMain.handle('backup:latest', () => readBackup());
  ipcMain.handle('backup:dir', () => backupDir);
  ipcMain.handle('import:pending', () => pendingImports());
  /* Strava: in Tests per WATTBUCH_STRAVA_URL auf einen Prüfserver (auch für den Token-Tausch), Browser-Aufruf landet dann in global.__stravaAuth */
  const strava = createStrava({
    dataDir: app.getPath('userData'), baseUrl: process.env.WATTBUCH_STRAVA_URL || 'https://www.strava.com', log: m => console.log(m),
    ...(process.env.WATTBUCH_STRAVA_URL ? { tokenUrl: process.env.WATTBUCH_STRAVA_URL + '/functions/v1/strava-token' } : {}),
    openBrowser: process.env.WATTBUCH_STRAVA_URL ? url => { global.__stravaAuth = url; } : url => shell.openExternal(url)
  });
  const wrap = fn => async (_e, arg) => { try { return { ok: true, ...(await fn(arg)) }; } catch (e) { return { ok: false, error: e.message, status: e.status || 0 }; } };
  ipcMain.handle('strava:status', wrap(() => strava.status()));
  ipcMain.handle('strava:connect', wrap(() => strava.connect()));
  ipcMain.handle('strava:disconnect', wrap(() => strava.disconnect()));
  ipcMain.handle('strava:upload', wrap(a => strava.upload(a)));
  ipcMain.handle('strava:activities', wrap(a => strava.activities(a)));
  ipcMain.handle('strava:streams', wrap(a => typeof a === 'object' ? strava.streams(a.id, a.kind) : strava.streams(a)));
  ipcMain.handle('import:done', (_e, names) => importsDone(names));

  /* Beim Start kurz (max. 3 s) auf ein Update warten, damit gleich die neueste Fassung erscheint */
  if (UPDATES) await Promise.race([updater.check().catch(e => console.log('Update:', e.message)), new Promise(r => setTimeout(r, 3000))]);
  setAbout();
  buildMenu();
  mainWin = createWindow();
  if (UPDATES) setInterval(() => backgroundUpdate(), 30 * 60 * 1000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) mainWin = createWindow(); });
});
app.on('window-all-closed', () => app.quit());
