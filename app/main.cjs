/* Wattbuch Neu: App für den Mac (Electron), eigene App neben der alten (eigener Name, eigene Kennung, eigener Datenordner).
 * Zwei Fenster: die Bühne (sichtbar: 3D-Welt und Anzeige) und der Maschinenraum (unsichtbar: Bluetooth, Fahrphysik,
 * Aufnahme). Stürzt die Bühne ab oder ruckelt sie, läuft die Aufnahme im Maschinenraum weiter; jede Sekunde landet
 * zusätzlich sofort im Journal auf der Platte. Die App lädt nichts aus dem Netz nach. */
const { app, BrowserWindow, Menu, ipcMain, net, protocol, session, powerSaveBlocker } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createDaten } = require('./daten.cjs');

const BAU = path.join(__dirname, '..', 'bau');
/* Tests und Simulation (WATTBUCH_DATA=Ordner): eigener Speicher, nie die echten Daten */
const TEST_DATA = process.env.WATTBUCH_DATA && path.resolve(process.env.WATTBUCH_DATA);
/* Simulierte Rolle (nur aus dem Quellcode, test/ ist nicht Teil der gebauten App) */
const SIM = process.env.WATTBUCH_SIM === '1';
const TEMPO = Math.max(1, +process.env.WATTBUCH_TEMPO || 1);

app.setName('Wattbuch Neu');
if (TEST_DATA) app.setPath('userData', path.join(TEST_DATA, 'profil'));
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!TEST_DATA && !app.requestSingleInstanceLock()) app.quit();

let buehne = null, maschine = null, daten = null, wach = null, letzter = null, faehrt = false;
const lebt = w => w && !w.isDestroyed() && !w.webContents.isDestroyed();
const anBuehne = (kanal, x) => { if (lebt(buehne)) buehne.webContents.send(kanal, x); };
const anMaschine = (kanal, x) => { if (lebt(maschine)) maschine.webContents.send(kanal, x); };

const prefs = () => ({ preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false });

function baueMaschine() {
  maschine = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: prefs() });
  const wc = maschine.webContents;
  /* Bluetooth ohne Auswahldialog: Der Maschinenraum sagt vorher, welche Art Gerät er sucht. Taucht das gemerkte
     Gerät in der Suche auf, wird es genommen. Ist noch keins gemerkt, das erste gefundene (und gemerkt). */
  let art = null, wahl = null, frist = null;
  ipcMain.removeAllListeners('bt:suche');
  ipcMain.on('bt:suche', (_e, a) => { art = a; });
  const schluss = id => { clearTimeout(frist); if (wahl) { const cb = wahl; wahl = null; try { cb(id || ''); } catch {} } };
  wc.on('select-bluetooth-device', (event, list, callback) => {
    event.preventDefault();
    if (!wahl) frist = setTimeout(() => schluss(''), 12000);
    wahl = callback;
    const gemerkt = daten.geraete(), id = gemerkt[art] && gemerkt[art].id;
    const d = id ? list.find(x => x.deviceId === id) : list[0];
    if (!d) return;
    if (!id) daten.geraeteSpeichern({ ...gemerkt, [art]: { id: d.deviceId, name: d.deviceName || '' } });
    schluss(d.deviceId);
  });
  wc.on('did-start-navigation', (_e, _u, _i, haupt) => { if (haupt) schluss(''); });
  wc.on('dom-ready', async () => {
    if (SIM) for (const f of ['fake-ble.js', 'sim-fahrer.js']) {
      const p = path.join(__dirname, '..', 'test', f);
      if (fs.existsSync(p)) await wc.executeJavaScript(fs.readFileSync(p, 'utf8')).catch(e => console.log('Simulation:', e.message));
    }
    verbinde();
  });
  /* Maschinenraum abgestürzt: neu laden, er setzt die laufende Fahrt aus dem Journal fort */
  wc.on('render-process-gone', () => setTimeout(() => { if (lebt(maschine)) wc.reload(); }, 300));
  wc.on('console-message', (_e, _l, m) => { if (process.env.WATTBUCH_LOG) console.log('[maschine]', m); });
  maschine.loadURL(`app://wattbuch-neu/maschine.html?tempo=${TEMPO}`);
}
/* Geräte suchen: requestDevice braucht eine Nutzergeste, die gibt der Hauptprozess mit. Alle 15 s erneut,
   solange etwas fehlt (der Maschinenraum sucht nur, was nicht verbunden ist). */
function verbinde() { if (lebt(maschine)) maschine.webContents.executeJavaScript('window.__verbinden&&window.__verbinden()', true).catch(() => {}); }

function baueBuehne() {
  buehne = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600, title: 'Wattbuch Neu', backgroundColor: '#07060D', show: false,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 }, webPreferences: prefs()
  });
  buehne.once('ready-to-show', () => buehne.show());
  const wc = buehne.webContents;
  const voll = () => anBuehne('vollbild', buehne.isFullScreen());
  buehne.on('enter-full-screen', voll); buehne.on('leave-full-screen', voll);
  /* Bühne abgestürzt: neu laden. Die Fahrt läuft im Maschinenraum weiter, die Bühne hängt sich wieder an. */
  wc.on('render-process-gone', () => setTimeout(() => { if (lebt(buehne)) wc.reload(); }, 300));
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  buehne.on('closed', () => { buehne = null; app.quit(); });
  buehne.loadURL('app://wattbuch-neu/buehne.html');
}

function menue() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
    { label: 'Darstellung', submenu: [{ role: 'togglefullscreen', label: 'Vollbild' }, { type: 'separator' }, { role: 'reload', label: 'Neu laden' }, { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' }] },
    { role: 'windowMenu' }
  ]));
}

app.whenReady().then(() => {
  const dir = TEST_DATA ? path.join(TEST_DATA, 'daten') : path.join(app.getPath('userData'), 'daten');
  daten = createDaten(dir);
  /* Fahrt vom letzten Mal liegen geblieben (Absturz, Strom weg): als Fahrt sichern */
  if (daten.journalRetten()) console.log('Fahrt aus dem Journal wiederhergestellt');

  protocol.handle('app', async req => {
    let rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(BAU, rel));
    if (!file.startsWith(BAU + path.sep)) return new Response('verboten', { status: 403 });
    try { await fs.promises.access(file); return net.fetch(pathToFileURL(file).toString()); } catch { return new Response('nicht gefunden', { status: 404 }); }
  });
  const erlaubt = new Set(['bluetooth', 'screen-wake-lock']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(erlaubt.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => erlaubt.has(perm));
  session.defaultSession.setDevicePermissionHandler(d => d.deviceType === 'bluetooth');

  ipcMain.handle('daten:strecken', () => daten.strecken());
  ipcMain.handle('daten:strecke', (_e, s) => daten.streckeSpeichern(s));
  ipcMain.handle('daten:fahrten', () => daten.fahrten());
  ipcMain.handle('daten:werte', () => daten.werte());
  ipcMain.handle('daten:rivale', (_e, id, rev) => daten.rivale(id, rev));
  ipcMain.handle('daten:laufend', () => faehrt ? daten.journalLesen() : null);
  /* Maschinenraum → Bühne */
  ipcMain.on('m:zustand', (_e, z) => { letzter = z; anBuehne('zustand', z); });
  ipcMain.on('m:ereignis', (_e, x) => anBuehne('ereignis', x));
  ipcMain.on('b:bereit', () => { if (letzter) anBuehne('zustand', letzter); if (lebt(buehne)) anBuehne('vollbild', buehne.isFullScreen()); });
  /* Bühne → Maschinenraum */
  ipcMain.on('b:befehl', (_e, b) => anMaschine('befehl', b));
  /* Aufnahme: Journal und fertige Fahrt */
  const schlafAus = () => { if (wach != null) { powerSaveBlocker.stop(wach); wach = null; } };
  ipcMain.on('m:start', (_e, kopf) => { daten.journalStart(kopf); faehrt = true; if (wach == null) wach = powerSaveBlocker.start('prevent-display-sleep'); });
  ipcMain.on('m:sekunde', (_e, z) => daten.journalZeile(z));
  ipcMain.handle('m:fertig', (_e, r) => { const id = daten.fahrtSpeichern(r); daten.journalEnde(); faehrt = false; schlafAus(); return id; });
  ipcMain.on('m:weg', () => { daten.journalEnde(); faehrt = false; schlafAus(); });

  menue();
  baueMaschine();
  baueBuehne();
  setInterval(verbinde, 15000);
  /* App wird während einer Fahrt beendet: was im Journal steht, wird zur Fahrt */
  app.on('will-quit', () => { if (faehrt) daten.journalRetten(); });
});
app.on('window-all-closed', () => app.quit());
