/* Form und Fortschritt aus den Fahrten: Belastung je Tag (Punkte, eine Stunde an der FTP = 100), daraus Fitness
   (träge, 42 Tage) und Ermüdung (schnell, 7 Tage). Form = Fitness − Ermüdung. Dazu Serien und Meilensteine.
   Gespeichert wird davon nichts, es lässt sich aus den Fahrten jederzeit neu ausrechnen. */
import type { FahrtKurz } from './typen';

/* Tage und Wochen in Ortszeit: Tag = Nummer des Kalendertags, Woche beginnt am Montag */
export const tagNr = (d: Date | string) => { const x = new Date(d); return Math.round(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 864e5); };
export const tagAus = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
export const isoTag = (tag: number) => new Date(tag * 864e5).toISOString().slice(0, 10);
export const wocheNr = (tag: number) => Math.floor((tag + 3) / 7);
export const wochentag = (tag: number) => ((tag + 3) % 7 + 7) % 7;   // 0 = Montag
export const montag = (tag: number) => tag - wochentag(tag);

export interface Form { fitness: number; ermuedung: number; form: number; verlauf: number[] }
/* verlauf: Fitness der letzten `tage` Tage bis heute */
export function form(fahrten: FahrtKurz[], heute: number, tage = 84): Form {
  const je = new Map<number, number>(); let erster = heute;
  for (const f of fahrten) { const t = tagNr(f.start); if (t > heute) continue; je.set(t, (je.get(t) || 0) + (f.tss || 0)); erster = Math.min(erster, t); }
  let c = 0, a = 0; const verlauf: number[] = [];
  for (let t = Math.max(erster, heute - 400); t <= heute; t++) {
    const x = je.get(t) || 0; c += (x - c) / 42; a += (x - a) / 7;
    if (t > heute - tage) verlauf.push(c);
  }
  while (verlauf.length < tage) verlauf.unshift(0);
  return { fitness: c, ermuedung: a, form: c - a, verlauf };
}
export const formWort = (f: number) => f > 5 ? 'frisch' : f >= -10 ? 'ausgeglichen' : f >= -25 ? 'im Aufbau' : 'müde';

/* Punkte und Fahrtage einer Woche (Montag bis Sonntag), höchstens bis `bis` */
export function wocheIst(fahrten: FahrtKurz[], mo: number, bis = mo + 6) {
  let punkte = 0, km = 0; const tage = new Set<number>();
  for (const f of fahrten) { const t = tagNr(f.start); if (t < mo || t > Math.min(bis, mo + 6)) continue; punkte += f.tss || 0; km += f.km || 0; tage.add(t); }
  return { punkte, km, tage: tage.size };
}
/* Wochen in Folge mit mindestens zwei Fahrtagen; die laufende Woche zählt mit, sobald sie so weit ist */
export function serie(fahrten: FahrtKurz[], heute: number): number {
  const je = new Map<number, Set<number>>();
  for (const f of fahrten) { const t = tagNr(f.start), w = wocheNr(t); if (!je.has(w)) je.set(w, new Set()); je.get(w)!.add(t); }
  const voll = (w: number) => (je.get(w)?.size || 0) >= 2;
  let w = wocheNr(heute), n = 0;
  if (!voll(w)) w--;
  while (voll(w)) { n++; w--; }
  return n;
}
export interface Meilenstein { start: string; text: string }
/* Was unterwegs geschafft wurde, neueste zuerst: längste Fahrt, beste 20 Minuten, FTP-Tests, runde Zahlen */
export function meilensteine(fahrten: FahrtKurz[], hoechstens = 6): Meilenstein[] {
  const out: Meilenstein[] = []; let km = 0, b20 = 0, n = 0;
  const de = (x: number, d = 0) => x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  for (const f of fahrten.slice().sort((a, b) => a.start.localeCompare(b.start))) {
    n++;
    if (f.ftpTest) out.push({ start: f.start, text: `FTP-Test: ${de(f.ftpTest)} W` });
    if (f.km >= 20 && f.km > km * 1.05) { if (km) out.push({ start: f.start, text: `Längste Fahrt: ${de(f.km)} km` }); km = f.km; }
    if (f.b20 && f.b20 > b20 * 1.02) { if (b20) out.push({ start: f.start, text: `Beste 20 Minuten: ${de(f.b20)} W` }); b20 = f.b20; }
    if (n % 50 === 0) out.push({ start: f.start, text: `${n}. Fahrt` });
  }
  return out.reverse().slice(0, hoechstens);
}
/* Wofür die besten 20 Minuten der letzten sechs Wochen sprechen (95 %), wenn das über der eingetragenen FTP liegt.
   `seit`: nur Fahrten nach diesem Zeitpunkt (seit die FTP zuletzt gesetzt wurde), damit eine von Hand gesenkte FTP
   nicht gleich wieder von einer alten Fahrt angehoben wird. Die App übernimmt den Wert von selbst. */
export function ftpHinweis(fahrten: FahrtKurz[], heute: number, ftp: number, seit?: string | null): number | null {
  let b = 0; for (const f of fahrten) if (f.b20 && tagNr(f.start) > heute - 42 && f.b20 > b && (!seit || f.start > seit)) b = f.b20;
  const w = Math.round(b * .95);
  return w >= ftp + 3 ? w : null;
}
