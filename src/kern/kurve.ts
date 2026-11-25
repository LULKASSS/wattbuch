/* Aus einer Strecke (Linie in Breite/Länge, Höhe alle 25 m) wird die Straße der Welt: Punkte alle 5 m in Metern,
   mit Richtung und Krümmung. Ohne 3D-Bibliothek, damit es sich ohne Grafik prüfen lässt.
   Die Linie alter Strecken ist grob (ein Punkt alle 100–200 m), deshalb werden Ecken zu Kurven gerundet. */
import type { Bahn } from './strecke';
import { eleAt } from './strecke';

export const DS = 5;
export interface Kurve {
  n: number; ds: number; len: number;      // ds = Abstand der Punkte in der Welt, len = Länge der Bahn (m gefahren)
  x: Float32Array; y: Float32Array; z: Float32Array;
  tx: Float32Array; tz: Float32Array;       // Richtung in der Ebene (Einheitsvektor)
  c: Float32Array;                          // Krümmung 1/m, positiv = Rechtskurve
  min: [number, number, number]; max: [number, number, number]; mitte: [number, number]; radius: number;
}

export function kurve(rt: Bahn): Kurve {
  const L = rt.line, lat0 = L.reduce((s, p) => s + p[0], 0) / L.length, lon0 = L.reduce((s, p) => s + p[1], 0) / L.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), kz = 111320;
  /* Osten = +x, Norden = −z (Blick von oben wie auf der Karte) */
  const px = L.map(p => (p[1] - lon0) * kx), pz = L.map(p => -(p[0] - lat0) * kz);
  const cum = [0];
  for (let i = 1; i < px.length; i++) cum.push(cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]));
  const total = cum[cum.length - 1];
  /* dicht abtasten */
  const m = Math.max(8, Math.round(total / DS)) + 1;
  let ax = new Float64Array(m), az = new Float64Array(m), j = 0;
  for (let i = 0; i < m; i++) {
    const d = i / (m - 1) * total;
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const f = cum[j + 1] > cum[j] ? (d - cum[j]) / (cum[j + 1] - cum[j]) : 0;
    ax[i] = px[j] + (px[j + 1] - px[j]) * f; az[i] = pz[j] + (pz[j + 1] - pz[j]) * f;
  }
  /* Ecken runden: dreimal über ±8 Punkte (±40 m) mitteln, Enden bleiben */
  const W = 8;
  for (let pass = 0; pass < 3; pass++) {
    const bx = new Float64Array(m), bz = new Float64Array(m);
    let sx = 0, sz = 0, cnt = 0, lo = 0, hi = -1;
    for (let i = 0; i < m; i++) {
      const w = Math.min(W, i, m - 1 - i), a = i - w, b = i + w;
      while (hi < b) { hi++; sx += ax[hi]; sz += az[hi]; cnt++; }
      while (lo < a) { sx -= ax[lo]; sz -= az[lo]; lo++; cnt--; }
      bx[i] = sx / cnt; bz[i] = sz / cnt;
    }
    ax = bx; az = bz;
  }
  /* neu nach Bogenlänge verteilen: so viele Punkte, wie die gefahrene Länge alle 5 m braucht */
  const c2 = new Float64Array(m);
  for (let i = 1; i < m; i++) c2[i] = c2[i - 1] + Math.hypot(ax[i] - ax[i - 1], az[i] - az[i - 1]);
  const lw = c2[m - 1], n = Math.max(8, Math.round(rt.dist / DS)) + 1;
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n), tx = new Float32Array(n), tz = new Float32Array(n), c = new Float32Array(n);
  let lowest = Infinity;
  for (const e of rt.ele) if (e < lowest) lowest = e;
  j = 0;
  for (let i = 0; i < n; i++) {
    const d = i / (n - 1) * lw;
    while (j < m - 2 && c2[j + 1] < d) j++;
    const f = c2[j + 1] > c2[j] ? (d - c2[j]) / (c2[j + 1] - c2[j]) : 0;
    x[i] = ax[j] + (ax[j + 1] - ax[j]) * f; z[i] = az[j] + (az[j + 1] - az[j]) * f;
    y[i] = eleAt(rt, i / (n - 1) * rt.dist) - lowest + 30;
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2), dx = x[b] - x[a], dz = z[b] - z[a], l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }
  const ds = lw / (n - 1);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 4), b = Math.min(n - 1, i + 4);
    c[i] = (tx[a] * tz[b] - tz[a] * tx[b]) / ((b - a) * ds);
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) { min[0] = Math.min(min[0], x[i]); max[0] = Math.max(max[0], x[i]); min[1] = Math.min(min[1], y[i]); max[1] = Math.max(max[1], y[i]); min[2] = Math.min(min[2], z[i]); max[2] = Math.max(max[2], z[i]); }
  const mitte: [number, number] = [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2];
  let radius = 0;
  for (let i = 0; i < n; i += 4) radius = Math.max(radius, Math.hypot(x[i] - mitte[0], z[i] - mitte[1]));
  return { n, ds, len: rt.dist, x, y, z, tx, tz, c, min, max, mitte, radius };
}
/* Stelle auf der Kurve für s gefahrene Meter: Index und Anteil bis zum nächsten Punkt */
export function stelle(k: Kurve, s: number): [number, number] {
  const f = Math.min(Math.max(s / k.len, 0), 1) * (k.n - 1), i = Math.min(k.n - 2, Math.floor(f));
  return [i, f - i];
}

/* Nächster Straßenpunkt zu einer Stelle im Gelände: Abstand und Straßenhöhe dort.
   Nah (bis ~250 m) genau über ein Raster, weiter weg aus einem groben Feld. */
export interface Naehe { nah(x: number, z: number): [number, number]; fern(x: number, z: number): [number, number] }
export function naehe(k: Kurve): Naehe {
  const CELL = 128, grid = new Map<number, number[]>(), key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
  for (let i = 0; i < k.n; i += 2) {
    const q = key(Math.floor(k.x[i] / CELL), Math.floor(k.z[i] / CELL));
    let l = grid.get(q); if (!l) grid.set(q, l = []); l.push(i);
  }
  /* grobes Feld: alle 400 m Abstand und Höhe des nächsten Punkts */
  const G = 400, RAND = 8000, gx0 = k.min[0] - RAND, gz0 = k.min[2] - RAND, gw = Math.ceil((k.max[0] - k.min[0] + 2 * RAND) / G) + 1, gh = Math.ceil((k.max[2] - k.min[2] + 2 * RAND) / G) + 1;
  const fd = new Float32Array(gw * gh), fy = new Float32Array(gw * gh), stepI = Math.max(1, Math.round(100 / k.ds));
  for (let b = 0; b < gh; b++) for (let a = 0; a < gw; a++) {
    const wx = gx0 + a * G, wz = gz0 + b * G; let bd = Infinity, by = 0;
    for (let i = 0; i < k.n; i += stepI) { const dx = k.x[i] - wx, dz = k.z[i] - wz, d = dx * dx + dz * dz; if (d < bd) { bd = d; by = k.y[i]; } }
    fd[b * gw + a] = Math.sqrt(bd); fy[b * gw + a] = by;
  }
  function fern(x: number, z: number): [number, number] {
    const u = Math.min(Math.max((x - gx0) / G, 0), gw - 1.001), v = Math.min(Math.max((z - gz0) / G, 0), gh - 1.001), a = Math.floor(u), b = Math.floor(v), fu = u - a, fv = v - b, i = b * gw + a;
    const mix = (f: Float32Array) => (f[i] * (1 - fu) + f[i + 1] * fu) * (1 - fv) + (f[i + gw] * (1 - fu) + f[i + gw + 1] * fu) * fv;
    return [mix(fd), mix(fy)];
  }
  /* Abstand zum Stück zwischen zwei Punkten, mit Höhe an der Fußstelle */
  function seg(a: number, b: number, x: number, z: number): [number, number] {
    const vx = k.x[b] - k.x[a], vz = k.z[b] - k.z[a], l2 = vx * vx + vz * vz || 1;
    const t = Math.min(1, Math.max(0, ((x - k.x[a]) * vx + (z - k.z[a]) * vz) / l2));
    const dx = k.x[a] + vx * t - x, dz = k.z[a] + vz * t - z;
    return [dx * dx + dz * dz, k.y[a] + (k.y[b] - k.y[a]) * t];
  }
  function nah(x: number, z: number): [number, number] {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let b1 = Infinity, i1 = -1, b2 = Infinity, i2 = -1;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const l = grid.get(key(cx + a, cz + b)); if (!l) continue;
      for (const i of l) {
        const dx = k.x[i] - x, dz = k.z[i] - z, d = dx * dx + dz * dz;
        if (d < b1) { if (i1 >= 0 && Math.abs(i - i1) > 60) { b2 = b1; i2 = i1; } b1 = d; i1 = i; }
        else if (d < b2 && Math.abs(i - i1) > 60) { b2 = d; i2 = i; }
      }
    }
    if (i1 < 0) return fern(x, z);
    const at = (i: number): [number, number] => {
      const p = seg(Math.max(0, i - 2), i, x, z), q = seg(i, Math.min(k.n - 1, i + 2), x, z);
      return p[0] < q[0] ? p : q;
    };
    const [d1, y1] = at(i1);
    if (i2 < 0) return [Math.sqrt(d1), y1];
    /* Zwei Straßenstücke in der Nähe (Kehre, Hin- und Rückweg): Höhe nach Abstand gewichtet, damit keine Kante entsteht */
    const [d2, y2] = at(i2), w1 = 1 / (d1 * d1 + 1), w2 = 1 / (d2 * d2 + 1);
    return [Math.sqrt(Math.min(d1, d2)), (y1 * w1 + y2 * w2) / (w1 + w2)];
  }
  return { nah, fern };
}
