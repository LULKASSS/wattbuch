import type { Strecke, FahrtKurz, Werte, Zustand, Ereignis, Befehl, Fahrt } from './kern/typen';
type Ab = () => void;
declare global {
  interface Window {
    wattbuch: {
      strecken(): Promise<Strecke[]>; fahrten(): Promise<FahrtKurz[]>; werte(): Promise<Werte | null>;
      befehl(b: Befehl): void; aufZustand(cb: (z: Zustand) => void): Ab; aufEreignis(cb: (e: Ereignis) => void): Ab; aufVollbild(cb: (v: boolean) => void): Ab; bereit(): void;
      zustand(z: Zustand): void; ereignis(e: Ereignis): void; aufBefehl(cb: (b: Befehl) => void): Ab;
      streckeSpeichern(s: Strecke): Promise<void>; rivale(id: string, rev: boolean): Promise<{ id: string; start: string; dist: number[] } | null>;
      fahrtStart(kopf: unknown): void; sekunde(z: unknown): void; fahrtFertig(r: Fahrt): Promise<string>; fahrtWeg(): void;
      laufend(): Promise<{ kopf: any; sek: (number | null)[][] } | null>; suche(art: string): void;
    };
    __verbinden?: () => void; __wb?: any;
  }
  interface Navigator { bluetooth: any }
}
export {};
