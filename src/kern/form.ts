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

/* Entwicklung der FTP: jede Änderung, abgelesen an der FTP, die bei den Fahrten galt, am Ende der heutige Wert */
export interface FtpPunkt { start: string; ftp: number }
export function ftpVerlauf(fahrten: FahrtKurz[], ftpJetzt: number, jetzt = new Date().toISOString()): FtpPunkt[] {
  const out: FtpPunkt[] = [];
  for (const f of fahrten.slice().sort((a, b) => a.start.localeCompare(b.start))) if (f.ftp && (!out.length || out[out.length - 1].ftp !== f.ftp)) out.push({ start: f.start, ftp: f.ftp });
  if (!out.length || out[out.length - 1].ftp !== ftpJetzt) out.push({ start: jetzt, ftp: ftpJetzt });
  return out;
}
/* Fahrten nach Woche, Monat oder Jahr zusammengezählt: die letzten `n` Zeiträume bis heute, der älteste zuerst.
   von/bis sind Tage (einschließlich), damit sich die Fahrten eines Zeitraums heraussuchen lassen. */
export type ZeitArt = 'woche' | 'monat' | 'jahr';
export interface Zeitraum { name: string; kurz: string; von: number; bis: number; km: number; sek: number; hm: number; n: number }
export function zeitraeume(fahrten: FahrtKurz[], art: ZeitArt, heute: number, n: number): Zeitraum[] {
  const out: Zeitraum[] = [], d0 = new Date(heute * 864e5), J = d0.getUTCFullYear(), M = d0.getUTCMonth(), tag = (j: number, m: number, t: number) => Math.round(Date.UTC(j, m, t) / 864e5);
  const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const kurzTag = (t: number) => { const d = new Date(t * 864e5); return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`; };
  for (let i = n - 1; i >= 0; i--) {
    let von: number, bis: number, name: string, kurz: string;
    if (art === 'woche') { von = montag(heute) - 7 * i; bis = von + 6; name = `${kurzTag(von)} bis ${kurzTag(bis)}`; kurz = kurzTag(von); }
    else if (art === 'monat') { const m = M - i, j = J + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; von = tag(j, mm, 1); bis = tag(j, mm + 1, 0); name = `${MON[mm]} ${j}`; kurz = MON[mm].slice(0, 3); }
    else { von = tag(J - i, 0, 1); bis = tag(J - i, 11, 31); name = kurz = String(J - i); }
    out.push({ name, kurz, von, bis, km: 0, sek: 0, hm: 0, n: 0 });
  }
  for (const f of fahrten) { const t = tagNr(f.start), z = out.find(x => t >= x.von && t <= x.bis); if (z) { z.km += f.km || 0; z.sek += f.zeit || 0; z.hm += f.hm || 0; z.n++; } }
  return out;
}
/* Die wichtigsten Bestwerte, eine Zeile voll: längste Fahrt, schnellster Schnitt (ab 20 Minuten), beste 20 Minuten,
   meiste Höhenmeter, längste Zeit im Sattel */
export interface Bestwert { name: string; wert: number; art: 'km' | 'kmh' | 'watt' | 'hm' | 'zeit'; start: string }
export function bestwerte(fahrten: FahrtKurz[]): Bestwert[] {
  const out: Bestwert[] = [], beste = (name: string, art: Bestwert['art'], w: (f: FahrtKurz) => number) => { let b: FahrtKurz | null = null, x = 0; for (const f of fahrten) { const v = w(f); if (v > x) { x = v; b = f; } } if (b) out.push({ name, wert: x, art, start: b.start }); };
  beste('Längste Fahrt', 'km', f => f.km || 0);
  beste('Schnellster Schnitt', 'kmh', f => f.zeit >= 1200 && f.km >= 5 ? f.km / f.zeit * 3600 : 0);
  beste('Beste 20 Minuten', 'watt', f => f.b20 || 0);
  beste('Meiste Höhenmeter', 'hm', f => f.hm || 0);
  beste('Längste Zeit', 'zeit', f => f.zeit || 0);
  return out;
}
