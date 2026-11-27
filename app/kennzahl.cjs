/* Kennzahlen einer Fahrt (wie in der alten App): gewichtete Leistung (30-s-Mittel hoch 4), Belastung in Punkten
 * (eine Stunde an der FTP = 100) und der beste Schnitt über eine Dauer. Ohne Wattmessung (Fahrten aus Strava) zählt
 * die geschätzte Durchschnittsleistung. Gerechnet wird mit der FTP, die bei der Fahrt galt. */
function np(p) {
  const n = p.length; if (!n) return 0;
  if (n < 30) return p.reduce((a, v) => a + v, 0) / n;
  let s = 0, q = 0, c = 0;
  for (let i = 0; i < n; i++) { s += p[i]; if (i >= 30) s -= p[i - 30]; if (i >= 29) { const m = s / 30; q += m * m * m * m; c++; } }
  return Math.pow(q / c, .25);
}
function bestAvg(p, d) {
  if (p.length < d) return null;
  let s = 0, best = 0;
  for (let i = 0; i < p.length; i++) { s += p[i]; if (i >= d) s -= p[i - d]; if (i >= d - 1 && s > best) best = s; }
  return best / d;
}
function punkte(r, ftpJetzt = 200) {
  const ftp = r.ftp > 0 ? r.ftp : ftpJetzt;
  if (r.noW) { const IF = r.estW ? r.estW / ftp : 0; return IF ? (r.dur || 0) * IF * IF / 36 : 0; }
  const n = r.p.length; if (!n) return 0;
  const x = np(r.p);
  return n * x * (x / ftp) / (ftp * 36);
}
/* Alles, was die Ansicht einer einzelnen Fahrt zeigt: Kennzahlen, die Leistung als Kurve (höchstens 240 Punkte)
   und Höhe über Strecke (höchstens 1500 Punkte), aus der sich die Welt zur Fahrt bauen lässt. */
function detail(r, ftpJetzt = 200) {
  const ftp = r.ftp > 0 ? r.ftp : ftpJetzt, p = r.noW ? [] : r.p || [], n = p.length, dauer = n || r.dur || 0;
  const mittel = a => { const v = (a || []).filter(x => x > 0); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const max = a => { let m = 0; for (const x of a || []) if (x > m) m = x; return m || null; };
  const rund = x => x == null ? null : Math.round(x);
  const km = r.dist && r.dist.length ? r.dist[r.dist.length - 1] / 1000 : 0, x = n ? np(p) : 0;
  const kurve = []; if (n) { const st = Math.max(1, Math.ceil(n / 240)); for (let i = 0; i < n; i += st) { let s = 0, c = 0; for (let j = i; j < Math.min(n, i + st); j++) { s += p[j]; c++; } kurve.push(Math.round(s / c)); } }
  let hoehe = null;
  if (r.dist && r.dist.length > 1) { const st = Math.max(1, Math.ceil(r.dist.length / 1500)); hoehe = []; for (let i = 0; i < r.dist.length; i += st) hoehe.push([r.dist[i], r.alt && r.alt[i] != null ? r.alt[i] : 0]); }
  return { id: r.id, start: r.start, name: r.name, dauer, km, hm: Math.round(r.gain || 0), ftp,
    avgW: n ? Math.round(p.reduce((a, v) => a + v, 0) / n) : r.estW || null, np: n ? Math.round(x) : null, anteil: n ? Math.round(x / ftp * 100) : null,
    tss: Math.round(punkte(r, ftpJetzt)), kj: n ? Math.round(p.reduce((a, v) => a + v, 0) / 1000) : null, maxW: rund(max(p)),
    b5: rund(bestAvg(p, 5)), b60: rund(bestAvg(p, 60)), b300: rund(bestAvg(p, 300)), b1200: rund(bestAvg(p, 1200)),
    hr: rund(mittel(r.hr)), hrMax: rund(max(r.hr)), cad: rund(mittel(r.cad)), kmh: km && dauer ? Math.round(km / dauer * 36000) / 10 : null,
    geschaetzt: !!r.noW, kurve, hoehe };
}
module.exports = { np, bestAvg, punkte, detail };
