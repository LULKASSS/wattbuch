/* Übernahme aus der alten App und eigene Sicherung.
 * Übernahme: einmalig Strecken und Werte (FTP, Gewicht, Rad, Steigungsstärke) aus der Sicherung der alten App lesen
 * (iCloud Drive/Wattbuch/wattbuch-sicherung.json). Dort wird nur gelesen, nie geschrieben. Die Fahrten kommen
 * über das Konto, nicht aus dieser Datei.
 * Sicherung: jede Fahrt, jede Strecke und die Werte liegen zusätzlich im eigenen Ordner iCloud Drive/Wattbuch Neu/.
 * Ist der Datenordner leer (neuer Mac), kommt von dort alles zurück. Fahrten aus Strava werden nicht gesichert
 * (sie liegen im Konto). */
const fs = require('node:fs');
const path = require('node:path');

function uebernehmeAlt(daten, datei) {
  const merk = path.join(daten.dir, 'alt.json');
  if (!datei || fs.existsSync(merk)) return null;
  let d; try { d = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { return null; }
  if (!d || d.app !== 'wattbuch') return null;
  let n = 0; const da = new Set(daten.strecken().map(s => s.id));
  for (const s of d.routes || []) if (s && s.id && Array.isArray(s.ele) && Array.isArray(s.line) && s.ele.length >= 10 && !da.has(s.id)) { daten.streckeSpeichern(s); n++; }
  const v = d.settings || {}, fin = x => typeof x === 'number' && isFinite(x);
  if (!daten.werte()) daten.werteSpeichern({ ...(fin(v.ftp) ? { ftp: v.ftp } : {}), ...(fin(v.weight) ? { weight: v.weight } : {}), ...(fin(v.bike) ? { bike: v.bike } : {}), ...(fin(v.diff) ? { diff: v.diff } : {}) });
  daten.schreib(merk, { am: new Date().toISOString(), strecken: n });
  return { strecken: n };
}

function createSicherung(daten, dir) {
  const teile = ['fahrten', 'strecken'];
  const bereit = () => { try { for (const t of teile) fs.mkdirSync(path.join(dir, t), { recursive: true }); return true; } catch { return false; } };
  /* Alles Neue oder Geänderte hinüberkopieren (nach Größe und Zeit verglichen) */
  function sichern() {
    if (!dir || !bereit()) return 0;
    let n = 0;
    const kopie = (von, nach) => { try { const a = fs.statSync(von); let b = null; try { b = fs.statSync(nach); } catch {} if (!b || b.size !== a.size || b.mtimeMs < a.mtimeMs) { fs.copyFileSync(von, nach + '.tmp'); fs.renameSync(nach + '.tmp', nach); n++; } } catch {} };
    for (const t of teile) for (const f of fs.readdirSync(path.join(daten.dir, t))) {
      if (!f.endsWith('.json')) continue;
      if (t === 'fahrten' && f.startsWith('sv')) continue;   // aus Strava übernommene Fahrten bleiben im Konto
      kopie(path.join(daten.dir, t, f), path.join(dir, t, f));
    }
    if (fs.existsSync(path.join(daten.dir, 'werte.json'))) kopie(path.join(daten.dir, 'werte.json'), path.join(dir, 'werte.json'));
    return n;
  }
  /* Leerer Datenordner: aus der Sicherung zurückholen */
  function zurueck() {
    if (!dir || !fs.existsSync(dir)) return 0;
    if (daten.strecken().length || daten.fahrten().length) return 0;
    let n = 0;
    for (const t of teile) { const d = path.join(dir, t); if (!fs.existsSync(d)) continue; for (const f of fs.readdirSync(d)) if (f.endsWith('.json')) { fs.copyFileSync(path.join(d, f), path.join(daten.dir, t, f)); n++; } }
    if (fs.existsSync(path.join(dir, 'werte.json')) && !daten.werte()) fs.copyFileSync(path.join(dir, 'werte.json'), path.join(daten.dir, 'werte.json'));
    return n;
  }
  let t = null;
  return { sichern, zurueck, bald: () => { clearTimeout(t); t = setTimeout(sichern, 800); }, dir };
}
module.exports = { uebernehmeAlt, createSicherung };
