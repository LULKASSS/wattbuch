/* Wattbuch Neu: App für den Mac (Electron), eigene App neben der alten (eigener Name, eigene Kennung, eigener Datenordner).
 * Zwei Fenster: die Bühne (sichtbar: 3D-Welt und Anzeige) und der Maschinenraum (unsichtbar: Bluetooth, Fahrphysik,
 * Aufnahme). Stürzt die Bühne ab oder ruckelt sie, läuft die Aufnahme im Maschinenraum weiter; jede Sekunde landet
 * zusätzlich sofort im Journal auf der Platte. Die App lädt nichts aus dem Netz nach. */
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, powerSaveBlocker, shell } = require('electron');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createDaten } = require('./daten.cjs');
const { createKonto } = require('./konto.cjs');
const { uebernehmeAlt, createSicherung } = require('./alt.cjs');
const { createStrava } = require('./strava.cjs');
const { createStravaLauf } = require('./stravalauf.cjs');
const ICLOUD = path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs');

const BAU = path.join(__dirname, '..', 'bau');
/* Tests und Simulation (WATTBUCH_DATA=Ordner): eigener Speicher, nie die echten Daten */
const TEST_DATA = process.env.WATTBUCH_DATA && path.resolve(process.env.WATTBUCH_DATA);
/* Simulierte Rolle (nur aus dem Quellcode, test/ ist nicht Teil der gebauten App) */
const SIM = !!process.env.WATTBUCH_SIM, SIM_ALLE = process.env.WATTBUCH_SIM === '1';   // 'wahl': simulierte Geräte, aber nichts von selbst verbinden
const TEMPO = Math.max(1, +process.env.WATTBUCH_TEMPO || 1);

app.setName('Wattbuch Neu');
if (TEST_DATA) app.setPath('userData', path.join(TEST_DATA, 'profil'));
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!TEST_DATA && !app.requestSingleInstanceLock()) app.quit();

let offen = null;   // Art, für die das Geräte-Blatt gerade sucht
let buehne = null, maschine = null, daten = null, konto = null, sv = null, sicherung = null, wach = null, letzter = null, faehrt = false;
const ARTEN = ['rolle', 'puls', 'kadenz'];
const lebt = w => w && !w.isDestroyed() && !w.webContents.isDestroyed();
const anBuehne = (kanal, x) => { if (lebt(buehne)) buehne.webContents.send(kanal, x); };
const anMaschine = (kanal, x) => { if (lebt(maschine)) maschine.webContents.send(kanal, x); };

const prefs = () => ({ preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false });

function baueMaschine() {
  maschine = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: prefs() });
  const wc = maschine.webContents;
  /* Bluetooth ohne Auswahldialog: Der Maschinenraum sagt vorher, welche Art Gerät er sucht. Ist dafür ein Gerät
     gemerkt (geraete.json), wird es genommen, sobald es in der Suche auftaucht. Ist keins gemerkt, wird nur gesucht,
     wenn das Geräte-Blatt der Bühne offen ist: Dann gehen die gefundenen Geräte dorthin, die Wahl wird gemerkt. */
  let art = null, wahl = null, frist = null, kandidaten = [];
  for (const k of ['bt:suche', 'geraete:suche', 'geraete:wahl', 'geraete:abbruch']) ipcMain.removeAllListeners(k);
  ipcMain.on('bt:suche', (_e, a) => { art = a; });
  const schluss = id => { clearTimeout(frist); if (wahl) { const cb = wahl; wahl = null; try { cb(id || ''); } catch {} } };
  wc.on('select-bluetooth-device', (event, list, callback) => {
    event.preventDefault();
    if (!wahl) frist = setTimeout(() => { if (offen === art) { offen = null; anBuehne('geraete', { art, liste: null }); } schluss(''); }, offen === art ? 60000 : 12000);
    wahl = callback;
    const id = (daten.geraete()[art] || {}).id;
    if (id) { const d = list.find(x => x.deviceId === id); if (d) schluss(d.deviceId); return; }
    if (offen !== art) { schluss(''); return; }
    kandidaten = list.map(d => ({ id: d.deviceId, name: d.deviceName || 'Unbekanntes Gerät' }));
    anBuehne('geraete', { art, liste: kandidaten });
  });
  ipcMain.on('geraete:suche', (_e, a) => { if (!ARTEN.includes(a)) return; schluss(''); offen = a; kandidaten = []; verbinde([a]); });
  ipcMain.on('geraete:wahl', (_e, id) => {
    const d = kandidaten.find(x => x.id === id); if (!d || !offen) return;
    daten.geraeteSpeichern({ ...daten.geraete(), [offen]: d }); offen = null; schluss(d.id);
  });
  ipcMain.on('geraete:abbruch', () => { offen = null; schluss(''); });
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
   solange etwas fehlt (der Maschinenraum sucht nur, was nicht verbunden ist). Ohne Angabe: alle gemerkten Geräte. */
function verbinde(nur) {
  if (!lebt(maschine)) return;
  const gemerkt = daten.geraete(), arten = nur || (SIM_ALLE ? ARTEN : ARTEN.filter(a => gemerkt[a]));
  if (arten.length) maschine.webContents.executeJavaScript(`window.__verbinden&&window.__verbinden(${JSON.stringify(arten)})`, true).catch(() => {});
}

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
  /* Fenster schließen während einer Fahrt: nachfragen. Beim Beenden wird die Fahrt bis hierhin gesichert. */
  buehne.on('close', e => {
    if (!faehrt || TEST_DATA) return;   // in Tests und in der Simulation ohne Rückfrage
    const r = dialog.showMessageBoxSync(buehne, { type: 'question', buttons: ['Weiterfahren', 'Beenden'], defaultId: 0, cancelId: 0, message: 'Es läuft eine Fahrt.', detail: 'Beim Beenden wird sie bis hierhin gespeichert.' });
    if (r === 0) e.preventDefault();
  });
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
  /* Eigene Sicherung in iCloud Drive/Wattbuch Neu (ohne iCloud: Dokumente). Leerer Datenordner: von dort zurückholen. */
  let basis = path.join(os.homedir(), 'Documents'); try { fs.accessSync(ICLOUD); basis = ICLOUD; } catch {}
  sicherung = createSicherung(daten, TEST_DATA ? path.join(TEST_DATA, 'Sicherung') : path.join(basis, 'Wattbuch Neu'));
  const zurueck = sicherung.zurueck(); if (zurueck) console.log(`Sicherung zurückgeholt: ${zurueck} Dateien`);
  /* Einmalig Strecken und Werte aus der Sicherung der alten App lesen (nur lesen). In Tests nur mit WATTBUCH_ALT. */
  const alt = uebernehmeAlt(daten, process.env.WATTBUCH_ALT || (TEST_DATA ? null : path.join(ICLOUD, 'Wattbuch', 'wattbuch-sicherung.json')));
  if (alt) console.log(`Aus der alten App übernommen: ${alt.strecken} Strecken`);
  /* Fahrt vom letzten Mal liegen geblieben (Absturz, Strom weg): als Fahrt sichern */
  const gerettet = daten.journalRetten(); if (gerettet) console.log('Fahrt aus dem Journal wiederhergestellt');

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
  ipcMain.handle('daten:strecke', (_e, s) => { daten.streckeSpeichern(s); if (konto.synct(s)) konto.merkeDok('strecken', s.id); });
  ipcMain.handle('daten:fahrten', () => daten.fahrten());
  ipcMain.handle('daten:werte', () => daten.werte());
  ipcMain.handle('daten:fahrtDetail', (_e, id) => daten.fahrtDetail(String(id)));
  ipcMain.handle('daten:rivale', (_e, id, rev) => daten.rivale(id, rev));
  ipcMain.handle('daten:laeufe', (_e, id, rev) => daten.laeufe(id, rev));
  ipcMain.handle('daten:laufend', () => faehrt ? daten.journalLesen() : null);
  /* Konto, Werte, Geräte */
  konto = createKonto({ daten, melde: st => anBuehne('konto', st), log: m => console.log(m) });
  let dT = null;
  daten.aufAenderung(() => { sicherung.bald(); clearTimeout(dT); dT = setTimeout(() => { anBuehne('daten'); anMaschine('befehl', { was: 'werte' }); }, 400); });
  const heil = fn => async (_e, ...a) => { try { return { ok: true, ...(await fn(...a)) }; } catch (e) { return { ok: false, error: e.message }; } };
  ipcMain.handle('konto:status', () => konto.status());
  /* Mit simulierter Rolle nie ins echte Konto: erfundene Fahrten sollen dort nicht landen */
  const KONTO_AUS = SIM && !process.env.WATTBUCH_SUPABASE_URL;
  ipcMain.handle('konto:anmelden', heil((email, pw) => { if (KONTO_AUS) throw new Error('Kein Konto in der Simulation'); return konto.anmelden(String(email || '').trim(), String(pw || '')); }));
  ipcMain.handle('konto:abmelden', () => konto.abmelden());
  ipcMain.handle('werte:setzen', (_e, w) => {
    const fin = (x, a, b) => typeof x === 'number' && isFinite(x) && x >= a && x <= b, neu = { ...(daten.werte() || {}) };
    if (fin(w.ftp, 50, 600) && Math.round(w.ftp) !== neu.ftp) { if (neu.ftp) neu.ftpVor = neu.ftp; neu.ftp = Math.round(w.ftp); neu.ftpAm = new Date().toISOString(); } /* ftpAm: seit wann die FTP gilt */ if (fin(w.weight, 30, 200)) neu.weight = Math.round(w.weight * 10) / 10; if (fin(w.diff, .1, 1)) neu.diff = w.diff; if (typeof w.erg === 'boolean') neu.erg = w.erg;
    daten.werteSpeichern(neu); konto.merkeWerte(); return neu;
  });
  /* Strava: in Tests per WATTBUCH_STRAVA_URL auf einen nachgebauten Server (auch für den Token-Tausch), der Aufruf
     des Browsers landet dann in global.__stravaAuth. Mit simulierter Rolle sonst gesperrt. */
  const SV_URL = process.env.WATTBUCH_STRAVA_URL, SV_AUS = SIM && !SV_URL;
  const strava = createStrava({ dataDir: daten.dir, baseUrl: SV_URL || 'https://www.strava.com', log: m => console.log(m),
    ...(SV_URL ? { tokenUrl: SV_URL + '/functions/v1/strava-token', openBrowser: url => { global.__stravaAuth = url; } } : {}) });
  sv = createStravaLauf({ strava, daten, konto, log: m => console.log(m), wartezeit: +process.env.WATTBUCH_STRAVA_WARTEN || 15000,
    melde: x => anBuehne('strava', x), strecke: x => anMaschine('befehl', { was: 'strecke', ...x }) });
  ipcMain.handle('strava:status', heil(() => sv.status()));
  ipcMain.handle('strava:verbinden', heil(() => { if (SV_AUS) throw new Error('Kein Strava in der Simulation'); return sv.verbinden(); }));
  ipcMain.handle('strava:trennen', heil(() => sv.trennen()));
  ipcMain.handle('strava:abbrechen', (_e, id) => sv.abbrechen(String(id)));
  ipcMain.handle('strava:alsStrecke', heil(async id => ({ strecke: await sv.alsStrecke(String(id)) })));
  /* Strecke entfernen: nur hier auf dem Gerät und in der eigenen Sicherung; eine Runde aus Strava kommt nicht wieder */
  ipcMain.handle('daten:streckeWeg', (_e, id) => { id = String(id); const war = daten.strecke(id); daten.streckeLoeschen(id); if (konto.synct(war)) konto.merkeDok('strecken', id, true); if (id.startsWith('sf')) sv.rundeWeg(id); try { fs.rmSync(path.join(sicherung.dir, 'strecken', id.replace(/[^\w.~-]/g, '_') + '.json')); } catch {} return true; });
  /* Fahrt löschen (jede, auch alte und aus Strava übernommene; Lukas am 27.11.2026). Die Datei hier und in der eigenen Sicherung verschwindet,
     im Konto wird die Zeile als gelöscht markiert. Ein Upload zu Strava, der noch wartet, fällt aus. */
  ipcMain.handle('daten:fahrtLoeschen', (_e, id) => {
    id = String(id); const r = daten.fahrt(id); if (!r) return false;
    sv.abbrechen(id); daten.fahrtLoeschen(id); konto.fahrtWeg(id, r.start);
    try { fs.rmSync(path.join(sicherung.dir, 'fahrten', id.replace(/[^\w.~-]/g, '_') + '.json')); } catch {}
    return true;
  });
  if (!SV_AUS) setTimeout(() => sv.start(), 3000);
  /* Saison: das Ziel (FTP oder Tour bis zu einem Tag). null beendet sie. */
  ipcMain.handle('saison:lesen', () => daten.saison());
  ipcMain.handle('saison:setzen', (_e, s) => {
    const ok = s && (s.art === 'ftp' || s.art === 'tour') && isFinite(s.ziel) && s.ziel > 0 && /^\d{4}-\d\d-\d\d$/.test(s.bis) && /^\d{4}-\d\d-\d\d$/.test(s.von);
    daten.saisonSpeichern(ok ? { art: s.art, ziel: Math.round(s.ziel), bis: s.bis, von: s.von, ftp0: Math.round(+s.ftp0 || 200), last0: Math.round(+s.last0 || 0),
      ...(s.tage >= 1 && s.tage <= 7 && s.minuten >= 10 && s.minuten <= 300 ? { tage: Math.round(s.tage), minuten: Math.round(s.minuten) } : {}) } : null);
    konto.merkeDok('saison', 'ziel', !ok); return daten.saison();
  });
  ipcMain.handle('geraete:liste', () => daten.geraete());
  ipcMain.handle('geraete:vergessen', (_e, a) => { const g = daten.geraete(); delete g[a]; daten.geraeteSpeichern(g); anMaschine('befehl', { was: 'trenne', art: a }); return g; });
  ipcMain.on('ordner', () => shell.openPath(sicherung.dir));
  if (gerettet) konto.merke(gerettet);
  setTimeout(() => konto.abgleich(), 2500);
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
  ipcMain.handle('m:fertig', (_e, r) => {
    /* eine Runde des Plans ist ab der ersten Fahrt eine eigene Strecke und gleicht sich mit ab */
    const st = r.routeId ? daten.strecke(r.routeId) : null;
    if (st && st.plan) { delete st.plan; daten.streckeSpeichern(st); konto.merkeDok('strecken', st.id); }
    /* FTP-Test: das Ergebnis gilt gleich als neue FTP (im Profil lässt sie sich ändern) */
    if (r.ftpTest && r.ftpTest.ftp >= 50 && r.ftpTest.ftp <= 600) { { const w = daten.werte() || {}; daten.werteSpeichern({ ...w, ...(w.ftp ? { ftpVor: w.ftp } : {}), ftp: r.ftpTest.ftp, ftpAm: new Date().toISOString() }); } konto.merkeWerte(); }
    sv.vormerken(r); const id = daten.fahrtSpeichern(r); daten.journalEnde(); faehrt = false; schlafAus(); konto.merke(id); return { id, strava: r.strava ? r.strava.state : null };
  });
  ipcMain.on('m:weg', () => { daten.journalEnde(); faehrt = false; schlafAus(); });

  menue();
  baueMaschine();
  baueBuehne();
  setInterval(() => verbinde(), 15000);
  /* App wird während einer Fahrt beendet: was im Journal steht, wird zur Fahrt */
  app.on('will-quit', () => { if (faehrt) { const id = daten.journalRetten(); if (id) konto.merke(id); } sicherung.sichern(); });
});
app.on('window-all-closed', () => app.quit());
