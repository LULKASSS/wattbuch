/* Maschinenraum: unsichtbares Fenster mit allem, was eine Fahrt ausmacht: Geräte, Fahrphysik, Aufnahme, Coach.
   Schickt der Bühne zehnmal pro Sekunde den Zustand und nimmt Befehle entgegen. Hängt nicht an der Grafik:
   Stürzt die Bühne ab, läuft hier alles weiter. Jede aufgenommene Sekunde geht sofort ins Journal. */
import type { Befehl, Ereignis, Ergebnis, Fahrt, Phase, Strecke, Werte, Zustand } from '../kern/typen';
import { WERTE_START } from '../kern/typen';
import { schritt, clamp } from '../kern/physik';
import { bahn, eleAt, gradeAt, anstiege, ausPunkten, type Bahn, type Anstieg } from '../kern/strecke';
import { erzeuge, GEN_START, testbahn } from '../kern/erzeugen';
import { grundleistung, Coach, Rampe } from '../kern/coach';
import { Aufnahme, schnitt } from '../kern/aufnahme';
import { TrittStart, CountAbbruch } from '../kern/start';
import { Rivale } from '../kern/rivale';
import { segmente, versuche, zeitAuf, type Segment } from '../kern/segmente';
import { zeit as fmtZeit } from '../kern/format';
import { fmt, tag } from '../kern/format';
import { Geraete } from './geraete';

const W = window.wattbuch;
/* Tests lassen die Uhr schneller laufen (WATTBUCH_TEMPO), sonst 1 */
const TEMPO = Math.max(1, +(new URLSearchParams(location.search).get('tempo') || 1));
const G = new Geraete();
let werte: Werte = { ...WERTE_START };
let strecken: Strecke[] = [];

const F = {
  phase: 'lobby' as Phase, count: 0, durchTritt: false,
  rt: null as Bahn | null, climbs: [] as Anstieg[], haupt: null as Anstieg | null,
  rec: new Aufnahme(), startISO: '', t: 0, s: 0, v: 0, up: 0, lastAlt: null as number | null,
  coach: true, basis: 140, hand: 140, obenMal: 1.3, co: null as Coach | null,
  halten: false, test: null as Rampe | null, stufe: 0,
  rivale: null as Rivale | null, vorn: false,
  segs: [] as { seg: Segment; best: number | null; n: number }[], bestzeiten: 0,
  gesagt: {} as Record<string, number>, ergebnis: null as Ergebnis | null
};
const tritt = new TrittStart(); let abbruch = new CountAbbruch();
const sag = (e: Ereignis) => W.ereignis(e);
/* Zielleistung: im FTP-Test die Stufe, mit Coach seine Rechnung (um das Niveau der Pfeiltasten verschoben), sonst von Hand */
function ziel(): number {
  if (F.test) return F.test.ziel(F.t);
  if (!F.coach) return F.hand;
  const c = F.co; if (!c || F.phase === 'lobby') return F.basis;
  c.basis = F.basis; c.oben = F.basis * F.obenMal;
  return c.ziel(F.s, F.t);
}

async function laden() {
  werte = { ...WERTE_START, ...(await W.werte() || {}) };
  strecken = await W.strecken();
  if (!strecken.length) {   // erster Start: drei erzeugte Runden, keine persönlichen
    strecken = GEN_START.map(([t, s]) => erzeuge(t, s));
    for (const s of strecken) await W.streckeSpeichern(s);
  }
  if (!strecken.some(s => s.test)) { const t = testbahn(); strecken.push(t); await W.streckeSpeichern(t); }
  F.basis = F.hand = grundleistung(werte.ftp);
}

/* Werte oder Strecken haben sich geändert (Konto, Profil): neu lesen, aber nicht mitten in einer Fahrt */
async function neuLaden() {
  if (F.phase === 'ride' || F.phase === 'count') return;
  werte = { ...WERTE_START, ...(await W.werte() || {}) }; strecken = await W.strecken();
  F.basis = F.hand = grundleistung(werte.ftp);
}

/* basis: Zielleistung des Tages aus der Saison; ohne Saison 70 % der FTP */
function start(streckeId: string, rev: boolean, durchTritt: boolean, basis?: number, oben?: number, test = false) {
  const st = strecken.find(x => x.id === streckeId);
  if (!st || F.phase !== 'lobby') return;
  if (st.test && !test) { starteTest(durchTritt); return; }
  F.rt = bahn(st, rev); F.climbs = anstiege(F.rt);
  F.haupt = F.climbs.slice().sort((a, b) => b.gain - a.gain)[0] || null;
  Object.assign(F, { phase: 'count', count: 3, durchTritt, rec: new Aufnahme(), t: 0, s: 0, up: 0, lastAlt: eleAt(F.rt, 0), coach: true, basis: basis && basis >= 60 ? basis : grundleistung(werte.ftp), halten: !!werte.erg, test: null, stufe: 0, rivale: null, vorn: false, gesagt: {}, ergebnis: null, segs: [], bestzeiten: 0 });
  /* Segmente der Runde mit der bisherigen Bestzeit aus allen früheren Versuchen */
  const rt = F.rt;
  W.laeufe(streckeId, rev).then(l => { if (F.rt === rt) F.segs = segmente(rt).filter(s => s.art === 'anstieg').map(seg => { const v = versuche(seg, l); return { seg, best: v.length ? v[0].zeit : null, n: v.length }; }); });
  F.obenMal = basis && oben && oben > basis ? oben / basis : 1.3;
  F.co = new Coach(rt, werte.ftp, werte.weight + werte.bike, F.basis, F.basis * F.obenMal);
  F.hand = F.basis; abbruch = new CountAbbruch();
  W.rivale(streckeId, rev).then(r => { if (r && F.rt && F.rt.id === streckeId) F.rivale = new Rivale(r.start, r.dist); });
}
/* FTP-Test: flache Bahn, die Rolle hält die Stufe, jede Minute 20 W mehr */
function starteTest(durchTritt = false) {
  const st = strecken.find(x => x.test);
  if (!st || F.phase !== 'lobby') return;
  if (G.stand.rolle !== 'an') { sag({ art: 'hinweis', kopf: 'FTP-Test', text: 'Erst die Rolle wecken' }); return; }
  start(st.id, false, durchTritt, undefined, undefined, true);
  Object.assign(F, { test: new Rampe(werte.ftp), coach: false, halten: true, rivale: null });
}
function los() {
  F.phase = 'ride'; F.startISO = new Date().toISOString();
  W.fahrtStart({ start: F.startISO, streckeId: F.rt!.id, rev: F.rt!.rev, route: F.rt!.name, ftp: werte.ftp, weight: werte.weight, trainer: true });
  sag({ art: 'gross', text: 'Los' });
}
async function ende(ganz: boolean) {
  if (F.phase !== 'ride') return;
  const R = F.rec, rt = F.rt!, n = R.n;
  F.phase = 'done'; tritt.entschaerfen();
  if (n < 10) { W.fahrtWeg(); F.ergebnis = null; F.test = null; F.phase = 'lobby'; return; }
  const any = (a: number[]) => a.some(v => v > 0);
  const r: Fahrt = {
    id: 'r' + Date.parse(F.startISO) + Math.random().toString(36).slice(2, 6), start: F.startISO, name: rt.name + (rt.rev ? ' (umgekehrt)' : ''),
    p: R.p, hr: any(R.hr) ? R.hr : null, cad: any(R.cad) ? R.cad : null, spd: any(R.spd) ? R.spd : null, dist: any(R.dist) ? R.dist : null, alt: R.alt.some(v => v != null) ? R.alt : null,
    route: F.test ? null : rt.name + (rt.rev ? ' (umgekehrt)' : ''), routeId: F.test ? null : rt.id, rev: rt.rev, ganz: ganz && !F.test, gain: Math.round(F.up), trainer: G.stand.rolle === 'an', ftp: werte.ftp, weight: werte.weight, app: 'neu'
  };
  /* FTP-Test: 75 % der besten Minute, hängt an der Fahrt und gilt gleich als neue FTP */
  let ftpTest: Ergebnis['ftpTest'];
  if (F.test) { const e = Rampe.ergebnis(R.p); ftpTest = e ? { ...e, vorher: werte.ftp } : null; r.name = 'FTP-Test'; if (e) r.ftpTest = { ...e, before: werte.ftp }; F.test = null; ganz = false; }
  const rv = F.rivale;
  F.ergebnis = { zeit: n, ganz, km: F.s / 1000, hm: Math.round(F.up), avgW: Math.round(schnitt(R.p)), rivale: rv ? { start: rv.start, dauer: rv.dauer } : null, abstand: rv && ganz ? n - rv.dauer : null, bestzeiten: F.bestzeiten, ftpTest };
  const f = await W.fahrtFertig(r);
  if (F.ergebnis) F.ergebnis = { ...F.ergebnis, id: f.id, strava: f.strava };
}

/* Meldungen während der Fahrt: Anstieg voraus, größter Anstieg als Abschnitt, Kuppe, Rivale überholt */
function meldungen() {
  const s = F.s, g = F.gesagt;
  for (const [i, c] of F.climbs.entries()) {
    const d = c.s - s;
    if (d > 0 && d < 300 && !g['a' + i]) { g['a' + i] = 1; const w = F.coach && F.co && F.co.climbs[i] ? ` · ${F.co.climbs[i].w} W` : ''; sag({ art: 'hinweis', kopf: 'Anstieg voraus', text: `${fmt(c.len / 1000, 1)} km · ${fmt(c.g, 1)} %${w || ' im Schnitt'}` }); }
  }
  /* Coach: Einrollen, Leistung am Berg, wie lange noch, danach erholen */
  if (F.coach && F.co) { const a = F.co.ansage(s, F.t); if (a) sag({ art: 'hinweis', kopf: a.kopf, text: a.text, ms: 4200 });
  }
  /* Segmente: am Fuß die Bestzeit ansagen, oben die eigene Zeit dagegenhalten */
  for (const x of F.segs) {
    const k = x.seg.id;
    if (!g['f' + k] && s >= x.seg.von && s < x.seg.bis) { g['f' + k] = 1; sag({ art: 'gross', text: 'Segment' }); sag({ art: 'hinweis', kopf: `Anstieg · ${fmt(x.seg.len / 1000, 1)} km`, text: x.best != null ? 'Bestzeit ' + fmtZeit(x.best) : 'Erste Zeit zählt', ms: 4200 }); }
    if (g['f' + k] && !g['k' + k] && s >= x.seg.bis) {
      g['k' + k] = 1; const z = zeitAuf(x.seg, F.rec.dist.concat([s])); sag({ art: 'gross', text: 'Kuppe' });
      if (z != null) {
        const d = x.best != null ? z - x.best : null;
        if (d == null || d < 0) F.bestzeiten++;
        sag({ art: 'hinweis', kopf: 'Segment geschafft', text: d == null ? 'Erste Zeit ' + fmtZeit(z) : Math.abs(d) < .5 ? 'Genau deine Bestzeit' : `${fmt(Math.abs(d))} s ${d < 0 ? 'schneller als je zuvor' : 'über deiner Bestzeit'}`, ms: 4200 });
      }
    }
  }
  const rv = F.rivale;
  if (rv && F.t > 20) {
    const vorn = s > rv.ort(F.t) + 3;
    if (vorn && !F.vorn && rv.ort(F.t) > 50) { sag({ art: 'gross', text: 'Vorbei' }); sag({ art: 'hinweis', kopf: 'Rivale überholt', text: 'Du liegst vor dir vom ' + tag(rv.start) }); }
    if (vorn || s < rv.ort(F.t) - 3) F.vorn = vorn;
  }
}

/* ---------- Takt ---------- */
let zuletzt = performance.now(), sek = 0;
function takt() {
  const now = performance.now(), dt = Math.min((now - zuletzt) / 1000, 2) * TEMPO; zuletzt = now;
  const pow = G.watt, m = werte.weight + werte.bike, R = F.rec;
  const faehrt = F.phase === 'ride' && !R.pause;
  const grade = F.rt && F.phase !== 'lobby' ? gradeAt(F.rt, F.s) : 0;
  /* Physik in kleinen Schritten */
  let rest = dt;
  while (rest > 1e-6) {
    const h = Math.min(0.25, rest); rest -= h;
    F.v = pow == null ? 0 : schritt(F.v, pow, F.phase === 'lobby' ? 0 : F.rt ? gradeAt(F.rt, F.s) : 0, m, h);
    if (faehrt && F.rt) {
      F.s = Math.min(F.rt.dist, F.s + F.v * h); F.t += h;
      const alt = eleAt(F.rt, F.s);
      if (F.lastAlt != null && alt > F.lastAlt) F.up += alt - F.lastAlt;
      F.lastAlt = alt;
    }
  }
  if (F.phase === 'lobby') { if (G.stand.rolle === 'an' && tritt.tritt(pow, G.kadenz, dt) && wahl) start(wahl.id, wahl.rev, true, wahl.basis, wahl.oben); }
  else if (F.phase === 'count') {
    F.count -= dt;
    if (F.durchTritt && abbruch.pruefe(G.wattJetzt, dt)) { F.phase = 'lobby'; F.test = null; }
    else if (F.count <= 0) los();
  }
  else if (F.phase === 'ride' && F.rt) {
    /* eine Zeile pro gefahrener Sekunde */
    while (!R.pause && R.n < Math.floor(F.t)) {
      const x = { p: G.wattSekunde, hr: G.puls || 0, cad: G.kadenz || 0, spd: Math.round(F.v * 36) / 10, dist: Math.round(F.s * 10) / 10, alt: Math.round(eleAt(F.rt, F.s) * 10) / 10 };
      const folge = R.sekunde(x);
      W.sekunde([x.p, x.hr, x.cad, x.spd, x.dist, x.alt]);
      if (F.co) F.co.sekunde(x.p);
      if (folge && folge.was === 'pause') { W.sekunde({ kuerze: folge.kuerze }); F.t = R.n; }
      if (F.test) {
        /* nächste Stufe ansagen; Schluss, wenn es nicht mehr geht (oder gar nicht mehr getreten wird) */
        const st = F.test.stufe(F.t);
        if (st !== F.stufe) { F.stufe = st; sag({ art: 'hinweis', kopf: `Stufe ${st + 1}`, text: `${F.test.ziel(F.t)} W`, ms: 3000 }); }
        if (F.test.sekunde(F.t, x.p, x.cad || null) || (folge && folge.was === 'pause')) { ende(false); break; }
      }
    }
    /* automatisch pausiert: einmal pro Sekunde schauen, ob wieder getreten wird */
    sek += dt;
    if (sek >= 1) { sek = 0; R.warte(pow); }
    if (F.phase === 'ride' && !R.pause && !F.test) meldungen();
    if (F.phase === 'ride' && F.s >= F.rt.dist) ende(true);
  }
  /* Steigung an die Rolle (mit Steigungsstärke), in der Lobby flach */
  /* Watt halten: die Rolle regelt auf die Zielleistung, sonst bekommt sie die Steigung */
  G.steuere(F.phase === 'ride' || F.phase === 'count' ? grade * werte.diff : 0, F.halten && F.phase === 'ride' && !F.rec.pause ? ziel() : null);
  sende();
}
function sende() {
  const rv = F.rivale, ride = F.phase === 'ride';
  const z: Zustand = {
    phase: F.phase, pause: F.rec.pause, auto: F.rec.auto, geraete: { ...G.stand },
    w: G.watt, hr: G.puls, cad: G.kadenz, v: F.v, s: F.s, t: F.t, grade: F.rt && F.phase !== 'lobby' ? gradeAt(F.rt, F.s) : 0, up: F.up,
    ziel: ziel(), coach: F.coach, basis: F.basis, ftp: werte.ftp, count: Math.max(0, F.count),
    halten: F.halten && F.phase !== 'lobby', test: F.test && F.phase !== 'lobby' ? { stufe: F.test.stufe(F.t) + 1 } : null,
    streckeId: F.rt && F.phase !== 'lobby' ? F.rt.id : null, rev: !!(F.rt && F.rt.rev),
    gs: rv && ride ? rv.ort(F.t) : null, gap: rv && ride ? F.t - rv.wann(F.s) : null, rivaleStart: rv ? rv.start : null,
    ergebnis: F.ergebnis
  };
  W.zustand(z);
  window.__wb = { z, tempo: TEMPO };
}

/* Welche Runde die Lobby gerade zeigt (für den Start beim ersten Tritt) */
let wahl: { id: string; rev: boolean; basis?: number; oben?: number } | null = null;
W.aufBefehl((b: Befehl) => {
  if (b.was === 'wahl') wahl = { id: b.streckeId, rev: b.rev, basis: b.basis, oben: b.oben };
  else if (b.was === 'test') starteTest();
  else if (b.was === 'halten') { if (F.phase === 'ride' && !F.test) { F.halten = !F.halten; sag({ art: 'hinweis', kopf: 'Watt halten', text: F.halten ? 'An · die Rolle hält das Ziel' : 'Aus · du spürst die Steigung', ms: 2600 }); } }
  else if (b.was === 'werte') neuLaden();
  else if (b.was === 'trenne') G.trenne(b.art);
  else if (b.was === 'strecke') {   // Runde aus Strava: Punkte mit Höhe → geglättete Strecke
    try { const st = ausPunkten(b.name, b.pts); st.id = b.id; if (b.fav) st.fav = b.fav; W.streckeSpeichern(st); } catch { /* zu kurz oder kaputt */ }
  }
  else if (b.was === 'start') start(b.streckeId, b.rev, false, b.basis, b.oben);
  else if (b.was === 'abbruch') { if (F.phase === 'count') { F.phase = 'lobby'; F.test = null; tritt.entschaerfen(); } }
  else if (b.was === 'pause') { if (F.phase === 'ride') F.rec.vonHand(b.an == null ? !F.rec.pause : b.an); }
  else if (b.was === 'ende') ende(false);
  else if (b.was === 'lobby') { if (F.phase === 'done') { F.phase = 'lobby'; F.ergebnis = null; F.s = 0; F.t = 0; } }
  else if (b.was === 'coach') {
    if (F.phase !== 'ride' || F.test) return;
    if (F.coach) F.hand = ziel();
    F.coach = !F.coach;
    sag({ art: 'hinweis', kopf: 'Coach', text: F.coach ? 'An · Ziel folgt der Strecke' : 'Aus · du stellst das Ziel', ms: 2600 });
  }
  else if (b.was === 'stufe') { if (F.test) return; if (F.coach) F.basis = clamp(F.basis + b.d / 2, 60, 500); else F.hand = clamp(F.hand + b.d, 60, 600); }
});

/* Nach einem Absturz nur des Maschinenraums: laufende Fahrt aus dem Journal fortsetzen */
async function fortsetzen() {
  const j = await W.laufend();
  if (!j || !j.sek.length) return;
  const st = strecken.find(x => x.id === j.kopf.streckeId); if (!st) return;
  F.rt = bahn(st, !!j.kopf.rev); F.climbs = anstiege(F.rt); F.haupt = F.climbs.slice().sort((a, b) => b.gain - a.gain)[0] || null;
  F.co = new Coach(F.rt, werte.ftp, werte.weight + werte.bike, F.basis, F.basis * F.obenMal);
  const R = F.rec = new Aufnahme();
  for (const s of j.sek) { R.p.push(s[0] || 0); R.hr.push(s[1] || 0); R.cad.push(s[2] || 0); R.spd.push(s[3] || 0); R.dist.push(s[4] || 0); R.alt.push(s[5]); }
  F.startISO = j.kopf.start; F.t = R.n; F.s = R.dist[R.n - 1] || 0; F.v = (R.spd[R.n - 1] || 0) / 3.6; F.lastAlt = eleAt(F.rt, F.s); F.phase = 'ride';
  for (let i = 1; i < R.n; i++) { const a = R.alt[i - 1], b = R.alt[i]; if (a != null && b != null && b > a) F.up += b - a; }
}

window.__verbinden = arten => { G.verbinden(arten as any); };
laden().then(fortsetzen).then(() => { setInterval(takt, 100); });
