/* Coach: sagt in jeder Sekunde, welche Leistung jetzt passt (Rechnung aus der alten App übernommen).
   Im Flachen eine Grundleistung, die mit der Steigung voraus mitgeht (+5 % je Prozent, höchstens +15 % / −25 %).
   Anstiege sind vorab erkannt: Am Berg gibt es mehr, kurze vertragen viel (+25 %), lange wenig (+8 %); über der FTP
   nur so viel, wie die Reserve bis hinter die Kuppe hergibt. Am Anfang wird eingerollt. */
import { clamp, tempoBei } from './physik';
import { anstiege, gradeAt, type Anstieg, type Bahn } from './strecke';
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

/* FTP-Test als Rampe: jede Minute 20 W mehr, Start bei der halben FTP (mindestens 100 W). Schluss, wenn die Leistung
   8 s unter 80 % der Stufe bleibt oder die Kadenz unter 50 fällt (frühestens nach 90 s). FTP = 75 % der besten Minute. */
export const RAMPE = { stufe: 20, sek: 60 };
export class Rampe {
  readonly start: number; schwach = 0; fertig = false;
  constructor(ftp: number) { this.start = Math.max(100, Math.round(ftp * .5 / 10) * 10); }
  stufe(t: number) { return Math.floor(t / RAMPE.sek); }
  ziel(t: number) { return this.start + this.stufe(t) * RAMPE.stufe; }
  /* einmal pro Sekunde: true, wenn es nicht mehr geht */
  sekunde(t: number, watt: number | null, kadenz: number | null): boolean {
    const weich = t > 90 && ((watt != null && watt < this.ziel(t) * .8) || (kadenz != null && kadenz > 0 && kadenz < 50) || watt == null);
    this.schwach = weich ? this.schwach + 1 : 0;
    if (this.schwach >= 8) this.fertig = true;
    return this.fertig;
  }
  static ergebnis(p: number[]): { ftp: number; best: number } | null {
    if (p.length < 120) return null;
    let s = 0, best = 0;
    for (let i = 0; i < p.length; i++) { s += p[i]; if (i >= 60) s -= p[i - 60]; if (i >= 59 && s > best) best = s; }
    return best ? { best: Math.round(best / 60), ftp: Math.round(best / 60 * .75) } : null;
  }
}

export interface CoachAnsage { kopf: string; text: string }
export class Coach {
  readonly climbs: (Anstieg & { w: number; t: number })[];
  readonly warm: number;            // Sekunden zum Einrollen
  private wbal: number; private gesagt = new Set<string>();
  /* basis und oben in Watt: Grundleistung und was am Berg höchstens verlangt wird. wStrich: Reserve über der FTP in
     Joule (aus dem besten 5-min-Wert, sonst 18 kJ). */
  constructor(readonly rt: Bahn, readonly ftp: number, readonly m: number, public basis: number, public oben: number, readonly wStrich = 18000) {
    this.wbal = wStrich;
    /* Einrollen: fünf Minuten, bei kurzen Runden höchstens ein Sechstel der Fahrzeit */
    this.warm = Math.min(300, this.zeit(0, rt.dist, basis) / 6);
    this.climbs = anstiege(rt).map(c => { const w = this.amBerg(c.s, c); return { ...c, w, t: this.zeit(c.s, c.top, w) }; });
  }
  zeit(d0: number, d1: number, P: number): number { let t = 0; for (let x = d0; x < d1; x += this.rt.step) { const s = Math.min(this.rt.step, d1 - x); t += s / tempoBei(P, gradeAt(this.rt, x + s / 2), this.m); } return t; }
  get reserve() { return this.wbal / this.wStrich; }
  /* jede gefahrene Sekunde: Reserve leeren (über der FTP) oder füllen (Skiba 2015) */
  sekunde(p: number) {
    if (p > this.ftp) this.wbal = Math.max(0, this.wbal - (p - this.ftp));
    else this.wbal += (this.wStrich - this.wbal) * (1 - Math.exp(-1 / (546 * Math.exp(-.01 * (this.ftp - p)) + 316)));
  }
  private amBerg(d: number, c: Anstieg): number {
    const base = this.basis; let w = base * 1.1, t = this.zeit(d, c.over, w);
    for (let k = 0; k < 3; k++) {
      const up = t <= 120 ? .25 : t <= 300 ? .18 : t <= 900 ? .12 : .08, last = t <= 40;
      w = Math.min(base * (1 + up), this.oben * (last ? 1.1 : 1));
      if (w > this.ftp) w = Math.max(this.ftp, Math.min(w, this.ftp + (last ? .9 : .75) * this.wbal / Math.max(t, 15)));
      t = this.zeit(d, c.over, w);
    }
    return w5(Math.max(w, base));
  }
  private einrollen(el: number) { const a = Math.min(this.ftp * .5, this.basis); return w5(a + (this.basis - a) * clamp(el / Math.max(this.warm, 1), 0, 1)); }
  /* Zielleistung an der Stelle d nach el gefahrenen Sekunden */
  ziel(d: number, el: number): number {
    const warm = el < this.warm, ww = this.einrollen(el), c = this.climbs.find(x => d < x.over);
    if (c && d >= c.s) { const cw = this.amBerg(d, c); return warm ? Math.min(cw, w5(ww * 1.25)) : cw; }
    if (warm) return ww;
    const g = (gradeAt(this.rt, d + 40) + gradeAt(this.rt, d + 100)) / 2;
    return w5(clamp(this.basis * (1 + clamp(.05 * g, -.25, .15)), this.ftp * .45, Math.max(this.oben, this.basis)));
  }
  /* Was der Coach an dieser Stelle zu sagen hat (jede Ansage nur einmal) */
  ansage(d: number, el: number): CoachAnsage | null {
    const einmal = (k: string, a: CoachAnsage) => this.gesagt.has(k) ? null : (this.gesagt.add(k), a);
    const min = (t: number) => t < 90 ? `${Math.round(t)} s` : `${Math.round(t / 60)} min`;
    if (el >= 2 && this.warm >= 60 && el < this.warm) { const a = einmal('w', { kopf: 'Coach', text: `Erst einrollen · ${min(this.warm)}` }); if (a) return a; }
    const c = this.climbs.find(x => d < x.over);
    if (c && d >= c.s && d < c.top && c.t >= 40) {
      const w = this.ziel(d, el), tOver = this.zeit(d, c.over, w);
      if (tOver <= 45) return einmal(c.s + 'k', { kopf: 'Coach', text: `Noch ${Math.round(tOver / 5) * 5} s drücken` });
      return einmal(c.s + 's', { kopf: 'Coach', text: `Jetzt ${w} W · ${min(c.t)} bis oben` });
    }
    const vor = this.climbs.filter(x => x.over <= d).pop();
    if (vor && vor.t >= 40 && d - vor.over < 400 && gradeAt(this.rt, d) <= -2.5) return einmal(vor.s + 'r', { kopf: 'Coach', text: 'Jetzt erholen' });
    return null;
  }
}
