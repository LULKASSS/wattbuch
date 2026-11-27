/* Prüft Kennzahlen, Form, Saison und die Runde zum Tag, ohne App. Alle Fahrten sind erfunden. */
import { describe, expect, it } from 'vitest';
import type { FahrtKurz, Strecke } from '../../src/kern/typen';
import { form, formWort, ftpHinweis, isoTag, meilensteine, montag, serie, tagAus, wocheIst, wochentag } from '../../src/kern/form';
import { erzeugteRunde, fortschritt, gewohnt, passende, tagesplan, teilrunde, wochen, type Saison } from '../../src/kern/saison';
import { bahn, fahrzeit } from '../../src/kern/strecke';
import { erzeuge } from '../../src/kern/erzeugen';
// @ts-expect-error Hauptprozess ohne Typen
import kz from '../../app/kennzahl.cjs';

const HEUTE = tagAus('2026-11-26');   // ein Donnerstag
const fahrt = (tag: number, tss: number, mehr: Partial<FahrtKurz> = {}): FahrtKurz => ({ id: 'f' + tag + tss, start: isoTag(tag) + 'T17:00:00', name: 'Test', routeId: null, rev: false, ganz: false, rolle: true, dauer: 3600, zeit: Math.round(tss * 36 / .49), km: 30, hm: 0, avgW: 150, stravaId: null, draussen: false, tss, b20: null, ftpTest: null, ...mehr });
const S: Saison = { art: 'ftp', ziel: 250, bis: '2027-02-18', von: '2026-11-26', ftp0: 230, last0: 200 };

describe('Kennzahlen', () => {
  it('eine Stunde an der FTP sind 100 Punkte, locker deutlich weniger', () => {
    expect(kz.np(Array(3600).fill(200))).toBeCloseTo(200, 5);
    expect(kz.punkte({ p: Array(3600).fill(200), ftp: 200 })).toBeCloseTo(100, 1);
    expect(kz.punkte({ p: Array(3600).fill(140), ftp: 200 })).toBeCloseTo(49, 0);
    expect(kz.punkte({ p: [], noW: true, dur: 7200, estW: 150, ftp: 200 })).toBeCloseTo(112.5, 1);
    expect(kz.punkte({ p: [], noW: true, dur: 7200 })).toBe(0);
  });
  it('wechselnde Leistung zählt mehr als ihr Schnitt, bester Schnitt über eine Dauer', () => {
    const p = Array.from({ length: 1200 }, (_, i) => i % 120 < 60 ? 300 : 100);
    expect(kz.np(p)).toBeGreaterThan(210);
    expect(kz.bestAvg([100, 100, 300, 300, 100], 2)).toBe(300); expect(kz.bestAvg([100], 2)).toBeNull();
  });
});

describe('Form und Fortschritt', () => {
  it('Wochen beginnen am Montag', () => {
    expect(wochentag(HEUTE)).toBe(3); expect(isoTag(montag(HEUTE))).toBe('2026-11-23'); expect(wochentag(tagAus('2026-11-29'))).toBe(6);
  });
  it('Fitness wächst träge, Ermüdung schnell; nach Ruhe ist man frisch', () => {
    const f = Array.from({ length: 30 }, (_, i) => fahrt(HEUTE - i, 80)), F = form(f, HEUTE);
    expect(F.ermuedung).toBeGreaterThan(F.fitness); expect(F.fitness).toBeGreaterThan(30); expect(formWort(F.form)).toBe('müde');
    const R = form(f, HEUTE + 10);
    expect(R.form).toBeGreaterThan(5); expect(formWort(R.form)).toBe('frisch'); expect(R.verlauf).toHaveLength(84);
    expect(form([], HEUTE).fitness).toBe(0);
  });
  it('Serie: Wochen in Folge mit zwei Fahrtagen, die laufende zählt erst, wenn sie so weit ist', () => {
    const mo = montag(HEUTE), f = [fahrt(mo - 7, 50), fahrt(mo - 5, 50), fahrt(mo - 14, 50), fahrt(mo - 12, 50), fahrt(mo - 28, 50), fahrt(mo - 27, 50)];
    expect(serie(f, HEUTE)).toBe(2);
    expect(serie([...f, fahrt(mo, 40), fahrt(mo + 2, 40)], HEUTE)).toBe(3);
    expect(wocheIst(f, mo - 7).tage).toBe(2); expect(wocheIst(f, mo - 7).punkte).toBe(100);
  });
  it('Meilensteine: längste Fahrt, beste 20 Minuten, FTP-Test; Hinweis auf eine höhere FTP', () => {
    const f = [fahrt(HEUTE - 30, 50, { km: 40, b20: 200 }), fahrt(HEUTE - 20, 60, { km: 62, b20: 201 }), fahrt(HEUTE - 10, 60, { km: 30, b20: 215 }), fahrt(HEUTE - 2, 40, { ftpTest: 236, km: 12 })];
    expect(meilensteine(f).map(m => m.text)).toEqual(['FTP-Test: 236 W', 'Beste 20 Minuten: 215 W', 'Längste Fahrt: 62 km']);
    expect(ftpHinweis(f, HEUTE, 200)).toBe(204); expect(ftpHinweis(f, HEUTE, 204)).toBeNull(); expect(ftpHinweis(f, HEUTE + 60, 200)).toBeNull();
  });
});

describe('Saison', () => {
  it('Wochen: drei Aufbau, eine ruhige, die letzte halb; das Pensum wächst', () => {
    const W = wochen(S);
    expect(W).toHaveLength(13); expect(W.map(w => w.art).slice(0, 5)).toEqual(['aufbau', 'aufbau', 'aufbau', 'ruhe', 'aufbau']); expect(W[12].art).toBe('ziel');
    expect(W[0].soll).toBe(220); expect(W[2].soll).toBeGreaterThan(W[0].soll); expect(W[3].soll).toBeLessThan(W[0].soll); expect(W[12].soll).toBeLessThan(W[11].soll);
    expect(isoTag(W[0].mo)).toBe('2026-11-23');
    expect(wochen({ ...S, last0: 0 })[0].soll).toBe(150);   // ohne Vorgeschichte ein kleines Pensum
  });
  it('Der Tag: eine Art, eine Zielleistung, eine Dauer; nach der Fahrt ist der Tag geschafft', () => {
    const p = tagesplan(S, [], HEUTE, 230);
    expect(p.woche.nr).toBe(1); expect(p.wochen).toBe(13); expect(p.art).toBe('zuegig'); expect(p.watt).toBe(195); expect(p.minuten).toBeGreaterThanOrEqual(35); expect(p.minuten).toBeLessThanOrEqual(75);
    const d = tagesplan(S, [fahrt(HEUTE, 60)], HEUTE, 230);
    expect(d.art).toBe('frei'); expect(d.erledigt).toBe(true); expect(d.ist).toBe(60); expect(d.fahrtenIst).toBe(1);
  });
  it('passt sich an: nach einem harten Tag locker, ausgelassene Tage machen die übrigen länger, draußen zählt mit', () => {
    const mo = montag(HEUTE);
    expect(tagesplan(S, [fahrt(HEUTE - 1, 70, { zeit: 3000 })], HEUTE, 230).art).toBe('locker');
    const frueh = tagesplan(S, [], mo, 230), spaet = tagesplan(S, [], mo + 5, 230);
    expect(spaet.minuten).toBeGreaterThan(frueh.minuten);
    const drau = tagesplan(S, [fahrt(mo, 210, { draussen: true, rolle: false, zeit: 10800 })], HEUTE, 230);
    expect(drau.art).toBe('frei'); expect(drau.ist).toBe(210);
    /* zwei Tage in Folge gefahren: Ruhetag, solange die Woche es hergibt */
    expect(tagesplan(S, [fahrt(HEUTE - 1, 40), fahrt(HEUTE - 2, 40)], HEUTE, 230).art).toBe('frei');
  });
  it('FTP-Test nur auf Wunsch: in der ruhigen Woche und kurz vor dem Ziel', () => {
    const ruhe = wochen(S)[3].mo + 4;
    expect(tagesplan(S, [], ruhe, 230).art).not.toBe('test');
    expect(tagesplan(S, [], ruhe, 230, true).art).toBe('test');
    expect(tagesplan(S, [fahrt(ruhe - 5, 30, { ftpTest: 240 })], ruhe, 230, true).art).not.toBe('test');
    expect(tagesplan(S, [], tagAus(S.bis) - 1, 230, true).art).toBe('test');
  });
  it('Fortschritt: FTP zwischen Start und Ziel, bei der Tour die längste Fahrt seit Beginn', () => {
    expect(fortschritt(S, [], 240).anteil).toBeCloseTo(.5); expect(fortschritt(S, [], 260).anteil).toBe(1);
    const T: Saison = { ...S, art: 'tour', ziel: 120 };
    expect(fortschritt(T, [fahrt(HEUTE - 5, 100, { km: 200 }), fahrt(HEUTE + 3, 90, { km: 60 })], 230)).toEqual({ anteil: .5, jetzt: 60 });
    expect(gewohnt([fahrt(montag(HEUTE) - 3, 120), fahrt(montag(HEUTE) - 10, 60)], HEUTE)).toBe(30);
  });
});

describe('Die Runde zum Tag', () => {
  const lang: Strecke = { ...erzeuge('flach', 5, 80), id: 'lang', name: 'Lange Runde' }; delete lang.gen;
  it('eigene Runde, die passt: die am längsten nicht gefahrene', () => {
    const k = [{ id: 'a', min: 50, zuletzt: '2026-11-20' }, { id: 'b', min: 44, zuletzt: '2026-10-01' }, { id: 'c', min: 90, zuletzt: null }];
    expect(passende(45, k)).toBe('b'); expect(passende(85, k)).toBe('c'); expect(passende(20, k)).toBeNull();
  });
  it('Teilrunde: ein Stück der langen Strecke in passender Dauer, mit fester Kennung', () => {
    const P = 160, m = 84, ganz = fahrzeit(bahn(lang), 0, bahn(lang).dist, P, m) / 60;
    const t = teilrunde(lang, 45, P, m, HEUTE)!, k = Math.round(ganz / 45);
    expect(t.id).toBe(`t${k}x${HEUTE % k + 1}-lang`); expect(t.name).toBe(`Lange Runde ${HEUTE % k + 1}/${k}`); expect(t.plan).toBe(true); expect(t.teil!.aus).toBe('lang');
    const min = fahrzeit(bahn(t), 0, bahn(t).dist, P, m) / 60;
    expect(Math.abs(min - ganz / k)).toBeLessThan(3); expect(t.dist).toBe((t.ele.length - 1) * 25); expect(t.line.length).toBeGreaterThan(5);
    expect(t.ele[0]).toBe(lang.ele[t.teil!.von / 25]);
    expect(teilrunde(lang, 45, P, m, HEUTE)!.id).toBe(t.id);
    expect(teilrunde(lang, 45, P, m, HEUTE + 1)!.id).not.toBe(t.id);
    expect(teilrunde(lang, ganz, P, m, HEUTE)).toBeNull();   // die Strecke passt selbst
  });
  it('erzeugte Runde trifft die Dauer auf ein Sechstel', () => {
    for (const [art, min] of [['zuegig', 40], ['locker', 30], ['lang', 120]] as const) {
      const st = erzeugteRunde(art, min, 160, 84, HEUTE), t = fahrzeit(bahn(st), 0, bahn(st).dist, 160, 84) / 60;
      expect(Math.abs(t - min)).toBeLessThan(min / 6); expect(st.plan).toBe(true); expect(st.gen).toBe(art === 'zuegig' ? 'huegel' : 'flach');
    }
  });
});

/* ---------- Schritt 6: voller Coach und FTP-Test ---------- */
import { Coach, Rampe } from '../../src/kern/coach';
import { testbahn } from '../../src/kern/erzeugen';
import { anstiege, gradeAt } from '../../src/kern/strecke';

describe('Coach', () => {
  const rt = bahn(erzeuge('berg', 23)), neu = () => new Coach(rt, 200, 84, 140, 180);
  it('rollt erst ein, bei kurzen Runden kürzer', () => {
    const c = neu();
    expect(c.warm).toBe(300); expect(c.ziel(0, 0)).toBe(100); expect(c.ziel(0, 150)).toBe(120);
    const kurz: Strecke = { id: 'k', name: 'k', dist: 3000, step: 25, gain: 0, ele: Array(121).fill(100), line: [[50, 10], [50.02, 10]] };
    const k = new Coach(bahn(kurz), 200, 84, 140, 180);
    expect(k.warm).toBeLessThan(90); expect(k.ziel(2900, 400)).toBe(140);
  });
  it('am Berg mehr als im Flachen, nie über dem Deckel, bergab weniger', () => {
    const c = neu(), berg = c.climbs.slice().sort((a, b) => b.gain - a.gain)[0];
    expect(c.climbs.length).toBe(anstiege(rt).length);
    const w = c.ziel(berg.s + 100, 2000);
    expect(w).toBeGreaterThan(140); expect(w).toBeLessThanOrEqual(200);
    expect(berg.w).toBe(c.ziel(berg.s, 2000)); expect(berg.t).toBeGreaterThan(60);
    let ab = 0; for (let d = berg.over + 200; d < rt.dist - 200; d += 25) if (gradeAt(rt, d + 40) < -4 && gradeAt(rt, d + 100) < -4 && !c.climbs.some(x => d >= x.s && d < x.over)) { ab = d; break; }
    expect(ab).toBeGreaterThan(0); expect(c.ziel(ab, 2000)).toBeLessThan(140);
    c.basis = 160; c.oben = 205; expect(c.ziel(ab, 2000)).toBeGreaterThanOrEqual(120);   // Pfeiltasten heben das Niveau
  });
  it('über der FTP nur, solange die Reserve reicht', () => {
    const hoch = new Coach(rt, 200, 84, 190, 260), berg = hoch.climbs.slice().sort((a, b) => b.gain - a.gain)[0];
    const voll = hoch.ziel(berg.s + 50, 2000);
    for (let i = 0; i < 120; i++) hoch.sekunde(330);
    expect(hoch.reserve).toBeLessThan(.2);
    expect(hoch.ziel(berg.s + 50, 2000)).toBeLessThanOrEqual(voll);
    for (let i = 0; i < 1200; i++) hoch.sekunde(100);
    expect(hoch.reserve).toBeGreaterThan(.8);
  });
  it('sagt jede Sache einmal: einrollen, Leistung am Fuß, kurz vor oben, danach erholen', () => {
    const c = neu(), berg = c.climbs.slice().sort((a, b) => b.gain - a.gain)[0];
    expect(c.ansage(10, 3)!.text).toMatch(/^Erst einrollen · 5 min$/); expect(c.ansage(20, 4)).toBeNull();
    expect(c.ansage(berg.s + 10, 900)!.text).toMatch(/^Jetzt \d+ W · \d+ (s|min) bis oben$/); expect(c.ansage(berg.s + 30, 905)).toBeNull();
    expect(c.ansage(berg.top - 30, 1500)!.text).toMatch(/^Noch \d+ s drücken$/);
  });
});

describe('FTP-Test', () => {
  it('Rampe: Start bei der halben FTP, jede Minute 20 W mehr', () => {
    const r = new Rampe(230);
    expect(r.start).toBe(120); expect(r.ziel(0)).toBe(120); expect(r.ziel(59)).toBe(120); expect(r.ziel(60)).toBe(140); expect(r.ziel(601)).toBe(320); expect(new Rampe(150).start).toBe(100);
  });
  it('Schluss nach 8 s unter 80 % der Stufe oder zu niedriger Kadenz, nicht in den ersten 90 s', () => {
    const r = new Rampe(200); let t = 0;
    for (; t < 80; t++) expect(r.sekunde(t, 20, 80)).toBe(false);
    for (; t < 300; t++) expect(r.sekunde(t, r.ziel(t), 85)).toBe(false);
    for (let k = 0; k < 7; k++) expect(r.sekunde(t++, r.ziel(t) * .7, 85)).toBe(false);
    expect(r.sekunde(t++, r.ziel(t), 85)).toBe(false);   // gefangen: zählt von vorn
    for (let k = 0; k < 7; k++) expect(r.sekunde(t++, r.ziel(t), 40)).toBe(false);
    expect(r.sekunde(t, r.ziel(t), 40)).toBe(true);
  });
  it('Ergebnis: 75 % der besten Minute, unter zwei Minuten keins; die Bahn ist flach', () => {
    const p = [...Array(300).fill(150), ...Array(60).fill(280), ...Array(20).fill(100)];
    expect(Rampe.ergebnis(p)).toEqual({ best: 280, ftp: 210 }); expect(Rampe.ergebnis(Array(100).fill(300))).toBeNull();
    const b = testbahn(); expect(b.test).toBe(true); expect(new Set(b.ele).size).toBe(1); expect(bahn(b).dist).toBe(40000); expect(bahn(b).loop).toBe(true);
  });
});
