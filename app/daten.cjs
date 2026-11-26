/* Speicher der App: Dateien im Datenordner (eine je Fahrt und Strecke) und das Journal der laufenden Fahrt.
 * Das Journal bekommt jede aufgenommene Sekunde sofort angehängt. Stürzt die App ab, wird daraus beim
 * nächsten Start eine Fahrt. Geschrieben wird nur hier im Hauptprozess, nie aus der Grafik heraus. */
const fs = require('node:fs');
const path = require('node:path');
const { punkte, bestAvg } = require('./kennzahl.cjs');

function createDaten(dir) {
  const D = { strecken: path.join(dir, 'strecken'), fahrten: path.join(dir, 'fahrten') };
  for (const d of Object.values(D)) fs.mkdirSync(d, { recursive: true });
  const journal = path.join(dir, 'laufend.jsonl');
  const safe = id => String(id).replace(/[^\w.~-]/g, '_');
  const lies = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
  /* erst daneben schreiben, dann umbenennen: nie eine halbe Datei */
  const schreib = (f, obj) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, f); };
  const alle = d => fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => lies(path.join(d, f), null)).filter(Boolean);

  /* Strecken kurz (Name, Länge), um alte Fahrten zuzuordnen: Die alte App merkt sich nur den Streckennamen,
     die Gegenrichtung als Zusatz „ (umgekehrt)“. */
  let sk = null;
  const streckenKurz = () => sk || (sk = alle(D.strecken).map(s => ({ id: s.id, name: s.name, dist: s.dist || (s.ele.length - 1) * (s.step || 25) })));
  const UM = / \(umgekehrt\)$/;
  function zuordnung(r) {
    const S = streckenKurz();
    let st = r.routeId ? S.find(s => s.id === r.routeId) : null;
    if (!st && r.route) st = S.find(s => s.name === r.route.replace(UM, ''));
    return { st: st || null, rev: r.rev != null ? !!r.rev : !!(r.route && UM.test(r.route)) };
  }
  /* Zeit für eine ganze Runde: Sekunden, bis die Länge der Strecke erreicht ist (alte Fahrten fahren danach weiter) */
  function rundenzeit(r, st) {
    if (!st || !r.dist || !r.dist.length) return 0;
    const ziel = st.dist - 5; let lo = 0, hi = r.dist.length - 1;
    if (r.dist[hi] < ziel) return 0;
    while (lo < hi) { const m = (lo + hi) >> 1; if (r.dist[m] < ziel) lo = m + 1; else hi = m; }
    return lo + 1;
  }
  const rolle = r => r.src !== 'strava' && r.trainer !== false && !r.noW;
  function kurz(r) {
    const { st, rev } = zuordnung(r), rz = rolle(r) ? rundenzeit(r, st) : 0;
    const n = r.noW ? r.dur || 0 : r.p.length, avgW = r.noW ? r.estW || null : n ? Math.round(r.p.reduce((a, v) => a + v, 0) / n) : null;
    return { id: r.id, start: r.start, name: r.name, routeId: st ? st.id : null, rev, ganz: rz > 0, rolle: rolle(r), dauer: rz || n, zeit: n, km: r.dist && r.dist.length ? r.dist[r.dist.length - 1] / 1000 : 0, hm: Math.round(r.gain || 0), avgW,
      stravaId: r.strava && r.strava.id ? String(r.strava.id) : null, neu: r.app === 'neu', draussen: r.src === 'strava' && !r.trainer,
      /* für Saison und Fortschritt: Belastung in Punkten, bester 20-min-Schnitt, Ergebnis eines FTP-Tests */
      tss: Math.round(punkte(r) * 10) / 10, b20: r.noW ? null : (b => b ? Math.round(b) : null)(bestAvg(r.p, 1200)), ftpTest: r.ftpTest ? r.ftpTest.ftp : null };
  }
  let liste = null;
  const fahrten = () => liste || (liste = alle(D.fahrten).map(kurz).sort((a, b) => a.start.localeCompare(b.start)));
  const melde = () => { for (const f of hoerer) try { f(); } catch {} };
  const hoerer = [];

  function fahrtSpeichern(r) { schreib(path.join(D.fahrten, safe(r.id) + '.json'), r); liste = null; melde(); return r.id; }
  function fahrtLoeschen(id) { try { fs.rmSync(path.join(D.fahrten, safe(id) + '.json')); } catch {} liste = null; melde(); }
  const fahrt = id => lies(path.join(D.fahrten, safe(id) + '.json'), null);
  /* Alle Rollenfahrten auf einer Strecke in einer Richtung, mit ihren Metern pro Sekunde bis zum Ende der ersten Runde */
  function laeufe(streckeId, rev) {
    const st = streckenKurz().find(s => s.id === streckeId); if (!st) return [];
    return fahrten().filter(f => f.routeId === streckeId && f.rev === !!rev && f.rolle).map(f => { const r = fahrt(f.id); if (!r || !r.dist) return null; const n = f.ganz ? f.dauer : r.dist.length; return { id: r.id, start: r.start, dist: r.dist.slice(0, n) }; }).filter(Boolean);
  }
  function streckeLoeschen(id) { try { fs.rmSync(path.join(D.strecken, safe(id) + '.json')); } catch {} sk = null; liste = null; melde(); }
  /* Rivale: schnellste ganze Runde auf dieser Strecke in dieser Richtung, nur Rollenfahrten */
  function rivale(streckeId, rev) {
    const best = fahrten().filter(f => f.routeId === streckeId && f.rev === !!rev && f.ganz && f.rolle).sort((a, b) => a.dauer - b.dauer)[0];
    if (!best) return null;
    const r = fahrt(best.id);
    return r && r.dist ? { id: r.id, start: r.start, dist: r.dist.slice(0, best.dauer) } : null;
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
    const j = journalLesen(); zu(); let id = null;
    if (j && j.sek.length >= 10) {
      const any = a => a.some(v => v > 0), col = i => j.sek.map(s => s[i]);
      const k = j.kopf, p = col(0), hr = col(1), cad = col(2), spd = col(3), dist = col(4), alt = col(5);
      id = fahrtSpeichern({ id: 'r' + Date.parse(k.start) + 'neu', start: k.start, name: k.route || 'Rollentraining', p, hr: any(hr) ? hr : null, cad: any(cad) ? cad : null, spd: any(spd) ? spd : null, dist: any(dist) ? dist : null, alt: alt.some(v => v != null) ? alt : null,
        route: k.route || null, routeId: k.streckeId || null, rev: !!k.rev, ganz: false, gain: 0, trainer: !!k.trainer, ftp: k.ftp, weight: k.weight, app: 'neu', gerettet: true });
    }
    try { fs.rmSync(journal); } catch {}
    return id;
  }

  return {
    dir,
    strecken: () => alle(D.strecken),
    streckeSpeichern: s => { schreib(path.join(D.strecken, safe(s.id) + '.json'), s); sk = null; liste = null; melde(); },
    fahrten, fahrt, fahrtSpeichern, fahrtLoeschen, rivale, laeufe, streckeLoeschen,
    fahrtIds: () => fs.readdirSync(D.fahrten).filter(f => f.endsWith('.json')).map(f => lies(path.join(D.fahrten, f), null)).filter(Boolean).map(r => ({ id: r.id, neu: r.app === 'neu' })),
    aufAenderung: f => hoerer.push(f), lies, schreib,
    strecke: id => lies(path.join(D.strecken, safe(id) + '.json'), null),
    saison: () => lies(path.join(dir, 'saison.json'), null),
    saisonSpeichern: s => { if (s) schreib(path.join(dir, 'saison.json'), s); else try { fs.rmSync(path.join(dir, 'saison.json')); } catch {} melde(); },
    werte: () => lies(path.join(dir, 'werte.json'), null),
    werteSpeichern: w => { schreib(path.join(dir, 'werte.json'), w); melde(); },
    geraete: () => lies(path.join(dir, 'geraete.json'), {}),
    geraeteSpeichern: g => schreib(path.join(dir, 'geraete.json'), g),
    journalStart, journalZeile, journalEnde, journalLesen, journalRetten
  };
}
module.exports = { createDaten };
