/* Einfacher Coach für Schritt 1: Grundleistung, die mit der Steigung voraus mitgeht
   (+5 % je Prozent Steigung, höchstens +15 % / −25 %). Die volle Rechnung (Anstiege nach Dauer, Reserve) folgt. */
import { clamp } from './physik';
export const w5 = (w: number) => Math.round(w / 5) * 5;
/* Annahme: Grundleistung für eine zügige Runde = 70 % der FTP */
export const grundleistung = (ftp: number) => w5(ftp * 0.7);
export const zielEinfach = (basis: number, gradeVoraus: number) => w5(basis * (1 + clamp(gradeVoraus * 0.05, -0.25, 0.15)));
/* Liegt die Leistung im Ziel (±5 %), darunter oder darüber? */
export function lage(w: number, ziel: number): 'ok' | 'drunter' | 'drueber' {
  const d = (w - ziel) / Math.max(ziel, 1);
  return Math.abs(d) <= 0.05 ? 'ok' : d < 0 ? 'drunter' : 'drueber';
}
export function zone(w: number, ftp: number): string {
  const z = w / Math.max(ftp, 1);
  return z < 0.56 ? 'Erholung' : z < 0.76 ? 'Grundlage' : z < 0.91 ? 'Tempo' : z < 1.06 ? 'Schwelle' : 'Über Schwelle';
}
