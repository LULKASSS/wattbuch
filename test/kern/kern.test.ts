/* Prüft die Logik ohne App und ohne Grafik: Physik, Strecken, Coach, Aufnahme, Start, Rivale, Straßenkurve, Detailstufen */
import { describe, expect, it } from 'vitest';
import { schritt, tempoBei } from '../../src/kern/physik';
import { anstiege, ausPunkten, bahn, eleAt, fahrzeit, gradeAt } from '../../src/kern/strecke';
import { erzeuge } from '../../src/kern/erzeugen';
import { grundleistung, lage, zielEinfach, zone } from '../../src/kern/coach';
import { Aufnahme } from '../../src/kern/aufnahme';
import { CountAbbruch, TrittStart } from '../../src/kern/start';
import { Rivale } from '../../src/kern/rivale';
import { kurve, naehe, stelle } from '../../src/kern/kurve';
import { zeit } from '../../src/kern/format';
import { segmente, versuche, zeitAuf } from '../../src/kern/segmente';
import { Guete } from '../../src/buehne/welt/guete';

/* Erfundene Strecke: 6 km nach Osten mit einem Berg in der Mitte und einer Ecke, Höhen verrauscht */
function punkte(rauschen = 0) {
  const pts: number[][] = [];
  for (let i = 0; i <= 600; i++) {
    const d = i * 10, lat = 50 + (d > 3000 ? (d - 3000) / 111320 : 0), lon = 10 + Math.min(d, 3000) / (111320 * Math.cos(50 * Math.PI / 180));
    const berg = d > 1500 && d < 4500 ? 90 * Math.sin((d - 1500) / 3000 * Math.PI) : 0;
    pts.push([lat, lon, 200 + berg + (i % 2 ? rauschen : -rauschen)]);
  }
  return pts;
}

describe('Physik', () => {
  it('pendelt sich auf das Gleichgewichtstempo ein', () => {
    let v = 0; for (let i = 0; i < 4000; i++) v = schritt(v, 200, 0, 84, .25);
    expect(v).toBeCloseTo(tempoBei(200, 0, 84), 1);
    expect(v * 3.6).toBeGreaterThan(28); expect(v * 3.6).toBeLessThan(36);
  });
  it('bergauf langsamer, bergab schneller, ohne Leistung rollt es aus', () => {
    expect(tempoBei(200, 6, 84)).toBeLessThan(tempoBei(200, 0, 84) / 2);
    expect(tempoBei(200, -4, 84)).toBeGreaterThan(tempoBei(200, 0, 84));
    let v = 8; for (let i = 0; i < 2000; i++) v = schritt(v, 0, 0, 84, .25);
    expect(v).toBe(0);
  });
  it('kommt auch an 20 % Steigung noch voran', () => {
    let v = 0; for (let i = 0; i < 400; i++) v = schritt(v, 160, 20, 84, .25);
    expect(v).toBeGreaterThan(.7); expect(v).toBeLessThan(1.3);
  });
});

describe('Strecke', () => {
  it('glättet verrauschte Höhen, damit die Steigung nicht zuckt', () => {
    const rt = bahn(ausPunkten('Test', punkte(3)));
    expect(rt.dist).toBeGreaterThan(5900); expect(rt.dist).toBeLessThan(6100);
    let sprung = 0; for (let d = 50; d < rt.dist - 50; d += 25) sprung = Math.max(sprung, Math.abs(gradeAt(rt, d + 25) - gradeAt(rt, d)));
    expect(sprung).toBeLessThan(3);
    expect(Math.abs(gradeAt(rt, 500))).toBeLessThan(2);
    expect(gradeAt(rt, 2200)).toBeGreaterThan(3);
  });
  it('findet den Anstieg und kennt die Gegenrichtung', () => {
    const st = ausPunkten('Test', punkte()), hin = bahn(st), her = bahn(st, true);
    const a = anstiege(hin); expect(a).toHaveLength(1);
    expect(a[0].gain).toBeGreaterThan(70); expect(a[0].top).toBeGreaterThan(2700); expect(a[0].top).toBeLessThan(3300);
    expect(eleAt(her, 0)).toBeCloseTo(eleAt(hin, hin.dist), 5);
    expect(fahrzeit(hin, 0, hin.dist, 200, 84)).toBeGreaterThan(fahrzeit(hin, 0, hin.dist, 300, 84));
  });
  it('erzeugte Runden sind fest je Zahl und haben sinnvolle Länge', () => {
    const a = erzeuge('huegel', 7), b = erzeuge('huegel', 7);
    expect(a.ele).toEqual(b.ele); expect(a.dist).toBeGreaterThan(20000); expect(a.dist).toBeLessThan(45000);
    expect(bahn(a).loop).toBe(true);
  });
});

describe('Coach', () => {
  it('Ziel geht mit der Steigung, begrenzt auf +15 % und −25 %', () => {
    const b = grundleistung(200); expect(b).toBe(140);
    expect(zielEinfach(b, 0)).toBe(140); expect(zielEinfach(b, 2)).toBe(155); expect(zielEinfach(b, 10)).toBe(160); expect(zielEinfach(b, -10)).toBe(105);
  });
  it('Farbe: im Ziel, darunter, darüber', () => {
    expect(lage(142, 140)).toBe('ok'); expect(lage(120, 140)).toBe('drunter'); expect(lage(160, 140)).toBe('drueber');
    expect(zone(130, 200)).toBe('Grundlage'); expect(zone(230, 200)).toBe('Über Schwelle');
  });
});

describe('Aufnahme', () => {
  const sek = (p: number, i: number) => ({ p, hr: 120, cad: p ? 85 : 0, spd: 30, dist: i * 8, alt: 100 });
  it('pausiert nach 4 s ohne Tritt, wirft die stehenden Sekunden weg und fährt beim Antreten weiter', () => {
    const R = new Aufnahme(); let i = 0;
    for (; i < 20; i++) expect(R.sekunde(sek(150, i))).toBeNull();
    for (let k = 0; k < 3; k++) expect(R.sekunde(sek(0, i++))).toBeNull();
    expect(R.sekunde(sek(0, i++))).toEqual({ was: 'pause', kuerze: 20 });
    expect(R.n).toBe(20); expect(R.pause && R.auto).toBe(true);
    expect(R.sekunde(sek(150, i))).toBeNull(); expect(R.n).toBe(20);
    expect(R.warte(20)).toBeNull(); expect(R.warte(120)).toBeNull(); expect(R.warte(130)).toEqual({ was: 'weiter' });
    expect(R.pause).toBe(false);
  });
  it('von Hand pausiert bleibt pausiert', () => {
    const R = new Aufnahme(); for (let i = 0; i < 12; i++) R.sekunde(sek(150, i));
    R.vonHand(true); expect(R.warte(200)).toBeNull(); expect(R.warte(200)).toBeNull(); expect(R.pause).toBe(true);
  });
});

describe('Start beim ersten Tritt', () => {
  it('löst erst nach 3 s echtem Treten aus, nicht beim Nachrollen', () => {
    const T = new TrittStart();
    for (let i = 0; i < 20; i++) expect(T.tritt(60, 20, .1)).toBe(false);   // Rolle dreht, aber kaum Kadenz
    for (let i = 0; i < 20; i++) expect(T.tritt(i % 10 === 9 ? 0 : 120, 80, .1)).toBe(false);   // immer wieder unterbrochen
    let los = false; for (let i = 0; i < 31 && !los; i++) los = T.tritt(120, 80, .1);
    expect(los).toBe(true);
  });
  it('nach einer Runde erst wieder nach 10 s Ruhe', () => {
    const T = new TrittStart(); T.entschaerfen();
    for (let i = 0; i < 100; i++) expect(T.tritt(150, 85, .1)).toBe(false);
    for (let i = 0; i < 101; i++) T.tritt(0, 0, .1);
    let los = false; for (let i = 0; i < 31 && !los; i++) los = T.tritt(150, 85, .1);
    expect(los).toBe(true);
  });
  it('Countdown bricht ab, wenn nicht mehr getreten wird', () => {
    const C = new CountAbbruch(); expect(C.pruefe(100, .6)).toBe(false); expect(C.pruefe(0, .6)).toBe(false); expect(C.pruefe(0, .6)).toBe(true);
  });
});

describe('Rivale', () => {
  it('Ort und Zeit passen zusammen', () => {
    const rv = new Rivale('2026-01-01T10:00:00Z', Array.from({ length: 100 }, (_, i) => (i + 1) * 8));
    expect(rv.ort(10)).toBeCloseTo(80); expect(rv.wann(80)).toBeCloseTo(10); expect(rv.wann(rv.ort(37.5))).toBeCloseTo(37.5);
    expect(rv.ort(500)).toBe(800); expect(rv.wann(9999)).toBe(100); expect(rv.dauer).toBe(100);
  });
});

describe('Straße der Welt', () => {
  const rt = bahn(ausPunkten('Test', punkte())), k = kurve(rt), nh = naehe(k);
  it('folgt der Strecke: gleichmäßige Punkte, echte Höhe, gerundete Ecke', () => {
    expect(k.n).toBe(Math.round(rt.dist / 5) + 1);
    let max = 0, min = Infinity; for (let i = 1; i < k.n; i++) { const d = Math.hypot(k.x[i] - k.x[i - 1], k.z[i] - k.z[i - 1]); max = Math.max(max, d); min = Math.min(min, d); }
    expect(max / min).toBeLessThan(1.05);
    const [i] = stelle(k, 3000); expect(k.y[i] - k.y[0]).toBeCloseTo(eleAt(rt, 3000) - eleAt(rt, 0), 0);
    /* erst nach Osten (+x), nach der Ecke nach Norden (−z) */
    expect(k.tx[10]).toBeGreaterThan(.99); expect(k.tz[k.n - 10]).toBeLessThan(-.99);
    let kr = 0; for (let j = 0; j < k.n; j++) kr = Math.max(kr, Math.abs(k.c[j]));
    expect(kr).toBeGreaterThan(.005); expect(kr).toBeLessThan(.1);   // Kurve, aber kein Knick
  });
  it('kennt den Abstand zur Straße und ihre Höhe dort', () => {
    const [i] = stelle(k, 1000), [d0, y0] = nh.nah(k.x[i], k.z[i]);
    expect(d0).toBeLessThan(.5); expect(y0).toBeCloseTo(k.y[i], 0);
    const [d1] = nh.nah(k.x[i] - k.tz[i] * 60, k.z[i] + k.tx[i] * 60); expect(d1).toBeGreaterThan(58); expect(d1).toBeLessThan(62);
    const [d2] = nh.fern(k.x[i], k.z[i] + 3000); expect(d2).toBeGreaterThan(2500);
  });
});

describe('Segmente', () => {
  const rt = bahn(ausPunkten('Test', punkte())), segs = segmente(rt);
  const lauf = (id: string, v: number, bis = rt.dist + 400) => ({ id, start: '2026-01-0' + id + 'T10:00:00Z', dist: Array.from({ length: Math.ceil(bis / v) }, (_, i) => Math.min(bis, (i + 1) * v)) });
  it('ganze Runde und der Anstieg, mit fester Kennung je Richtung', () => {
    expect(segs.map(s => s.art)).toEqual(['runde', 'anstieg']);
    expect(segs[1].gain).toBeGreaterThan(70); expect(segs[1].id).toMatch(/:h:\d+$/);
    expect(segmente(bahn(ausPunkten('Test', punkte()), true))[0].id).toMatch(/:r:runde$/);
  });
  it('Versuche: Zeit aus den Metern pro Sekunde, schnellster zuerst, abgebrochene zählen nur so weit sie kamen', () => {
    const l = [lauf('1', 5), lauf('2', 8), lauf('3', 6, 3600)];   // der dritte hört nach dem Anstieg auf
    const runde = versuche(segs[0], l), berg = versuche(segs[1], l);
    expect(runde.map(v => v.fahrt)).toEqual(['2', '1']); expect(runde[0].zeit).toBeCloseTo(rt.dist / 8, 0);
    expect(berg.map(v => v.fahrt)).toEqual(['2', '3', '1']); expect(berg[1].zeit).toBeCloseTo(segs[1].len / 6, 0);
    expect(zeitAuf(segs[1], lauf('4', 6, 1000).dist)).toBeNull();
  });
});

describe('Detailstufen', () => {
  it('gehen runter, wenn Bilder dauerhaft zu lange dauern, und nicht bei einem einzelnen Hänger', () => {
    const g = new Guete(); g.bild(.2); for (let i = 0; i < 300; i++) g.bild(1 / 60);
    expect(g.stufe).toBe(0);
    for (let i = 0; i < 400; i++) g.bild(1 / 25);
    expect(g.stufe).toBeGreaterThan(0);
  });
});

describe('Format', () => { it('Zeiten', () => { expect(zeit(3468)).toBe('57:48'); expect(zeit(4280)).toBe('1:11:20'); expect(zeit(7)).toBe('0:07'); }); });
