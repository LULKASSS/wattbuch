/* Simulierter Fahrer für Entwicklung und Tests (kommt nie in die gebaute App, wie fake-ble.js).
 * Tritt, sobald Countdown oder Fahrt laufen, ungefähr die Zielleistung; in der Lobby steht er.
 * window.__simFahrer.aus = true schaltet ihn ab, dann gelten die Werte aus __fakeBle.set(). */
(() => {
  const S = window.__simFahrer = { aus: false, faktor: 1 };
  let hr = 96, t = 0;
  if (window.__fakeBle) window.__fakeBle.set({ power: 0, cad: 0, hr: 78 });
  setInterval(() => {
    const wb = window.__wb, f = window.__fakeBle;
    if (S.aus || !wb || !f) return;
    const z = wb.z, an = z.phase === 'count' || z.phase === 'ride';
    t += 0.25;
    const pow = an ? Math.max(0, Math.round(z.ziel * S.faktor + Math.sin(t * 2.1) * 6 + Math.sin(t * 5.3) * 4)) : 0;
    hr += ((an ? 96 + pow * 0.27 : 78) - hr) * 0.02;
    f.set({ power: pow, cad: an ? Math.round(Math.min(104, Math.max(60, 70 + pow * 0.09))) : 0, hr: Math.round(hr) });
  }, 250);
})();
