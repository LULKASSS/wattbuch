import type { Strecke, FahrtKurz, Werte, Zustand, Ereignis, Befehl, Fahrt } from './kern/typen';
import type { Saison } from './kern/saison';
type Ab = () => void;
export interface KontoStand { an: boolean; email: string | null; busy: boolean; err: string; last: string | null; wartet: number }
export interface StravaStand { ok: boolean; error?: string; connected?: boolean; athlete?: { name: string } | null; eigen?: boolean }
export type Gemerkt = Partial<Record<'rolle' | 'puls' | 'kadenz', { id: string; name: string }>>;
declare global {
  interface Window {
    wattbuch: {
      strecken(): Promise<Strecke[]>; fahrten(): Promise<FahrtKurz[]>; werte(): Promise<Werte | null>; saison(): Promise<Saison | null>; saisonSetzen(s: Saison | null): Promise<Saison | null>;
      konto(): Promise<KontoStand>; anmelden(email: string, pw: string): Promise<KontoStand & { ok: boolean; error?: string }>; abmelden(): Promise<KontoStand>;
      aufKonto(cb: (k: KontoStand) => void): Ab; aufDaten(cb: () => void): Ab; werteSetzen(w: Partial<Werte>): Promise<Werte>;
      geraete(): Promise<Gemerkt>; geraetSuche(art: string): void; geraetWahl(id: string): void; geraetAbbruch(): void; geraetVergessen(art: string): Promise<Gemerkt>;
      aufGeraete(cb: (g: { art: string; liste: { id: string; name: string }[] | null }) => void): Ab;
      strava(): Promise<StravaStand>; stravaVerbinden(): Promise<StravaStand>; stravaTrennen(): Promise<StravaStand>; stravaAbbrechen(id: string): Promise<boolean>;
      aufStrava(cb: (x: { id: string; state: string | null; url?: string }) => void): Ab;
      laeufe(id: string, rev: boolean): Promise<{ id: string; start: string; dist: number[] }[]>; alsStrecke(id: string): Promise<{ ok: boolean; error?: string; strecke?: string }>; streckeWeg(id: string): Promise<boolean>; fahrtLoeschen(id: string): Promise<boolean>;
      befehl(b: Befehl): void; aufZustand(cb: (z: Zustand) => void): Ab; aufEreignis(cb: (e: Ereignis) => void): Ab; aufVollbild(cb: (v: boolean) => void): Ab; bereit(): void;
      zustand(z: Zustand): void; ereignis(e: Ereignis): void; aufBefehl(cb: (b: Befehl) => void): Ab;
      streckeSpeichern(s: Strecke): Promise<void>; rivale(id: string, rev: boolean): Promise<{ id: string; start: string; dist: number[] } | null>;
      fahrtStart(kopf: unknown): void; sekunde(z: unknown): void; fahrtFertig(r: Fahrt): Promise<{ id: string; strava: string | null }>; fahrtWeg(): void;
      laufend(): Promise<{ kopf: any; sek: (number | null)[][] } | null>; suche(art: string): void;
    };
    __verbinden?: (arten: string[]) => void; __wb?: any;
  }
  interface Navigator { bluetooth: any }
}
export {};
