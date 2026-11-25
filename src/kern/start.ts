/* Start beim ersten Tritt. Schwelle gegen Fehlstarts (Rolle rollt nach, kurz aufgestiegen):
   3 s am Stück mindestens 40 W, mit bekannter Trittfrequenz zusätzlich mindestens 40 U/min.
   Nach einer Runde muss die Leistung erst 10 s unter 5 W liegen, damit Ausrollen keine neue Runde startet.
   Im Countdown (nur wenn der Tritt ihn ausgelöst hat): 1 s unter 10 W bricht ab. */
export class TrittStart {
  private an = 0; private ruhe = 0; scharf = true;
  /* Nach einer Runde: erst wieder scharf, wenn Ruhe war */
  entschaerfen() { this.scharf = false; this.ruhe = 0; this.an = 0; }
  /* dt in Sekunden; gibt true zurück, wenn der Countdown starten soll */
  tritt(pow: number | null, cad: number | null, dt: number): boolean {
    const p = pow || 0;
    if (!this.scharf) { this.ruhe = p < 5 ? this.ruhe + dt : 0; if (this.ruhe >= 10) this.scharf = true; return false; }
    const ok = p >= 40 && (cad == null || cad >= 40);
    this.an = ok ? this.an + dt : 0;
    if (this.an >= 3) { this.an = 0; return true; }
    return false;
  }
}
export class CountAbbruch {
  private still = 0;
  pruefe(pow: number | null, dt: number): boolean { this.still = (pow || 0) < 10 ? this.still + dt : 0; return this.still >= 1; }
}
