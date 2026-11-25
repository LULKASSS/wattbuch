/* Rivale: ein früherer Versuch auf derselben Strecke. Aus seinen Metern pro Sekunde (dist) lässt sich ablesen,
   wo er zu einer Zeit war und wann er an einer Stelle war. */
export class Rivale {
  constructor(readonly start: string, readonly dist: number[]) {}
  get dauer() { return this.dist.length; }
  /* Strecke in m nach t Sekunden */
  ort(t: number): number {
    const d = this.dist, n = d.length;
    if (t <= 0 || !n) return 0;
    if (t >= n) return d[n - 1];
    const i = Math.floor(t), a = i ? d[i - 1] : 0;
    return a + (d[i] - a) * (t - i);
  }
  /* Zeit in s, zu der er bei s Metern war (danach: seine Endzeit) */
  wann(s: number): number {
    const d = this.dist, n = d.length;
    if (!n || s <= 0) return 0;
    if (s >= d[n - 1]) return n;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (d[m] < s) lo = m + 1; else hi = m; }
    const a = lo ? d[lo - 1] : 0;
    return lo + (d[lo] > a ? (s - a) / (d[lo] - a) : 0);
  }
}
