/* Strecken: Höhe und Steigung an einer Stelle, Aufbau aus Punkten, Anstiege finden */
import type { Strecke } from './typen';
import { clamp, tempoBei } from './physik';

export const RSTEP = 25;
export interface Bahn { id: string; name: string; dist: number; step: number; ele: number[]; line: [number, number][]; gain: number; loop: boolean; rev: boolean }

export function hav(a: number[], b: number[]): number {
  const R = 6371000, p1 = a[0] * Math.PI / 180, p2 = b[0] * Math.PI / 180, dp = p2 - p1, dl = (b[1] - a[1]) * Math.PI / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
/* Strecke fahrbereit machen, auf Wunsch in Gegenrichtung */
export function bahn(r: Strecke, rev = false): Bahn {
  const ele = rev ? r.ele.slice().reverse() : r.ele, line = rev ? r.line.slice().reverse() : r.line, step = r.step || RSTEP;
  return { id: r.id, name: r.name, dist: (ele.length - 1) * step, step, ele, line, gain: r.gain, loop: hav(line[0], line[line.length - 1]) < 300, rev };
}
export function eleAt(rt: Bahn, d: number): number {
  const x = clamp(d, 0, rt.dist) / rt.step, i = Math.min(rt.ele.length - 2, Math.floor(x)), f = x - i;
  return rt.ele[i] + (rt.ele[i + 1] - rt.ele[i]) * f;
}
/* Steigung in Prozent, über 50 m gemittelt */
export function gradeAt(rt: Bahn, d: number): number {
  const a = clamp(d - 25, 0, rt.dist), b = clamp(d + 25, 0, rt.dist);
  return b > a ? clamp((eleAt(rt, b) - eleAt(rt, a)) / (b - a) * 100, -25, 25) : 0;
}
export function fahrzeit(rt: Bahn, d0: number, d1: number, P: number, m: number): number {
  let t = 0;
  for (let x = d0; x < d1; x += rt.step) { const s = Math.min(rt.step, d1 - x); t += s / tempoBei(P, gradeAt(rt, x + s / 2), m); }
  return t;
}
/* Aus Punkten [Breite, Länge, Höhe] eine Strecke: Höhe alle 25 m, zweifach über 7 Punkte geglättet
   (Strava- und GPX-Höhen rauschen, sonst zuckt die Steigung an der Rolle), Linie auf höchstens 2000 Punkte */
export function ausPunkten(name: string, pts: number[][]): Strecke {
  const xs = [0];
  for (let i = 1; i < pts.length; i++) xs.push(xs[i - 1] + hav(pts[i - 1], pts[i]));
  const L = xs[xs.length - 1];
  if (L < 1000) throw new Error('zu kurz');
  const n = Math.floor(L / RSTEP) + 1;
  let ele: number[] = [], j = 0;
  for (let k = 0; k < n; k++) {
    const x = k * RSTEP;
    while (j < xs.length - 2 && xs[j + 1] < x) j++;
    const f = xs[j + 1] > xs[j] ? (x - xs[j]) / (xs[j + 1] - xs[j]) : 0;
    ele.push(pts[j][2] + (pts[j + 1][2] - pts[j][2]) * clamp(f, 0, 1));
  }
  const sm = (a: number[]) => a.map((_, i) => { let s = 0, c = 0; for (let q = Math.max(0, i - 3); q <= Math.min(a.length - 1, i + 3); q++) { s += a[q]; c++; } return s / c; });
  ele = sm(sm(ele));
  let gain = 0;
  for (let i = 1; i < ele.length; i++) if (ele[i] > ele[i - 1]) gain += ele[i] - ele[i - 1];
  const every = Math.max(1, Math.ceil(pts.length / 2000));
  const line = pts.filter((_, i) => i % every === 0 || i === pts.length - 1).map(p => [+p[0].toFixed(5), +p[1].toFixed(5)] as [number, number]);
  return { id: 'g' + Math.round(L) + '-' + Math.abs(Math.round(pts[0][0] * 1e4 + pts[0][1] * 1e4)), name, dist: (n - 1) * RSTEP, step: RSTEP, gain: Math.round(gain), ele: ele.map(e => Math.round(e * 10) / 10), line };
}

/* Anstiege: ab 3 % im Schnitt, mindestens 200 m und 12 Hm. Kurze Dellen (bis 12 m runter, 400 m ohne neuen Gipfel)
   gehören dazu. over = Punkt hinter der Kuppe, ab dem es mit mehr als 2,5 % bergab geht (höchstens 300 m weiter). */
export interface Anstieg { s: number; top: number; over: number; gain: number; len: number; g: number }
export function anstiege(rt: Bahn): Anstieg[] {
  const e = rt.ele, st = rt.step, n = e.length, out: Anstieg[] = [];
  const g = (i: number) => { const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2); return (e[b] - e[a]) / ((b - a) * st) * 100; };
  let i = 0;
  while (i < n - 1) {
    if (g(i) < 2) { i++; continue; }
    let s = i, top = i, j = i;
    while (j < n - 1) { j++; if (e[j] > e[top]) top = j; if (e[top] - e[j] > 12 || (j - top) * st > 400) break; }
    while (top - s > 4 && g(s) < 3) s++;
    const gain = e[top] - e[s], len = (top - s) * st;
    if (gain >= 12 && len >= 200 && gain / len * 100 >= 3) {
      let ov = top * st;
      while (ov < rt.dist && ov - top * st < 300 && gradeAt(rt, ov) > -2.5) ov += st;
      out.push({ s: s * st, top: top * st, over: Math.min(ov, rt.dist), gain, len, g: gain / len * 100 });
    }
    i = Math.max(top, i) + 1;
  }
  return out;
}
