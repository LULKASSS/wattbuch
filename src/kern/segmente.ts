/* Segmente einer Runde: die ganze Runde und jeder größere Anstieg (ab 20 Hm). Jede Rollenfahrt auf derselben Strecke
   in derselben Richtung ist ein Versuch; die Zeit kommt aus ihren Metern pro Sekunde. Gespeichert wird davon nichts,
   es lässt sich aus Strecke und Fahrten jederzeit neu ausrechnen. */
import { anstiege, type Bahn } from './strecke';

export interface Segment { id: string; art: 'runde' | 'anstieg'; von: number; bis: number; len: number; gain: number; g: number }
export interface Lauf { id: string; start: string; dist: number[] }
export interface Versuch { fahrt: string; start: string; zeit: number }

export function segmente(rt: Bahn): Segment[] {
  const kopf = rt.id + (rt.rev ? ':r' : ':h');
  const out: Segment[] = [{ id: kopf + ':runde', art: 'runde', von: 0, bis: rt.dist, len: rt.dist, gain: rt.gain, g: 0 }];
  for (const a of anstiege(rt)) if (a.gain >= 20) out.push({ id: `${kopf}:${Math.round(a.s)}`, art: 'anstieg', von: a.s, bis: a.top, len: a.len, gain: Math.round(a.gain), g: a.g });
  return out;
}
/* Sekunde (mit Bruchteil), zu der eine Fahrt s Meter erreicht hat; null, wenn sie nicht so weit kam */
export function wann(dist: number[], s: number): number | null {
  const n = dist.length;
  if (!n || dist[n - 1] < s - 3) return null;
  if (s <= 0) return 0;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (dist[m] < s) lo = m + 1; else hi = m; }
  const a = lo ? dist[lo - 1] : 0;
  return lo + (dist[lo] > a ? Math.min(1, (s - a) / (dist[lo] - a)) : 1);
}
export function zeitAuf(seg: Segment, dist: number[]): number | null {
  const a = wann(dist, seg.von), b = wann(dist, seg.bis);
  return a == null || b == null || b <= a ? null : b - a;
}
/* Alle Versuche auf einem Segment, schnellster zuerst */
export function versuche(seg: Segment, laeufe: Lauf[]): Versuch[] {
  const out: Versuch[] = [];
  for (const l of laeufe) { const z = zeitAuf(seg, l.dist); if (z != null) out.push({ fahrt: l.id, start: l.start, zeit: z }); }
  return out.sort((a, b) => a.zeit - b.zeit);
}
