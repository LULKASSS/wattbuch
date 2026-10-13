/* Die App selbst aktualisieren (Rahmen: Electron, Fenster, Bluetooth, Strava, Apple TV).
 * Die Oberfläche kommt ohnehin laufend von der Webseite (update.js); dies hier ist für neue Releases.
 * Ohne gekauftes Zertifikat geht Electrons eingebauter Updater am Mac nicht, deshalb von Hand:
 * Beim Start und alle 6 h app-version.json aus dem jüngsten Release lesen. Ist sie neuer, die passende Datei laden
 * (Mac: Zip, Windows: Installer) und melden. Eingespielt wird beim Beenden, oder sofort mit Neustart, wenn die Seite fragt:
 * Mac: kleines Skript wartet, bis die App zu ist, tauscht Wattbuch.app aus und startet sie auf Wunsch neu.
 * Windows: Installer still (/S) laufen lassen, mit --force-run startet er die App danach selbst.
 * Nur in der gebauten App (oder mit WATTBUCH_SELFUPDATE_URL in Tests, dann ohne Einspielen). */
const { app, net } = require('electron');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BASE = 'https://github.com/LULKASSS/wattbuch/releases/latest/download';
const FILE = { darwin: 'Wattbuch-mac-arm64.zip', win32: 'Wattbuch-Setup-win-x64.exe' };
/* 1.10.0 > 1.9.3 */
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

function createSelfUpdate({ dataDir, send = () => {}, log = () => {} }) {
  const test = process.env.WATTBUCH_SELFUPDATE_URL;
  const base = test || BASE, file = FILE[process.platform];
  const on = !!file && (app.isPackaged || !!test) && process.env.WATTBUCH_SELFUPDATE !== '0';
  const dir = path.join(dataDir, 'neue-version');
  let ready = null, busy = false;

  async function get(url) {
    const r = await net.fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status} bei ${url}`);
    return Buffer.from(await r.arrayBuffer());
  }
  async function check() {
    if (!on || busy || ready) return ready;
    busy = true;
    try {
      const v = JSON.parse((await get(`${base}/app-version.json?t=${Date.now()}`)).toString()).version;
      if (!newer(v, app.getVersion())) return null;
      await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true });
      const out = path.join(dir, file);
      await fs.writeFile(out, await get(`${base}/${file}`));
      ready = { version: v, file: out };
      log(`App ${v} geladen, wird beim Beenden eingespielt`);
      send({ version: v });
    } catch (e) { log('App-Update: ' + e.message); }
    finally { busy = false; }
    return ready;
  }

  /* Wattbuch.app, in der wir laufen (…/Wattbuch.app/Contents/MacOS/Wattbuch) */
  const macBundle = () => { const b = path.resolve(process.execPath, '../../..'); return b.endsWith('.app') ? b : null; };
  function install(relaunch) {
    if (!ready || test) return false;
    if (process.platform === 'darwin') {
      const appPath = macBundle(); if (!appPath) return false;
      const sh = path.join(dir, 'einspielen.sh');
      fss.writeFileSync(sh, [
        '#!/bin/sh',
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
        'X="$2/x"; rm -rf "$X"; mkdir -p "$X"; ditto -x -k "$3" "$X" || exit 1',
        '[ -d "$X/Wattbuch.app" ] || exit 1',
        'rm -rf "$1.alt"; mv "$1" "$1.alt" && mv "$X/Wattbuch.app" "$1" && rm -rf "$1.alt" || mv "$1.alt" "$1"',
        'xattr -dr com.apple.quarantine "$1" 2>/dev/null',
        'rm -rf "$2"',
        '[ "$4" = 1 ] && open "$1"',
        ''].join('\n'), { mode: 0o755 });
      spawn('/bin/sh', [sh, appPath, dir, ready.file, relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn(ready.file, relaunch ? ['/S', '--force-run'] : ['/S'], { detached: true, stdio: 'ignore' }).unref();
    }
    ready = null;
    return true;
  }
  return { check, install, get ready() { return ready; }, on };
}

module.exports = { createSelfUpdate, newer };
