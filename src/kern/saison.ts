/* Saison: ein Ziel (eine FTP bis zu einem Datum oder eine lange Tour), daraus Wochen mit einem Pensum in Punkten
   und für jeden Tag eine Fahrt: eine Art (locker, Grundlage, zügig, lang), eine Zielleistung und eine Dauer.
   Keine Intervall-Programme. Der Plan steht nicht fest im Kalender: Jeden Tag wird aus dem, was diese Woche wirklich
   gefahren wurde (auch draußen), neu gerechnet, was heute passt. Ausgelassene Tage verschieben sich so von selbst. */
import type { FahrtKurz, Strecke } from './typen';
import { form, montag, tagAus, tagNr, wocheIst, wochentag } from './form';
import { w5 } from './coach';
import { bahn, fahrzeit } from './strecke';
import { erzeuge } from './erzeugen';
import { clamp } from './physik';

export interface Saison {
  art: 'ftp' | 'tour';
  ziel: number;      // Watt oder Kilometer
  bis: string;       // Tag des Ziels, JJJJ-MM-TT
  von: string;       // Tag, an dem die Saison angelegt wurde
  ftp0: number;      // FTP zu Beginn
  last0: number;     // Punkte pro Woche, die zu Beginn gewohnt waren
}
export interface Woche { nr: number; mo: number; soll: number; art: 'aufbau' | 'ruhe' | 'ziel' }
export type Tagesart = 'frei' | 'locker' | 'grundlage' | 'zuegig' | 'lang' | 'test';
export interface Tagesplan {
  woche: Woche; wochen: number; soll: number; ist: number; fahrtenSoll: number; fahrtenIst: number;
  art: Tagesart; erledigt: boolean; anteil: number;   // Anteil der FTP als Grundleistung
  watt: number; minuten: number; vorbei: boolean;
}
export const ART: Record<Tagesart, { name: string; anteil: number; oben: number; min: [number, number] }> = {
  frei: { name: 'Frei', anteil: .6, oben: .75, min: [30, 45] },
  locker: { name: 'Locker', anteil: .62, oben: .75, min: [30, 60] },
  grundlage: { name: 'Grundlage', anteil: .72, oben: .85, min: [40, 100] },
  zuegig: { name: 'Zügig', anteil: .85, oben: 1, min: [35, 75] },
  lang: { name: 'Lang', anteil: .68, oben: .8, min: [75, 180] },
  test: { name: 'FTP-Test', anteil: .5, oben: 1.5, min: [25, 25] }
};
/* Gewohntes Pensum: Punkte pro Woche im Schnitt der letzten sechs ganzen Wochen */
export function gewohnt(fahrten: FahrtKurz[], heute: number): number {
  const mo = montag(heute); let s = 0;
  for (let k = 1; k <= 6; k++) s += wocheIst(fahrten, mo - 7 * k).punkte;
  return s / 6;
}
/* Wochen der Saison: drei Wochen Aufbau (je +6 %), dann eine ruhigere (60 %), die Woche des Ziels halb */
export function wochen(s: Saison): Woche[] {
  const a = montag(tagAus(s.von)), b = montag(Math.max(tagAus(s.bis), tagAus(s.von))), n = Math.round((b - a) / 7) + 1;
  const basis = clamp(s.last0 * 1.1, 150, 700), out: Woche[] = [];
  let stufe = 0;
  for (let i = 0; i < n; i++) {
    const art = i === n - 1 && n > 1 ? 'ziel' : i % 4 === 3 ? 'ruhe' : 'aufbau';
    const voll = basis * Math.min(1.6, Math.pow(1.06, stufe));
    out.push({ nr: i + 1, mo: a + 7 * i, soll: Math.round(voll * (art === 'ziel' ? .5 : art === 'ruhe' ? .6 : 1)), art });
    if (art === 'aufbau') stufe++;
  }
  return out;
}
const anteilVon = (f: FahrtKurz) => f.zeit > 0 ? Math.sqrt((f.tss || 0) * 36 / f.zeit) : 0;

/* mitTest: der Plan darf einen FTP-Test hinlegen (ruhige Woche, kurz vor dem Ziel) */
export function tagesplan(s: Saison, fahrten: FahrtKurz[], heute: number, ftp: number, mitTest = false): Tagesplan {
  const W = wochen(s), w = W.find(x => x.mo === montag(heute)) || (heute < W[0].mo ? W[0] : W[W.length - 1]);
  const vorbei = heute > tagAus(s.bis), mo = montag(heute), wt = wochentag(heute);
  const ist = wocheIst(fahrten, mo, heute), F = form(fahrten, heute);
  const am = (t: number) => fahrten.filter(f => tagNr(f.start) === t);
  /* Fahrtage pro Woche: wie zuletzt gewohnt, zwischen drei und fünf */
  let tage = 0; for (let k = 1; k <= 6; k++) tage += wocheIst(fahrten, mo - 7 * k).tage;
  const fahrtenSoll = clamp(Math.round(tage / 6) || 3, 3, 5);
  const rest = w.soll - ist.punkte, uebrig = 7 - wt, offen = Math.max(0, fahrtenSoll - ist.tage);
  const erledigt = am(heute).length > 0;
  const hart = (t: number) => am(t).some(f => anteilVon(f) >= .8);
  let art: Tagesart, punkte = 0;
  if (erledigt || !offen || rest < 15 || F.form < -30) art = 'frei';
  else if (offen < uebrig && am(heute - 1).length && am(heute - 2).length) art = 'frei';   // nach zwei Tagen ein Ruhetag, wenn die Woche es hergibt
  else {
    punkte = clamp(rest / Math.min(offen, uebrig), 30, 140);   // mehr Fahrten als Tage gehen nicht mehr: die übrigen werden länger
    const letzterTest = Math.max(-1e9, ...fahrten.filter(f => f.ftpTest).map(f => tagNr(f.start)));
    const zuegig = fahrten.filter(f => { const t = tagNr(f.start); return t >= mo && t <= heute && anteilVon(f) >= .8; }).length;
    if (mitTest && s.art === 'ftp' && w.art !== 'aufbau' && heute - letzterTest > 21 && F.form > -15 && (w.art === 'ruhe' ? wt >= 4 : tagAus(s.bis) - heute <= 3)) art = 'test';
    else if (F.form < -18 || hart(heute - 1)) art = 'locker';
    else if (zuegig < (s.art === 'ftp' ? 2 : 1) && w.art !== 'ziel') art = 'zuegig';
    else if ((wt >= 5 || offen === 1) && w.art === 'aufbau') { art = 'lang'; punkte = Math.min(Math.max(rest, 30), punkte * 1.5); }
    else art = 'grundlage';
  }
  const A = ART[art], lang = s.art === 'tour' && art === 'lang' ? 240 : A.min[1];
  const minuten = art === 'frei' ? 30 : Math.round(clamp(punkte / (A.anteil * A.anteil * 100) * 60, A.min[0], lang) / 5) * 5;
  return { woche: w, wochen: W.length, soll: w.soll, ist: Math.round(ist.punkte), fahrtenSoll, fahrtenIst: ist.tage, art, erledigt, anteil: A.anteil, watt: w5(ftp * A.anteil), minuten, vorbei };
}
/* Wie weit das Ziel ist (0 bis 1): FTP zwischen Start und Ziel, bei der Tour die längste Fahrt seit Beginn */
export function fortschritt(s: Saison, fahrten: FahrtKurz[], ftp: number): { anteil: number; jetzt: number } {
  if (s.art === 'ftp') return { anteil: s.ziel > s.ftp0 ? clamp((ftp - s.ftp0) / (s.ziel - s.ftp0), 0, 1) : 1, jetzt: ftp };
  let km = 0; for (const f of fahrten) if (tagNr(f.start) >= tagAus(s.von) && f.km > km) km = f.km;
  return { anteil: clamp(km / Math.max(s.ziel, 1), 0, 1), jetzt: Math.round(km) };
}

/* ---------- Die Runde zum Tag ---------- */
export interface Kandidat { id: string; min: number; zuletzt: string | null }
/* Unter den eigenen Runden, die bis auf ein Fünftel zur Dauer passen: die am längsten nicht gefahrene */
export function passende(minuten: number, runden: Kandidat[]): string | null {
  const ok = runden.filter(r => Math.abs(r.min - minuten) <= minuten * .2);
  ok.sort((a, b) => (a.zuletzt || '').localeCompare(b.zuletzt || '') || Math.abs(a.min - minuten) - Math.abs(b.min - minuten));
  return ok.length ? ok[0].id : null;
}
/* Teilrunde: eine lange Strecke in gleich lange Stücke (nach Fahrzeit) teilen, eines davon ist die Runde für heute.
   Jedes Stück ist eine eigene Strecke mit fester Kennung, damit es seinen eigenen Rivalen und seine Segmente bekommt. */
export function teilrunde(st: Strecke, minuten: number, P: number, m: number, tag: number): Strecke | null {
  const rt = bahn(st), ganz = fahrzeit(rt, 0, rt.dist, P, m) / 60, k = clamp(Math.round(ganz / minuten), 2, 8);
  if (ganz < minuten * 1.4) return null;
  const ziel = ganz * 60 / k, grenzen = [0]; let t = 0;
  for (let i = 0; i < rt.ele.length - 1 && grenzen.length < k; i++) { t += fahrzeit(rt, i * rt.step, (i + 1) * rt.step, P, m); if (t >= ziel * grenzen.length) grenzen.push(i + 1); }
  grenzen.push(rt.ele.length - 1);
  const i = ((tag % k) + k) % k, a = grenzen[i], b = grenzen[i + 1], n = st.ele.length - 1;
  if (b - a < 40) return null;
  const ele = st.ele.slice(a, b + 1), la = Math.floor(a / n * (st.line.length - 1)), lb = Math.max(la + 1, Math.ceil(b / n * (st.line.length - 1)));
  let gain = 0; for (let j = 1; j < ele.length; j++) if (ele[j] > ele[j - 1]) gain += ele[j] - ele[j - 1];
  return { id: `t${k}x${i + 1}-${st.id}`, name: `${st.name} ${i + 1}/${k}`, dist: (ele.length - 1) * st.step, step: st.step, gain: Math.round(gain), ele, line: st.line.slice(la, lb + 1), teil: { aus: st.id, von: a * st.step, bis: b * st.step }, plan: true };
}
/* Erzeugte Runde in passender Länge: hügelig für zügige Tage, sonst flach */
export function erzeugteRunde(art: Tagesart, minuten: number, P: number, m: number, tag: number): Strecke {
  const typ = art === 'zuegig' ? 'huegel' : 'flach', seed = 100 + ((tag % 900) + 900) % 900;
  let km = Math.max(8, Math.round(minuten * .5));
  for (let k = 0; k < 2; k++) { const rt = bahn(erzeuge(typ, seed, km)); km = Math.max(8, Math.round(km * minuten * 60 / fahrzeit(rt, 0, rt.dist, P, m))); }
  return { ...erzeuge(typ, seed, km), plan: true };
}
