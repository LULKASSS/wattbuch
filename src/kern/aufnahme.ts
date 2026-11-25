/* Aufnahme: ein Wert pro Sekunde, mit Auto-Pause.
   Auto-Pause: 4 s unter 5 W → Pause, die stehenden Sekunden fallen wieder raus (Schnitt und Zeit leiden nicht).
   2 s mit mindestens 30 W → weiter, aber nur wenn automatisch pausiert wurde. */
export interface Sekunde { p: number; hr: number; cad: number; spd: number; dist: number; alt: number | null }
export type AufnahmeFolge = null | { was: 'pause'; kuerze: number } | { was: 'weiter' };

export class Aufnahme {
  p: number[] = []; hr: number[] = []; cad: number[] = []; spd: number[] = []; dist: number[] = []; alt: (number | null)[] = [];
  pause = false; auto = false;
  private go = 0;
  get n() { return this.p.length; }

  /* Eine Sekunde anhängen (nur wenn nicht pausiert). Meldet, wenn dabei automatisch pausiert wurde. */
  sekunde(x: Sekunde): AufnahmeFolge {
    if (this.pause) return null;
    this.p.push(x.p); this.hr.push(x.hr); this.cad.push(x.cad); this.spd.push(x.spd); this.dist.push(x.dist); this.alt.push(x.alt);
    const n = this.n; let z = 0;
    while (z < n && z < 10 && this.p[n - 1 - z] < 5) z++;
    if (z < 4 || n - z < 10) return null;
    this.kuerze(n - z);
    this.pause = true; this.auto = true; this.go = 0;
    return { was: 'pause', kuerze: n - z };
  }
  /* Während einer automatischen Pause einmal pro Sekunde mit der aktuellen Leistung aufrufen */
  warte(pow: number | null): AufnahmeFolge {
    if (!this.pause || !this.auto) return null;
    this.go = pow != null && pow >= 30 ? this.go + 1 : 0;
    if (this.go < 2) return null;
    this.pause = false; this.auto = false;
    return { was: 'weiter' };
  }
  vonHand(an: boolean) { this.pause = an; this.auto = false; }
  kuerze(n: number) { for (const k of [this.p, this.hr, this.cad, this.spd, this.dist, this.alt]) k.length = Math.min(k.length, n); }
}
export const schnitt = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
