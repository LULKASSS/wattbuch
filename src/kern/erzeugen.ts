/* Erzeugte Runden (für den ersten Start und wenn keine eigene Strecke passt): Hügelrunde, Bergwertung, Flachstück.
   Abschnitte [km, Steigung %], daraus Höhen alle 25 m, als verbeulter Ring gelegt. */
import type { Strecke } from './typen';
import { ausPunkten } from './strecke';

type R = (a: number, b: number) => number;
const GEN: Record<string, { name: string; plan: (r: R) => number[][] }> = {
  huegel: { name: 'Hügelrunde', plan: r => { const a: number[][] = []; let left = r(24, 36); while (left > 0) { const up = r(1.2, 3.2), dn = r(1, 2.6), fl = r(.8, 3); a.push([fl, r(-.5, .8)], [up, r(3, 7.5)], [dn, -r(3, 6)]); left -= fl + up + dn; } return a; } },
  berg: { name: 'Bergwertung', plan: r => { const climb = r(7, 11), a = [[r(3, 5), r(0, 1.5)], [r(1, 2), r(2, 4)]]; let c = climb; while (c > 0) { const l = Math.min(c, r(.6, 1.8)); a.push([l, r(5, 10)]); c -= l; } a.push([r(.5, 1), r(1, 3)], [climb * .8, -r(5, 7)], [r(2, 4), r(-1, .5)]); return a; } },
  flach: { name: 'Flachstück', plan: r => { const a: number[][] = []; let left = r(32, 46); while (left > 0) { const l = r(2, 6); a.push([l, r(-1, 1)], [r(.3, .8), r(2, 4)], [r(.3, .8), -r(2, 4)]); left -= l + 1; } return a; } }
};
export const GEN_START: [string, number][] = [['huegel', 7], ['berg', 23], ['flach', 41]];

export function erzeuge(type: string, seed: number): Strecke {
  let x = seed >>> 0 || 1;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  const r: R = (a, b) => a + (b - a) * rnd(), g = GEN[type];
  const ele: number[] = []; let h = r(120, 450);
  for (const [km, gr] of g.plan(r)) { const n = Math.round(km * 40); for (let i = 0; i < n; i++) { h += 25 * (gr + Math.sin(ele.length / 9) * .6) / 100; ele.push(h); } }
  const n = ele.length, L = (n - 1) * 25;
  const Rk = L / (2 * Math.PI), k = [r(.08, .18), r(.05, .12)], ph = [r(0, 6), r(0, 6)], c = [50 + r(-1, 1), 10 + r(-1, 1)];
  const pts: number[][] = [];
  for (let i = 0; i < n; i += 4) { const t = i / (n - 1) * 2 * Math.PI, rr = Rk * (1 + k[0] * Math.sin(3 * t + ph[0]) + k[1] * Math.sin(5 * t + ph[1])); pts.push([c[0] + rr * Math.cos(t) / 111320, c[1] + rr * Math.sin(t) / (111320 * Math.cos(c[0] * Math.PI / 180)), ele[i]]); }
  const rt = ausPunkten(g.name, pts);
  rt.id = 'z' + type + seed; rt.gen = type;
  return rt;
}
