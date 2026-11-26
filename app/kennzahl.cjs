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
module.exports = { np, bestAvg, punkte };
