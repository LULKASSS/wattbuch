/* Fahrphysik: Leistung gegen Rollwiderstand, Luft und Hangabtrieb (unverändert aus der alten App) */
export const PHYS = { g: 9.81, rho: 1.225, cda: 0.32, crr: 0.005 };
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/* Ein Zeitschritt: neues Tempo in m/s aus Leistung P (W), Steigung in Prozent, Masse m (Fahrer + Rad) */
export function schritt(v: number, P: number, grade: number, m: number, dt: number): number {
  /* unter 0,4 m/s wird die Antriebskraft begrenzt (sonst unendlich); klein genug, dass man auch an 20 % noch vorankommt */
  const th = Math.atan(grade / 100), drive = P / Math.max(v, 0.4);
  const res = m * PHYS.g * (PHYS.crr * Math.cos(th) + Math.sin(th)) + 0.5 * PHYS.rho * PHYS.cda * v * v;
  return clamp(v + (drive - res) / (m + 1.5) * dt, 0, 25);
}
/* Gleichgewichtstempo bei Leistung P und Steigung (ohne Beschleunigung) */
export function tempoBei(P: number, grade: number, m: number): number {
  const th = Math.atan(grade / 100), A = m * PHYS.g * (PHYS.crr * Math.cos(th) + Math.sin(th)), B = 0.5 * PHYS.rho * PHYS.cda;
  const f = (v: number) => v * (A + B * v * v);
  if (f(25) <= P) return 25;
  let lo = 0.3, hi = 25;
  for (let i = 0; i < 30; i++) { const v = (lo + hi) / 2; if (f(v) < P) lo = v; else hi = v; }
  return Math.max(lo, 1);
}
