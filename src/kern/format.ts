export const fmt = (n: number, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
/* 57:48 oder 1:11:20 */
export function zeit(t: number): string {
  t = Math.max(0, Math.round(t));
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
export const tag = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
