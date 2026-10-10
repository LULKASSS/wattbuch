/* Automatisches Update der Mac-App.
 * Die App selbst (Fenster, Bluetooth, Sicherung) ist fest eingebaut. Die Oberfläche (index.html, app.css, js/)
 * holt sie sich von der Webseite: Beim Start und alle 30 min wird manifest.json verglichen, geänderte Dateien
 * werden geladen, gegen die Prüfsumme geprüft und erst dann als neue Version freigegeben.
 * Ohne Netz oder bei einem Fehler bleibt die letzte gute Version (oder die eingebaute) aktiv. */
const { net } = require('electron');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ALLOWED = /^(index\.html|app\.css|js\/[\w-]+\.js)$/;
const sha = buf => createHash('sha256').update(buf).digest('hex');

function createUpdater({ bundledRoot, dataDir, baseUrl, log = () => {} }) {
  const webDir = path.join(dataDir, 'web');
  const curFile = path.join(webDir, 'aktuell.json');
  const bundled = JSON.parse(fss.readFileSync(path.join(bundledRoot, 'manifest.json'), 'utf8'));
  let active = { version: bundled.version, root: bundledRoot, manifest: bundled };

  /* Beim Start: letzte heruntergeladene Version übernehmen, aber nur, wenn sie zu dieser Installation gehört
     (nach einer Neuinstallation gewinnt die eingebaute Fassung, alte Downloads werden verworfen) */
  function init() {
    try {
      const cur = JSON.parse(fss.readFileSync(curFile, 'utf8'));
      const root = path.join(webDir, cur.version);
      if (cur.bundled === bundled.version && fss.existsSync(path.join(root, 'manifest.json')))
        active = { version: cur.version, root, manifest: JSON.parse(fss.readFileSync(path.join(root, 'manifest.json'), 'utf8')) };
      else fss.rmSync(webDir, { recursive: true, force: true });
    } catch {}
    return active;
  }

  async function get(url, ms = 8000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await net.fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`${r.status} bei ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } finally { clearTimeout(t); }
  }

  /* Liefert true, wenn eine neue Version bereitsteht */
  let running = null;
  function check() {
    if (running) return running;
    running = (async () => {
      const remote = JSON.parse((await get(`${baseUrl}/manifest.json?t=${Date.now()}`, 5000)).toString('utf8'));
      if (remote.manifest !== 'wattbuch-web' || !remote.version || typeof remote.files !== 'object') throw new Error('Manifest unbrauchbar');
      if (remote.version === active.version) return false;
      const names = Object.keys(remote.files);
      if (!names.length || !names.every(n => ALLOWED.test(n))) throw new Error('Manifest enthält unerlaubte Dateien');
      const tmp = path.join(webDir, `.${remote.version}-${process.pid}`);
      await fs.rm(tmp, { recursive: true, force: true });
      for (const n of names) {
        const want = remote.files[n];
        let buf = active.manifest.files[n] === want ? await fs.readFile(path.join(active.root, n)) : await get(`${baseUrl}/${n}?v=${remote.version}`);
        if (sha(buf) !== want) throw new Error(`Prüfsumme passt nicht: ${n}`);
        await fs.mkdir(path.dirname(path.join(tmp, n)), { recursive: true });
        await fs.writeFile(path.join(tmp, n), buf);
      }
      await fs.writeFile(path.join(tmp, 'manifest.json'), JSON.stringify(remote));
      const dest = path.join(webDir, remote.version);
      await fs.rm(dest, { recursive: true, force: true });
      await fs.rename(tmp, dest);
      await fs.writeFile(curFile, JSON.stringify({ version: remote.version, bundled: bundled.version, at: new Date().toISOString() }));
      const old = active.root;
      active = { version: remote.version, root: dest, manifest: remote };
      /* Ältere Downloads aufräumen (die eingebaute Fassung bleibt natürlich) */
      for (const d of await fs.readdir(webDir)) if (d !== remote.version && d !== 'aktuell.json') await fs.rm(path.join(webDir, d), { recursive: true, force: true }).catch(() => {});
      log(`Update ${path.basename(old)} → ${remote.version}`);
      return true;
    })().finally(() => { running = null; });
    return running;
  }

  return { init, check, get active() { return active; }, bundled };
}

module.exports = { createUpdater };
