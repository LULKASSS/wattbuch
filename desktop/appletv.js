/* Apple TV als Fernbedienung (Mac-App). Die eigentliche Arbeit macht pyatv in einem Python-Hilfsprogramm (appletv.py),
 * das hier gestartet wird und über JSON-Zeilen spricht. Beim ersten Einrichten legt die App dafür ein eigenes Python
 * (venv) im App-Datenordner an und installiert pyatv hinein; gebraucht wird nur ein Python 3 auf dem Mac.
 * Gemerkt wird ein Apple TV: appletv.json (Name, Kennung), pyatv.json (Zugangsdaten aus dem Koppeln, nur für den Benutzer lesbar).
 * Tests: WATTBUCH_ATV_FAKE=<Protokolldatei> nimmt statt Python test/fake-appletv.js. */
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const PYATV = 'pyatv==0.18.0';
const PYTHONS = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
  '/Library/Developer/CommandLineTools/usr/bin/python3', '/Applications/Xcode.app/Contents/Developer/usr/bin/python3'];

function createAppleTv({ dataDir, send = () => {}, log = () => {}, fake = process.env.WATTBUCH_ATV_FAKE }) {
  const dir = path.join(dataDir, 'appletv'), venv = path.join(dir, 'venv'), py = path.join(venv, 'bin', 'python3');
  const cfgFile = path.join(dir, 'appletv.json'), store = path.join(dir, 'pyatv.json');
  let cfg = null, proc = null, ready = null, seq = 0, conn = { connected: false }, play = null, power = null, setup = null;
  const waiting = new Map();
  const load = async () => { if (!cfg) { try { cfg = JSON.parse(await fs.readFile(cfgFile, 'utf8')); } catch { cfg = {}; } } return cfg; };
  const save = async () => { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(cfgFile, JSON.stringify(cfg)); };
  const run = (cmd, args, timeout) => new Promise((res, rej) => execFile(cmd, args, { timeout }, (e, out, err) => e ? rej(new Error((err || e.message).trim().split('\n').pop())) : res(out)));

  async function findPython() {
    for (const p of PYTHONS) {
      try { await fs.access(p, fss.constants.X_OK); const v = await run(p, ['-c', 'import sys;print(sys.version_info[:2]>=(3,9))'], 15000); if (v.trim() === 'True') return p; } catch {}
    }
    return null;
  }
  const installed = async () => { try { return (await fs.readFile(path.join(dir, 'installed'), 'utf8')).trim() === PYATV; } catch { return false; } };
  /* Einmalig: eigenes Python mit pyatv anlegen (dauert etwa eine halbe Minute) */
  function prepare() {
    if (fake) return Promise.resolve();
    if (!setup) setup = (async () => {
      if (await installed()) return;
      const base = await findPython();
      if (!base) throw Object.assign(new Error('Für die Apple-TV-Steuerung braucht der Mac Python 3 (python.org oder „xcode-select --install“).'), { code: 'nopython' });
      send({ ev: 'setup' });
      await fs.rm(venv, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      await run(base, ['-m', 'venv', venv], 120000);
      await run(py, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', PYATV], 300000);
      await fs.writeFile(path.join(dir, 'installed'), PYATV);
      log('Apple TV: pyatv eingerichtet');
    })().catch(e => { setup = null; throw e; });
    return setup;
  }

  /* Hilfsprogramm starten (nur eins, bleibt bis zum Beenden der App) */
  function start() {
    if (ready) return ready;
    ready = (async () => {
      await prepare();
      await fs.mkdir(dir, { recursive: true });
      let p;
      if (fake) p = spawn(process.execPath, [path.join(__dirname, '..', 'test', 'fake-appletv.js'), store, fake], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      else {
        /* Skript neben das venv kopieren: in der gebauten App liegt desktop/ im asar-Archiv, das Python nicht lesen kann */
        const script = path.join(dir, 'appletv.py');
        await fs.writeFile(script, await fs.readFile(path.join(__dirname, 'appletv.py')));
        p = spawn(py, ['-u', script, store], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
      }
      proc = p;
      let buf = '';
      await new Promise((resolve, reject) => {
        p.stdout.on('data', d => {
          buf += d; let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            let m; try { m = JSON.parse(line); } catch { continue; }
            if (m.ev === 'ready') resolve();
            else if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); clearTimeout(w.t); w.done(m); }
            else if (m.ev === 'state') { conn = { connected: !!m.connected, name: m.name || conn.name }; if (!m.connected) { play = null; power = null; } send(m); }
            else if (m.ev === 'play') { play = m; send(m); }
            else if (m.ev === 'power') { power = !!m.on; send(m); }
          }
        });
        p.stderr.on('data', d => log('Apple TV: ' + String(d).trim().split('\n').pop()));
        p.on('error', reject);
        p.on('exit', code => {
          reject(new Error('Hilfsprogramm beendet (' + code + ')'));
          if (proc === p) { proc = null; ready = null; conn = { connected: false }; play = null; power = null; send({ ev: 'state', connected: false }); }
          for (const [id, w] of waiting) { clearTimeout(w.t); w.done({ ok: false, error: 'Verbindung zum Apple TV abgebrochen' }); waiting.delete(id); }
        });
      });
    })().catch(e => { ready = null; if (proc) proc.kill(); throw e; });
    return ready;
  }
  async function call(cmd, args = {}, timeout = 20000) {
    await start();
    const id = ++seq;
    const m = await new Promise(done => {
      const t = setTimeout(() => { waiting.delete(id); done({ ok: false, error: 'Apple TV antwortet nicht' }); }, timeout);
      waiting.set(id, { done, t });
      proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n');
    });
    if (!m.ok) throw new Error(m.error);
    return m;
  }

  async function status() {
    const c = await load();
    return { device: c.id ? { id: c.id, name: c.name } : null, connected: conn.connected, play, power, prepared: !!fake || await installed() };
  }
  async function scan() { return { devices: (await call('scan', {}, 30000)).devices }; }
  let pairing = null;
  async function pair({ id, name }) {
    const r = await call('pair', { dev: id }, 30000);
    pairing = { id, name: name || 'Apple TV' };
    if (r.done) return finishPair();
    return { pin: true, protocol: r.protocol };
  }
  async function pin(code) {
    if (!pairing) throw new Error('Kein Koppeln aktiv');
    const r = await call('pin', { pin: String(code).replace(/\D/g, '') }, 30000);
    if (r.next) return { pin: true, protocol: r.next.protocol, again: true };
    return finishPair();
  }
  async function finishPair() {
    cfg = { id: pairing.id, name: pairing.name }; pairing = null; await save();
    await fs.chmod(store, 0o600).catch(() => {});
    connect().catch(() => {});
    return { done: true, ...(await status()) };
  }
  async function cancel() { pairing = null; if (proc) await call('cancel').catch(() => {}); return {}; }
  let connecting = null;
  function connect() {
    if (!connecting) connecting = (async () => {
      const c = await load();
      if (!c.id) throw new Error('Kein Apple TV gekoppelt');
      await call('connect', { dev: c.id }, 30000);
      return status();
    })().finally(() => { connecting = null; });
    return connecting;
  }
  /* Taste drücken; ist die Verbindung weg (Apple TV schlief), erst neu verbinden */
  async function key(k) {
    if (!conn.connected) await connect();
    await call('key', { key: k }, 10000);
    return {};
  }
  async function forget() {
    if (proc) proc.kill();
    await fs.rm(store, { force: true });
    cfg = {}; await save();
    return status();
  }
  const stop = () => { if (proc) proc.kill(); };

  return { status, prepare, scan, pair, pin, cancel, connect, key, forget, stop };
}

module.exports = { createAppleTv };
