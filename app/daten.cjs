/* Speicher der App: Dateien im Datenordner (eine je Fahrt und Strecke) und das Journal der laufenden Fahrt.
 * Das Journal bekommt jede aufgenommene Sekunde sofort angehängt. Stürzt die App ab, wird daraus beim
 * nächsten Start eine Fahrt. Geschrieben wird nur hier im Hauptprozess, nie aus der Grafik heraus. */
const fs = require('node:fs');
const path = require('node:path');

function createDaten(dir) {
  const D = { strecken: path.join(dir, 'strecken'), fahrten: path.join(dir, 'fahrten') };
  for (const d of Object.values(D)) fs.mkdirSync(d, { recursive: true });
  const journal = path.join(dir, 'laufend.jsonl');
  const safe = id => String(id).replace(/[^\w.~-]/g, '_');
  const lies = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
  /* erst daneben schreiben, dann umbenennen: nie eine halbe Datei */
  const schreib = (f, obj) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, f); };
  const alle = d => fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => lies(path.join(d, f), null)).filter(Boolean);

  const kurz = r => ({ id: r.id, start: r.start, name: r.name, routeId: r.routeId || null, rev: !!r.rev, ganz: !!r.ganz, dauer: r.noW ? r.dur || 0 : r.p.length, km: r.dist && r.dist.length ? r.dist[r.dist.length - 1] / 1000 : 0 });
  let liste = null;
  const fahrten = () => liste || (liste = alle(D.fahrten).map(kurz).sort((a, b) => a.start.localeCompare(b.start)));

  function fahrtSpeichern(r) { schreib(path.join(D.fahrten, safe(r.id) + '.json'), r); liste = null; return r.id; }
  const fahrt = id => lies(path.join(D.fahrten, safe(id) + '.json'), null);
  /* Bester ganzer Versuch auf dieser Strecke in dieser Richtung */
  function rivale(streckeId, rev) {
    const best = fahrten().filter(f => f.routeId === streckeId && f.rev === !!rev && f.ganz).sort((a, b) => a.dauer - b.dauer)[0];
    if (!best) return null;
    const r = fahrt(best.id);
    return r && r.dist ? { id: r.id, start: r.start, dist: r.dist } : null;
  }

  /* Journal der laufenden Fahrt */
  let fd = null;
  const zu = () => { if (fd != null) { try { fs.closeSync(fd); } catch {} fd = null; } };
  function journalStart(kopf) { zu(); fs.writeFileSync(journal, JSON.stringify({ kopf }) + '\n'); fd = fs.openSync(journal, 'a'); }
  function journalZeile(z) { if (fd == null) return; fs.writeSync(fd, JSON.stringify(z) + '\n'); }
  function journalEnde() { zu(); try { fs.rmSync(journal); } catch {} }
  /* Journal lesen: Kopf und alle Sekunden (Kürzungen der Auto-Pause eingerechnet) */
  function journalLesen() {
    let text; try { text = fs.readFileSync(journal, 'utf8'); } catch { return null; }
    let kopf = null; const sek = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      let z; try { z = JSON.parse(line); } catch { continue; } // letzte Zeile kann beim Absturz halb sein
      if (z.kopf) kopf = z.kopf; else if (z.kuerze != null) sek.length = Math.min(sek.length, z.kuerze); else if (Array.isArray(z)) sek.push(z);
    }
    return kopf ? { kopf, sek } : null;
  }
  /* Aus einem liegen gebliebenen Journal eine Fahrt machen (unter 10 s lohnt nicht) */
  function journalRetten() {
    const j = journalLesen(); zu();
    if (j && j.sek.length >= 10) {
      const any = a => a.some(v => v > 0), col = i => j.sek.map(s => s[i]);
      const k = j.kopf, p = col(0), hr = col(1), cad = col(2), spd = col(3), dist = col(4), alt = col(5);
      fahrtSpeichern({ id: 'r' + Date.parse(k.start) + 'neu', start: k.start, name: k.route || 'Rollentraining', p, hr: any(hr) ? hr : null, cad: any(cad) ? cad : null, spd: any(spd) ? spd : null, dist: any(dist) ? dist : null, alt: alt.some(v => v != null) ? alt : null,
        route: k.route || null, routeId: k.streckeId || null, rev: !!k.rev, ganz: false, gain: 0, trainer: !!k.trainer, ftp: k.ftp, weight: k.weight, app: 'neu', gerettet: true });
    }
    try { fs.rmSync(journal); } catch {}
    return !!(j && j.sek.length >= 10);
  }

  return {
    dir,
    strecken: () => alle(D.strecken),
    streckeSpeichern: s => schreib(path.join(D.strecken, safe(s.id) + '.json'), s),
    fahrten, fahrt, fahrtSpeichern, rivale,
    werte: () => lies(path.join(dir, 'werte.json'), null),
    werteSpeichern: w => schreib(path.join(dir, 'werte.json'), w),
    geraete: () => lies(path.join(dir, 'geraete.json'), {}),
    geraeteSpeichern: g => schreib(path.join(dir, 'geraete.json'), g),
    journalStart, journalZeile, journalEnde, journalLesen, journalRetten
  };
}
module.exports = { createDaten };
