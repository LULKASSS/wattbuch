import type { Strecke, FahrtKurz, Werte, Zustand, Ereignis, Befehl, Fahrt } from './kern/typen';
type Ab = () => void;
export interface KontoStand { an: boolean; email: string | null; busy: boolean; err: string; last: string | null; wartet: number }
export type Gemerkt = Partial<Record<'rolle' | 'puls' | 'kadenz', { id: string; name: string }>>;
declare global {
  interface Window {
    wattbuch: {
      strecken(): Promise<Strecke[]>; fahrten(): Promise<FahrtKurz[]>; werte(): Promise<Werte | null>;
      konto(): Promise<KontoStand>; anmelden(email: string, pw: string): Promise<KontoStand & { ok: boolean; error?: string }>; abmelden(): Promise<KontoStand>;
      aufKonto(cb: (k: KontoStand) => void): Ab; aufDaten(cb: () => void): Ab; werteSetzen(w: Partial<Werte>): Promise<Werte>;
      geraete(): Promise<Gemerkt>; geraetSuche(art: string): void; geraetWahl(id: string): void; geraetAbbruch(): void; geraetVergessen(art: string): Promise<Gemerkt>;
      aufGeraete(cb: (g: { art: string; liste: { id: string; name: string }[] | null }) => void): Ab;
      befehl(b: Befehl): void; aufZustand(cb: (z: Zustand) => void): Ab; aufEreignis(cb: (e: Ereignis) => void): Ab; aufVollbild(cb: (v: boolean) => void): Ab; bereit(): void;
      zustand(z: Zustand): void; ereignis(e: Ereignis): void; aufBefehl(cb: (b: Befehl) => void): Ab;
      streckeSpeichern(s: Strecke): Promise<void>; rivale(id: string, rev: boolean): Promise<{ id: string; start: string; dist: number[] } | null>;
      fahrtStart(kopf: unknown): void; sekunde(z: unknown): void; fahrtFertig(r: Fahrt): Promise<string>; fahrtWeg(): void;
      laufend(): Promise<{ kopf: any; sek: (number | null)[][] } | null>; suche(art: string): void;
    };
    __verbinden?: (arten: string[]) => void; __wb?: any;
  }
  interface Navigator { bluetooth: any }
}
export {};
