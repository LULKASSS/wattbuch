/* Detailstufen, die von selbst greifen: Dauert ein Bild über längere Zeit zu lang, geht es eine Stufe runter
   (weniger Auflösung, kürzere Sicht, weniger Bäume). Läuft es lange locker, geht es wieder eine hoch. */
export interface Stufe { pixel: number; K: number; sicht: number; baeume: number }
export const STUFEN: Stufe[] = [
  { pixel: 2, K: 2.6, sicht: 2600, baeume: 800 },
  { pixel: 1.5, K: 2.3, sicht: 2200, baeume: 650 },
  { pixel: 1.25, K: 2.0, sicht: 1800, baeume: 450 },
  { pixel: 1, K: 1.7, sicht: 1400, baeume: 280 }
];
export class Guete {
  stufe = 0; private ms = 16; private lahm = 0; private flott = 0; private ruhe = 0;
  /* dt = echte Bildzeit in Sekunden; gibt true zurück, wenn sich die Stufe geändert hat */
  bild(dt: number): boolean {
    if (dt > .25) return false;   // Fenster war verdeckt oder Seite hing kurz: zählt nicht
    this.ms += (dt * 1000 - this.ms) * .05; this.ruhe = Math.max(0, this.ruhe - dt);
    this.lahm = this.ms > 22 ? this.lahm + dt : 0; this.flott = this.ms < 12 ? this.flott + dt : 0;
    if (this.lahm > 4 && this.stufe < STUFEN.length - 1) { this.stufe++; this.lahm = 0; this.ruhe = 60; return true; }
    if (this.flott > 30 && this.ruhe === 0 && this.stufe > 0) { this.stufe--; this.flott = 0; this.ruhe = 60; return true; }
    return false;
  }
  get jetzt() { return STUFEN[this.stufe]; }
  get bildzeit() { return this.ms; }
}
