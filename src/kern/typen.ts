/* Gemeinsame Datenformen. Fahrten bleiben im Format der alten App (ein Wert pro Sekunde), damit beide
   Apps dieselben Zeilen im Konto lesen können; neue Felder (routeId, rev, ganz, app) sind Zusätze. */
export interface Strecke {
  id: string; name: string;
  dist: number;            // Länge in m
  step: number;            // Abstand der Höhenpunkte in m (25)
  gain: number;            // Höhenmeter
  ele: number[];           // Höhe alle step Meter
  line: [number, number][]; // Breite, Länge (ausgedünnt)
  gen?: string; fav?: { n: number };
  teil?: { aus: string; von: number; bis: number };   // Teilrunde: Abschnitt einer langen Strecke
  plan?: boolean;          // für einen Tag der Saison angelegt und noch nie gefahren
  test?: boolean;          // flache Bahn für den FTP-Test, keine Runde der Lobby
}
export interface Fahrt {
  id: string; start: string; name: string;
  p: number[]; hr: number[] | null; cad: number[] | null; spd: number[] | null; dist: number[] | null; alt: (number | null)[] | null;
  route: string | null; gain: number; trainer: boolean; ftp: number; weight: number;
  routeId?: string | null; rev?: boolean; ganz?: boolean; app?: 'neu';
  src?: string; noW?: boolean; dur?: number;
}
export interface FahrtKurz { id: string; start: string; name: string; routeId: string | null; rev: boolean; ganz: boolean; rolle: boolean; dauer: number; zeit: number; km: number; hm: number; avgW: number | null; stravaId: string | null; draussen: boolean; tss: number; b20: number | null; ftpTest: number | null }
export interface Werte { ftp: number; weight: number; bike: number; diff: number }
export const WERTE_START: Werte = { ftp: 200, weight: 75, bike: 9, diff: 0.5 };

export type Phase = 'lobby' | 'count' | 'ride' | 'done';
export type GeraetStand = 'aus' | 'sucht' | 'an';
export interface Ergebnis {
  zeit: number; ganz: boolean; km: number; hm: number; avgW: number;
  bestzeiten?: number;   // wie viele Segment-Bestzeiten in dieser Fahrt gefallen sind (ohne die Runde selbst)
  id?: string; strava?: string | null;   // nach dem Speichern: Kennung der Fahrt und ob sie zu Strava geht
  rivale: { start: string; dauer: number } | null;
  abstand: number | null;  // Sekunden zum Rivalen, negativ = schneller
}
/* Was der Maschinenraum zehnmal pro Sekunde an die Bühne schickt */
export interface Zustand {
  phase: Phase; pause: boolean; auto: boolean;
  geraete: { rolle: GeraetStand; puls: GeraetStand; kadenz: GeraetStand };
  w: number | null; hr: number | null; cad: number | null;
  v: number; s: number; t: number; grade: number; up: number;
  ziel: number; coach: boolean; basis: number; ftp: number;
  count: number;
  streckeId: string | null; rev: boolean;
  gs: number | null; gap: number | null; rivaleStart: string | null;
  ergebnis: Ergebnis | null;
}
export interface Ereignis { art: 'hinweis' | 'gross'; kopf?: string; text: string; ms?: number }
export type Befehl =
  | { was: 'start'; streckeId: string; rev: boolean; basis?: number }
  | { was: 'abbruch' } | { was: 'pause'; an?: boolean } | { was: 'ende' } | { was: 'lobby' }
  | { was: 'coach' } | { was: 'stufe'; d: number }
  | { was: 'wahl'; streckeId: string; rev: boolean; basis?: number } | { was: 'werte' } | { was: 'strecke'; id: string; name: string; fav?: { n: number }; pts: number[][] } | { was: 'trenne'; art: 'rolle' | 'puls' | 'kadenz' };
