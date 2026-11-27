/* Bühne: das sichtbare Fenster. Zeigt die Welt und die Anzeige und schickt Befehle an den Maschinenraum.
   Hier wird nichts aufgenommen und nichts gerechnet, was die Fahrt ausmacht: Hängt die Grafik, läuft die Fahrt weiter. */
import '../stil.css';
import type { Strecke, FahrtKurz, FahrtDetail, Werte, Zustand, Ereignis } from '../kern/typen';
import { ausFahrt } from '../kern/erzeugen';
import { bahn, anstiege, fahrzeit, type Bahn } from '../kern/strecke';
import { grundleistung, lage, zone } from '../kern/coach';
import { fmt, zeit, tag } from '../kern/format';
import { segmente, versuche } from '../kern/segmente';
import { form, formWort, ftpHinweis, isoTag, meilensteine, montag, serie, tagAus, tagNr, wocheIst } from '../kern/form';
import { ART, erzeugteRunde, fortschritt, gewohnt, passende, stundenVon, tagesplan, teilrunde, wochen, wochenplan, type Saison, type Tagesplan } from '../kern/saison';
import { Welt, type Akt } from './welt/welt';
import type { KontoStand, Gemerkt, StravaStand } from '../bruecke';

const W = window.wattbuch;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Runde { st: Strecke; rt: Bahn; rtR?: Bahn; best: FahrtKurz | null; zuletzt: string | null; tag: string; min: number; seed: number }
let runden: Runde[] = [], alleFahrten: FahrtKurz[] = [], pick = 0, ftp = 200, gewicht = 84, koerper = 75;
let saison: Saison | null = null, plan: Tagesplan | null = null, heuteId: string | null = null;
let testR: Runde | null = null, rev = false, halten = false, planP = 140, werteJetzt: Werte | null = null;
/* Bahn der Runde in der gewählten Richtung */
const rtVon = (r: Runde) => rev && !r.st.test ? (r.rtR || (r.rtR = bahn(r.st, true))) : r.rt;
const heuteTag = () => tagNr(new Date());
let z: Zustand | null = null, zZeit = 0, akt: Akt = 'lobby', aktRt: Bahn | null = null, haupt: { s: number; top: number } | null = null;
const welt = new Welt($<HTMLCanvasElement>('gl'));
const maus: [number, number] = [0, 0];
addEventListener('pointermove', e => { maus[0] = e.clientX / innerWidth - .5; maus[1] = e.clientY / innerHeight - .5; });

/* ---------- Lobby ---------- */
const seedOf = (id: string) => { let h = 7; for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0; return h % 1000; };
async function ladeRunden() {
  let [strecken, fahrten, werte, sa] = await Promise.all([W.strecken(), W.fahrten(), W.werte(), W.saison()]);
  /* beim allerersten Start legt der Maschinenraum die ersten Runden gerade erst an */
  for (let i = 0; !strecken.length && i < 40; i++) { await new Promise(r => setTimeout(r, 250)); strecken = await W.strecken(); }
  werteJetzt = werte;
  if (werte) { ftp = werte.ftp || ftp; koerper = werte.weight || 75; gewicht = koerper + (werte.bike || 9); halten = !!werte.erg; }
  /* Die FTP zieht von selbst nach: 95 % der besten 20 Minuten der letzten sechs Wochen, wenn das mehr ist. Gezählt
     werden nur Fahrten, seit die FTP zuletzt gesetzt wurde. Nach unten geht sie nur von Hand oder per Test. */
  const hoeher = ftpHinweis(fahrten, heuteTag(), ftp, werte && werte.ftpAm);
  if (hoeher && akt === 'lobby') { werteJetzt = await W.werteSetzen({ ftp: hoeher }); ftp = hoeher; toast('FTP', fmt(hoeher) + ' W', 6000); }
  alleFahrten = fahrten; saison = sa;
  /* Mit Saison gibt der Tag die Zielleistung vor, ohne sind es 70 % der FTP */
  plan = saison ? tagesplan(saison, fahrten, heuteTag(), ftp, true) : null;
  const P = planP = plan ? plan.watt : grundleistung(ftp);
  const baue = (st: Strecke): Runde => {
    const rt = bahn(st), eigene = fahrten.filter(f => f.routeId === st.id && !f.rev && f.rolle);
    const best = eigene.filter(f => f.ganz).sort((a, b) => a.dauer - b.dauer)[0] || null;
    const zuletzt = eigene.length ? eigene[eigene.length - 1].start : null;
    return { st, rt, best, zuletzt, tag: '', min: Math.round(fahrzeit(rt, 0, rt.dist, P, gewicht) / 60), seed: seedOf(st.id) };
  };
  runden = strecken.filter(st => !st.test).map(baue);
  const tb = strecken.find(st => st.test); testR = tb ? { ...baue(tb), min: 25 } : null;
  let heute: Runde | undefined;
  /* Tag des FTP-Tests: die flache Bahn ist die Runde für heute */
  if (plan && plan.art === 'test' && testR) { runden.push(testR); heute = testR; }
  else if (plan) {
    /* Die Runde zum Tag: eine eigene, die zur Dauer passt; sonst ein Stück einer langen eigenen Strecke; sonst eine
       erzeugte. Was für einen früheren Tag angelegt und nie gefahren wurde, verschwindet wieder. */
    const eigen = runden.filter(r => !r.st.plan), kand = eigen.map(r => ({ id: r.st.id, min: r.min, zuletzt: r.zuletzt }));
    let id = passende(plan.minuten, kand);
    if (!id && plan.art === 'frei') id = eigen.slice().sort((a, b) => a.min - b.min)[0]?.st.id || null;
    if (!id) {
      const lange = eigen.filter(r => !r.st.gen && !r.st.teil && r.min >= plan!.minuten * 1.4).sort((a, b) => (a.zuletzt || '').localeCompare(b.zuletzt || ''))[0];
      const neu = (lange && teilrunde(lange.st, plan.minuten, P, gewicht, heuteTag())) || erzeugteRunde(plan.art, plan.minuten, P, gewicht, heuteTag());
      id = neu.id;
      if (!runden.some(r => r.st.id === id)) { await W.streckeSpeichern(neu); runden.push(baue(neu)); }
    }
    for (const r of runden.filter(r => r.st.plan && r.st.id !== id)) W.streckeWeg(r.st.id);
    runden = runden.filter(r => !r.st.plan || r.st.id === id);
    heute = runden.find(r => r.st.id === id);
  } else {
    /* Ohne Saison: unter den Runden bis 90 Minuten die, die am längsten nicht gefahren wurde; sonst die kürzeste */
    const kurz = runden.filter(r => r.min <= 90), wahl = kurz.length ? kurz : runden.slice().sort((a, b) => a.min - b.min).slice(0, 1);
    heute = wahl.slice().sort((a, b) => (a.zuletzt || '').localeCompare(b.zuletzt || '') || a.min - b.min)[0];
  }
  const heuteT = !plan ? 'Heute für dich' : plan.art === 'frei' ? (plan.erledigt ? 'Heute geschafft' : 'Heute frei') : plan.art === 'test' ? 'Heute · FTP-Test' : `Heute · ${ART[plan.art].name} · ${plan.watt} W`;
  for (const r of runden) r.tag = r === heute ? heuteT : r.best ? 'Rivale wartet' : '';
  runden.sort((a, b) => (a === heute ? -1 : b === heute ? 1 : 0)); heuteId = heute ? heute.st.id : null;
  return heute ? runden.indexOf(heute) : 0;
}
function profil(cv: HTMLCanvasElement, rt: Bahn, done: number | null, hervor: { s: number; top: number } | null) {
  const g = cv.getContext('2d')!, Wd = cv.width, H = cv.height, e = rt.ele, n = e.length - 1, st = Math.max(1, Math.floor(n / 400));
  g.clearRect(0, 0, Wd, H);
  let lo = Infinity, hi = -Infinity; for (const v of e) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const Y = (i: number) => H - H * .1 - (e[i] - lo) / Math.max(hi - lo, 30) * (H * .72), X = (i: number) => i / n * Wd;
  const flaeche = () => { g.beginPath(); g.moveTo(0, H); for (let i = 0; i <= n; i += st) g.lineTo(X(i), Y(i)); g.lineTo(Wd, Y(n)); g.lineTo(Wd, H); g.closePath(); };
  flaeche(); g.fillStyle = 'rgba(246,240,230,.10)'; g.fill();
  if (done != null) { g.save(); g.beginPath(); g.rect(0, 0, done * Wd, H); g.clip(); flaeche(); g.fillStyle = 'rgba(243,181,107,.4)'; g.fill(); g.restore(); }
  g.beginPath(); for (let i = 0; i <= n; i += st) i ? g.lineTo(X(i), Y(i)) : g.moveTo(X(i), Y(i)); g.lineTo(Wd, Y(n));
  g.strokeStyle = '#F3B56B'; g.lineWidth = Math.max(2, H / 26); g.lineJoin = 'round'; g.stroke();
  if (done != null && hervor) { const a = Math.round(hervor.s / rt.step), b = Math.round(hervor.top / rt.step); g.beginPath(); for (let i = a; i <= b; i++) i === a ? g.moveTo(X(i), Y(i)) : g.lineTo(X(i), Y(i)); g.strokeStyle = '#F6F0E6'; g.lineWidth = Math.max(3, H / 14); g.lineCap = 'round'; g.stroke(); }
  if (done != null) { const i = Math.min(n, Math.round(done * n)); g.fillStyle = '#F6F0E6'; g.beginPath(); g.arc(X(i), Y(i), H / 9, 0, 7); g.fill(); }
}
function fuelleLobby() {
  const r = runden[pick]; if (!r) return;
  $('hTag').textContent = r.tag; const h = $('hName'); h.innerHTML = '';
  [...r.st.name].forEach((ch, i) => { const s = document.createElement('span'); s.textContent = ch === ' ' ? ' ' : ch; s.style.animationDelay = (i * .035) + 's'; h.appendChild(s); });
  h.style.fontSize = r.st.name.length > 12 ? `clamp(40px,${Math.max(3.6, 7.4 * 12 / r.st.name.length)}vw,${Math.round(112 * 12 / r.st.name.length)}px)` : '';
  /* in Gegenrichtung zählen Fahrzeit und Rivale dieser Richtung */
  const rt = rtVon(r), min = rev && !r.st.test ? Math.round(fahrzeit(rt, 0, rt.dist, planP, gewicht) / 60) : r.min;
  const best = rev ? alleFahrten.filter(f => f.routeId === r.st.id && f.rev && f.rolle && f.ganz).sort((a, b) => a.dauer - b.dauer)[0] || null : r.best;
  $('hKm').textContent = fmt(r.rt.dist / 1000, 1); $('hHm').textContent = fmt(r.st.gain); $('hMin').textContent = String(min);
  $('hRival').hidden = !best;
  if (best) { $('hWhen').textContent = tag(best.start); $('hBest').textContent = zeit(best.dauer); }
  $('oHalt').classList.toggle('on', halten); $('oRev').classList.toggle('on', rev); $('oRev').hidden = $('oHalt').hidden = !!r.st.test;
  $('stufe').textContent = fmt(ftp) + ' W';
  /* Stufe: mit einer Saison der Weg zum Ziel */
  $('stufeW').hidden = !saison; if (saison) $('stufeB').style.width = (fortschritt(saison, alleFahrten, ftp).anteil * 100).toFixed(1) + '%';
  fuelleStart();
}
/* Startseite: die letzte Fahrt, die eigenen Zahlen und die Runde für heute */
function fuelleStart() {
  const heute = heuteTag(), f = alleFahrten[alleFahrten.length - 1], vor = f ? heute - tagNr(f.start) : 0;
  $('hmL').textContent = f ? 'Letzte Fahrt · ' + (vor <= 0 ? 'heute' : vor === 1 ? 'gestern' : `vor ${vor} Tagen`) : 'Wattbuch'; $('hmL').classList.toggle('gut', !!f && vor <= 0);
  $('hmName').textContent = f ? f.name : 'Noch keine Fahrt'; $('hmF').hidden = !f;
  if (f) { $('hmKm').textContent = f.km ? fmt(f.km, 1) : '–'; $('hmZeit').textContent = zeit(f.zeit); $('hmW').textContent = f.avgW ? fmt(f.avgW) : '–'; $('hmP').textContent = fmt(f.tss || 0); }
  const r = runden[pick]; $('hmHeute').textContent = r ? `${r.st.name} · ${r.min} min` : '';
  /* Stand: Fitness, die Woche (und die acht Wochen davor als Balken), FTP, das Jahr */
  const F = form(alleFahrten, heute); $('dFit').textContent = fmt(F.fitness);
  const mo = montag(heute), jahr = new Date().getFullYear(), W8: number[] = Array(8).fill(0);
  let sek = 0, kmW = 0, km4 = 0, kmJ = 0, hmJ = 0, nJ = 0, b20 = 0; const tageW = new Set<number>();
  for (const x of alleFahrten) {
    const t = tagNr(x.start), w = Math.floor((t - mo) / 7) + 7;
    if (w >= 0 && w < 8) W8[w] += x.km || 0;
    if (t >= mo && t <= heute) { sek += x.zeit; kmW += x.km || 0; tageW.add(t); }
    if (t > heute - 28 && t <= heute) km4 += x.km || 0;
    if (new Date(x.start).getFullYear() === jahr) { kmJ += x.km || 0; hmJ += x.hm || 0; nJ++; }
    if (x.b20 && t > heute - 42 && x.b20 > b20) b20 = x.b20;
  }
  $('dWo').textContent = `${Math.floor(sek / 3600)}:${String(Math.floor(sek % 3600 / 60)).padStart(2, '0')}`;
  $('dWoT').textContent = `${fmt(kmW)} km · ${tageW.size} ${tageW.size === 1 ? 'Fahrt' : 'Fahrten'}${tageW.has(heute) ? ' · heute gefahren' : ''}`; $('dWoT').classList.toggle('gut', tageW.has(heute));
  balken($<HTMLCanvasElement>('dBalken'), W8);
  /* FTP gestiegen (in den letzten 30 Tagen): grün, mit dem Zuwachs */
  const wj = werteJetzt, plus = wj && wj.ftpVor && wj.ftpAm && wj.ftpVor < ftp && Date.now() - Date.parse(wj.ftpAm) < 30 * 864e5 ? ftp - wj.ftpVor : 0;
  $('dFtpB2').classList.toggle('gut', plus > 0); $('dFtpPlus').hidden = !plus; $('dFtpPlus').textContent = `+${fmt(plus)} W`;
  $('hmFtp').textContent = fmt(ftp); $('hmWkg').textContent = fmt(ftp / koerper, 1); $('dB20').textContent = b20 ? `${fmt(b20)} W` : '–';
  $('dJahrL').textContent = String(jahr); $('dJahr').textContent = fmt(kmJ); $('dJahrT').textContent = `${nJ} ${nJ === 1 ? 'Fahrt' : 'Fahrten'}${hmJ ? ` · ${fmt(hmJ)} Hm` : ''}`;
  $('hmKm4').textContent = `${fmt(km4)} km`;
  zeigeSaison();
}
/* Balken je Woche (km), die laufende Woche hell, die Zahl darüber */
function balken(cv: HTMLCanvasElement, v: number[]) {
  const g = cv.getContext('2d')!, Wd = cv.width, H = cv.height, hi = Math.max(1, ...v), n = v.length, bw = (Wd - 16) / n;
  g.clearRect(0, 0, Wd, H); g.font = '600 22px Manrope, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
  v.forEach((x, i) => {
    const h = Math.max(4, (H - 36) * x / hi), px = 8 + i * bw + 6, w = bw - 12, y = H - h, jetzt = i === n - 1;
    g.fillStyle = jetzt ? '#F3B56B' : 'rgba(246,240,230,.28)'; g.beginPath(); g.roundRect(px, y, w, h, 7); g.fill();
    if (x >= 1) { g.fillStyle = jetzt ? '#F6F0E6' : '#CFC6D2'; g.fillText(fmt(x), px + w / 2, y - 5); }
  });
}
/* Unten stehen höchstens vier Runden: ein Fenster um die gewählte, die Pfeiltasten gehen durch alle */
let kAb = 0;
function baueKarten() {
  const n = runden.length;
  kAb = Math.max(0, Math.min(n - 4, pick < kAb ? pick : pick > kAb + 3 ? pick - 3 : kAb));
  for (const [id, h] of [['cards', 88], ['cardsH', 52]] as [string, number][]) {
    const box = $(id); box.innerHTML = '';
    runden.slice(kAb, kAb + 4).forEach((r, k) => {
      const i = kAb + k, b = document.createElement('button'); b.className = 'glass card' + (i === pick ? ' on' : ''); b.innerHTML = `<b></b><small></small><canvas width="480" height="${h}"></canvas>`;
      b.children[0].textContent = r.st.name; b.children[1].textContent = `${fmt(r.rt.dist / 1000, 1)} km · ${fmt(r.st.gain)} Hm${r.tag && id === 'cards' ? ' · ' + r.tag.split(' · ')[0] : ''}`;
      profil(b.children[2] as HTMLCanvasElement, r.rt, null, null); b.onclick = () => waehle(i); box.appendChild(b);
    });
  }
}
const basis = () => plan ? plan.watt : undefined, oben = () => plan ? Math.round(ftp * ART[plan.art].oben) : undefined;
const wahl = (r: Runde) => W.befehl({ was: 'wahl', streckeId: r.st.id, rev: rev && !r.st.test, basis: basis(), oben: oben() });
/* Wechsel der Welt ohne Schwarzbild: das Bild dahinter wird kurz weich, die neue Welt entsteht, es wird wieder scharf */
let blenden = 0;
function blende(fn: () => void) {
  blenden++; document.body.classList.add('wechsel');
  setTimeout(() => { fn(); setTimeout(() => { if (--blenden <= 0) { blenden = 0; document.body.classList.remove('wechsel'); } }, 140); }, 290);
}
let weltVon = '';   // 'r': Runde der Lobby, 'f<id>': Welt zu einer angesehenen Fahrt
function zeige(i: number) { const r = runden[i]; welt.strecke(rtVon(r), r.seed); weltVon = 'r'; wahl(r); }
function waehle(i: number) {
  const n = runden.length; i = (i + n) % n;
  if (i === pick || akt !== 'lobby') return;
  pick = i; rev = false; baueKarten(); fuelleLobby(); if (sicht === 'rivalen') { rvAuf = ''; zeigeRivalen(); }
  blende(() => zeige(pick));
}
const start = () => { const r = runden[pick]; if (r && akt === 'lobby') W.befehl(r.st.test ? { was: 'test' } : { was: 'start', streckeId: r.st.id, rev, basis: basis(), oben: oben() }); };
$('oRev').onclick = () => { if (akt !== 'lobby' || !runden[pick]) return; rev = !rev; fuelleLobby(); if (sicht === 'rivalen') { rvAuf = ''; zeigeRivalen(); } blende(() => zeige(pick)); };
$('oHalt').onclick = async () => { halten = !halten; $('oHalt').classList.toggle('on', halten); await W.werteSetzen({ erg: halten }); };

/* ---------- Einblendungen ---------- */
function toast(l: string, b: string, ms = 3600) {
  const e = document.createElement('div'); e.className = 'toast'; e.innerHTML = '<span class="lbl"></span><b></b>'; e.firstChild!.textContent = l; e.lastChild!.textContent = b; $('toasts').appendChild(e);
  setTimeout(() => { e.classList.add('out'); setTimeout(() => e.remove(), 600); }, ms);
}
function gross(t: string) { const e = $('bigT'); e.textContent = t; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); }
W.aufEreignis((e: Ereignis) => { if (e.art === 'gross') gross(e.text); else toast(e.kopf || '', e.text, e.ms); });

/* ---------- Zustand aus dem Maschinenraum ---------- */
function setzeAkt(a: Akt) {
  if (a === akt) return;
  const vor = akt; akt = a; document.body.dataset.stage = a;
  if (a === 'count') {
    const ring = $('ring'); ring.style.transition = 'none'; ring.style.strokeDashoffset = '817'; void ring.getBoundingClientRect(); ring.style.transition = 'stroke-dashoffset 3s linear'; ring.style.strokeDashoffset = '0';
  }
  if (a !== 'lobby') blatt(null);
  if (a === 'done') ergebnis();
  if (a !== 'lobby' && sicht !== 'lobby') setzeSicht('lobby');
  if (a === 'lobby' && vor === 'done') ladeRunden().then(i => { pick = i; rev = false; baueKarten(); fuelleLobby(); zeige(pick); });
}
let cntVor = 0;
W.aufZustand((n: Zustand) => {
  z = n; zZeit = performance.now();
  /* Runde, die gerade läuft (auch nach einem Neustart der Bühne mitten in der Fahrt) */
  if (n.streckeId && (!aktRt || aktRt.id !== n.streckeId || aktRt.rev !== n.rev)) {
    const i = runden.findIndex(r => r.st.id === n.streckeId), r = i >= 0 ? runden[i] : testR && testR.st.id === n.streckeId ? testR : null;
    if (r) {
      const neu = i !== pick || !aktRt || rev !== n.rev; rev = n.rev;
      if (i >= 0 && neu) { pick = i; baueKarten(); fuelleLobby(); }
      if (neu || i < 0 || weltVon !== 'r') { welt.strecke(rtVon(r), r.seed); weltVon = 'r'; }
      aktRt = rtVon(r); const a = anstiege(aktRt).sort((x, y) => y.gain - x.gain)[0]; haupt = a ? { s: a.s, top: a.top } : null; $('rName').textContent = aktRt.name;
    }
  }
  if (!n.streckeId) aktRt = null;
  setzeAkt(n.phase === 'done' && !n.ergebnis ? 'lobby' : n.phase);
  if (n.phase === 'done' && n.ergebnis && n.ergebnis.id && n.ergebnis.id !== resId) { resId = n.ergebnis.id; stravaMarke(n.ergebnis.strava); saisonZeile(); }
  if (n.phase === 'count') { const c = Math.max(1, Math.ceil(n.count)); if (c !== cntVor) { cntVor = c; const e = $('cnt'); e.textContent = String(c); e.classList.remove('t'); void e.offsetWidth; e.classList.add('t'); } } else cntVor = 0;
  document.body.classList.toggle('paused', n.phase === 'ride' && n.pause);
  $('pauseT').textContent = n.auto ? 'Lostreten oder Leertaste' : 'Leertaste';
  geraete(n);
});
function geraete(n: Zustand) {
  const g = n.geraete, namen: [keyof typeof g, string, string][] = [['rolle', 'dRolle', 'Rolle'], ['puls', 'dPuls', 'Puls'], ['kadenz', 'dKadenz', 'Kadenz']];
  for (const [k, id] of namen) $(id).className = g[k] === 'an' ? 'an' : g[k] === 'sucht' ? 'sucht' : '';
  const an = namen.filter(x => g[x[0]] === 'an').map(x => x[2]);
  $('devT').textContent = g.rolle !== 'an' ? (gemerkt.rolle || g.rolle === 'sucht' ? 'Rolle wecken' : 'Rolle verbinden') : an.join(', ') + ' bereit';
  if (document.body.dataset.blatt === 'geraete') zeigeGeraete();
}
function ergebnis() {
  const e = z && z.ergebnis; if (!e) return;
  if (e.ftpTest !== undefined) {   // FTP-Test: die neue FTP groß, daneben die beste Minute
    const f = e.ftpTest; $('resL').textContent = 'FTP-Test'; $('resT').textContent = f ? fmt(f.ftp) + ' W' : zeit(e.zeit);
    $('resP').textContent = f ? `Beste Minute ${fmt(f.best)} W · vorher ${fmt(f.vorher)} W` : 'Zu kurz für ein Ergebnis';
    $('resSa').textContent = ''; $('resW').textContent = 'Ø ' + fmt(e.avgW) + ' W'; $('resK').textContent = zeit(e.zeit); $('resH').textContent = ''; $('resB').textContent = '';
    if (e.id && e.id !== resId) { resId = e.id; stravaMarke(e.strava); saisonZeile(); } else if (!e.id) { resId = null; stravaMarke(null); }
    return;
  }
  const a = e.abstand, gleich = a != null && Math.abs(a) < 1;
  $('resL').textContent = !e.ganz ? 'Runde beendet' : a == null ? 'Erste Zeit' : gleich ? 'Gleichauf' : a < 0 ? 'Neue Bestzeit' : 'Knapp dahinter';
  const t0 = performance.now(), el = $('resT');
  (function up() { const k = Math.min(1, (performance.now() - t0) / 1100); el.textContent = zeit(e.zeit * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(up); })();
  const sek = (n: number) => fmt(Math.abs(n)) + (Math.abs(Math.round(n)) === 1 ? ' Sekunde' : ' Sekunden');
  $('resP').textContent = !e.ganz ? `${fmt(e.km, 1)} km gefahren` : a == null || !e.rivale ? 'Ab jetzt dein Rivale auf dieser Runde' : gleich ? 'Kopf an Kopf mit dir vom ' + tag(e.rivale.start) : sek(a) + (a < 0 ? ' vor dir vom ' : ' hinter dir vom ') + tag(e.rivale.start);
  $('resSa').textContent = '';
  if (e.id && e.id !== resId) { resId = e.id; stravaMarke(e.strava); saisonZeile(); } else if (!e.id) { resId = null; stravaMarke(null); }
  $('resW').textContent = 'Ø ' + fmt(e.avgW) + ' W'; $('resK').textContent = e.ganz ? fmt(e.km, 1) + ' km' : ''; $('resH').textContent = e.hm ? fmt(e.hm) + ' Höhenmeter' : '';
  $('resB').textContent = e.bestzeiten ? (e.bestzeiten === 1 ? '1 Segment-Bestzeit' : e.bestzeiten + ' Segment-Bestzeiten') : '';
}

/* Ergebnisbild: was die Fahrt für die Saison gebracht hat (sobald sie gespeichert ist) */
async function saisonZeile() {
  const f = await W.fahrten(), heute = heuteTag(), teile: string[] = [];
  if (saison) { const p = tagesplan(saison, f, heute, ftp, true); teile.push(`Woche ${p.woche.nr}`, p.ist >= p.soll ? 'Wochenziel geschafft' : `Wochenziel zu ${Math.round(p.ist / Math.max(p.soll, 1) * 100)} %`); }
  else { const n = serie(f, heute); if (n >= 2) teile.push(`${n} Wochen in Folge`); }
  const m = meilensteine(f, 1)[0], letzte = f[f.length - 1];
  if (m && letzte && m.start === letzte.start) teile.push(m.text);
  $('resSa').textContent = teile.join(' · ');
}

/* ---------- Anzeige während der Fahrt ---------- */
function anzeige() {
  if (!z || !aktRt) return;
  const rt = aktRt, w = z.w, ok = 'var(--ok)', a = 'var(--a)', bad = 'var(--bad)';
  /* Watt: grün im Ziel, bernstein darunter, rot darüber */
  const lg = w == null ? 'ok' : lage(w, z.ziel), wc = w == null ? 'var(--fg2)' : lg === 'ok' ? ok : lg === 'drunter' ? a : bad, skala = Math.max(400, z.ftp * 2);
  $('watt').textContent = w == null ? '–' : String(Math.round(w)); $('arc').setAttribute('stroke-dasharray', (clamp((w || 0) / skala, 0, 1) * 688) + ' 917');
  $('watt').style.color = wc; $('arc').style.stroke = wc; $('zone').style.color = wc;
  $('tick').style.transformOrigin = '165px 165px'; $('tick').style.transform = `rotate(${135 + clamp(z.ziel / skala, 0, 1) * 270}deg)`;
  $('zone').textContent = w == null ? 'Rolle wecken' : (lg === 'ok' ? 'Im Ziel' : lg === 'drunter' ? 'Mehr Druck' : 'Zu viel') + ' · ' + zone(w, z.ftp);
  $('coachT').textContent = z.test ? `FTP-Test · Stufe ${z.test.stufe} · ${z.ziel} W` : (z.coach ? 'Coach · Ziel ' : 'Ziel ') + z.ziel + ' W' + (z.halten ? ' · hält' : '');
  $('coach').classList.toggle('on', z.coach); $('pm').classList.toggle('auto', z.coach);
  /* Tempo: hervorgehoben, wenn schnell */
  const kmh = z.v * 3.6; $('kmh').textContent = fmt(kmh, 1); $('kmh').style.color = kmh >= 38 ? a : kmh < 16 ? 'var(--fg2)' : 'var(--fg)';
  ($('kmh').nextElementSibling as HTMLElement).textContent = kmh >= 38 ? 'km/h · schnell' : 'km/h';
  const zahl = (id: string, v: number | null) => { const e = $(id); e.textContent = v == null ? '–' : String(Math.round(v)); e.classList.toggle('leer', v == null); };
  zahl('hr', z.hr); zahl('rpm', z.cad);
  /* Steigung: bernstein bergauf, rot steil bergauf, kühl bergab */
  const gr = z.grade, gc = gr >= 6 ? bad : gr >= 2.5 ? a : gr <= -2.5 ? 'var(--cool)' : 'var(--fg)';
  $('grade').textContent = fmt(Math.abs(gr), 1) + ' %'; $('grade').style.color = gc; $('gWord').style.color = gr >= 2.5 || gr <= -2.5 ? gc : 'var(--fg2)';
  $('gWord').textContent = gr >= 6 ? 'steil bergauf' : gr >= 1 ? 'bergauf' : gr <= -6 ? 'steil bergab' : gr <= -1 ? 'bergab' : 'flach';
  $('left').textContent = fmt(Math.max(0, rt.dist - z.s) / 1000, 1); $('up').textContent = fmt(z.up);
  $('clock').textContent = zeit(z.t); $('rProg').textContent = `${fmt(z.s / 1000, 1)} von ${fmt(rt.dist / 1000, 1)} km`;
  /* Rivale: Abstand in Sekunden, rot = er liegt vorn */
  const duel = $('duel'); duel.classList.toggle('leer', z.gap == null);
  if (z.gap != null && z.rivaleStart) {
    $('rWhen').textContent = tag(z.rivaleStart);
    const gap = z.gap, even = Math.abs(gap) < .5, g = $('gap'); g.textContent = even ? '0:00' : (gap > 0 ? '+' : '−') + zeit(Math.abs(gap)); g.style.color = even ? 'var(--fg)' : gap > 0 ? bad : ok;
    const off = clamp(-gap * 2.2, -42, 42); $('dMe').style.left = (50 + off / 2) + '%'; $('dGhost').style.left = (50 - off / 2) + '%';
  }
  profil($<HTMLCanvasElement>('prof'), rt, z.s / rt.dist, haupt);
}

/* ---------- Blätter: Geräte und Profil ---------- */
let gemerkt: Gemerkt = {}, sucheArt: string | null = null;
const ARTEN: ['rolle' | 'puls' | 'kadenz', string][] = [['rolle', 'Rolle'], ['puls', 'Puls'], ['kadenz', 'Kadenz']];
function zeigeGeraete() {
  const box = $('gRows'), g = z ? z.geraete : { rolle: 'aus', puls: 'aus', kadenz: 'aus' };
  box.innerHTML = '';
  for (const [art, name] of ARTEN) {
    const m = gemerkt[art], st = g[art], row = document.createElement('div'); row.className = 'gz';
    row.innerHTML = '<i></i><div><b></b><small></small></div><button type="button"></button>';
    row.children[0].className = st === 'an' ? 'an' : st === 'sucht' || sucheArt === art ? 'sucht' : '';
    row.querySelector('b')!.textContent = name;
    row.querySelector('small')!.textContent = st === 'an' ? (m && m.name) || 'verbunden' : sucheArt === art ? 'sucht' : m ? (m.name || 'gemerkt') + ' · aus' : '';
    const b = row.querySelector('button')!; b.textContent = m ? 'Vergessen' : sucheArt === art ? 'Abbrechen' : 'Verbinden'; b.dataset.art = art;
    b.hidden = !m && st === 'an';   // simulierte Geräte: nichts zu vergessen
    b.onclick = async () => {
      if (m) { gemerkt = await W.geraetVergessen(art); }
      else if (sucheArt === art) { sucheArt = null; W.geraetAbbruch(); $('gWahl').hidden = true; }
      else { sucheArt = art; $('gWahlT').textContent = name + ' wählen'; $('gListe').innerHTML = ''; $('gWahl').hidden = false; W.geraetSuche(art); }
      zeigeGeraete();
    };
    box.appendChild(row);
  }
}
W.aufGeraete(async g => {
  if (g.art !== sucheArt) return;
  if (!g.liste) { sucheArt = null; $('gWahl').hidden = true; zeigeGeraete(); return; }
  const box = $('gListe'); box.innerHTML = '';
  for (const d of g.liste) { const b = document.createElement('button'); b.type = 'button'; b.textContent = d.name; b.onclick = async () => { W.geraetWahl(d.id); sucheArt = null; $('gWahl').hidden = true; gemerkt = { ...gemerkt, [g.art]: d }; zeigeGeraete(); }; box.appendChild(b); }
});
function zeigeKonto(k: KontoStand) {
  $('kForm').hidden = k.an; $('kAn').hidden = !k.an;
  $('hmKonto').classList.toggle('on', k.an);
  if (k.an) { $('kWer').textContent = k.email || ''; $('kSt').textContent = k.busy ? 'gleicht ab' : k.err ? 'Abgleich wartet' : k.wartet ? `${k.wartet} wartet` : k.last ? 'abgeglichen ' + new Date(k.last).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''; }
}
W.aufKonto(zeigeKonto);
function zeigeStrava(s: StravaStand) {
  const an = !!s.connected; $('svWer').textContent = an ? (s.athlete && s.athlete.name) || 'verbunden' : '';
  const b = $<HTMLButtonElement>('svB'); b.textContent = an ? 'Trennen' : 'Verbinden'; b.classList.toggle('leer', an); b.disabled = false; b.dataset.an = an ? '1' : '';
  $('svMsg').textContent = s.ok === false ? s.error || '' : '';
  $('hmStrava').classList.toggle('on', an);
}
$('svB').onclick = async () => {
  const b = $<HTMLButtonElement>('svB');
  if (b.dataset.an) { zeigeStrava(await W.stravaTrennen()); return; }
  b.disabled = true; b.textContent = 'Im Browser bestätigen'; $('svMsg').textContent = '';
  const r = await W.stravaVerbinden(); zeigeStrava(r.ok ? r : { ...(await W.strava()), ok: false, error: r.error });
};
/* Ergebnisbild: ob die Fahrt zu Strava geht. Solange sie wartet, bricht ein Klick das Hochladen ab. */
let resId: string | null = null;
function stravaMarke(state: string | null | undefined) {
  const b = $<HTMLButtonElement>('resS'); b.hidden = !state; b.className = state === 'wartet' ? 'wartet' : ''; b.disabled = state !== 'wartet';
  b.textContent = state === 'wartet' ? 'geht gleich zu Strava' : state === 'ok' ? 'liegt bei Strava' : state === 'aus' ? 'nicht bei Strava' : state === 'laeuft' ? 'geht zu Strava' : 'Strava später';
}
$('resS').onclick = () => { if (resId) W.stravaAbbrechen(resId); };
W.aufStrava(x => { if (x.id === resId) stravaMarke(x.state); });
async function blatt(was: 'geraete' | 'profil' | null) {
  if (akt !== 'lobby') was = null;
  if (sucheArt && was !== 'geraete') { sucheArt = null; W.geraetAbbruch(); $('gWahl').hidden = true; }
  if (!was) { delete document.body.dataset.blatt; return; }
  if (was === 'geraete') { gemerkt = await W.geraete(); zeigeGeraete(); }
  else {
    const w = await W.werte() || {} as any;
    $<HTMLInputElement>('pFtp').value = String(w.ftp ?? ftp); $<HTMLInputElement>('pKg').value = String(w.weight ?? 75); $<HTMLInputElement>('pDiff').value = String(Math.round((w.diff ?? .5) * 100));
    zeigeKonto(await W.konto()); zeigeStrava(await W.strava());
  }
  document.body.dataset.blatt = was;
}
$('devB').onclick = () => blatt(document.body.dataset.blatt === 'geraete' ? null : 'geraete');
$('pTest').onclick = () => { blatt(null); W.befehl({ was: 'test' }); };
$('lvlB').onclick = () => blatt(document.body.dataset.blatt === 'profil' ? null : 'profil');
$('fdZu').onclick = () => oeffneFahrt('');
$('hmProfil').onclick = $('hmKonto').onclick = $('hmStrava').onclick = () => blatt('profil');
$('blatt').addEventListener('pointerdown', e => { if (e.target === $('blatt')) blatt(null); });
for (const [id, feld, mal] of [['pFtp', 'ftp', 1], ['pKg', 'weight', 1], ['pDiff', 'diff', .01]] as [string, string, number][])
  $<HTMLInputElement>(id).addEventListener('change', async e => { const v = +(e.target as HTMLInputElement).value; if (isFinite(v)) { await W.werteSetzen({ [feld]: v * mal } as any); neuLaden(); } });
$('kForm').addEventListener('submit', async e => {
  e.preventDefault(); const b = $('kForm').querySelector('button')!; b.disabled = true; $('kMsg').textContent = '';
  const r = await W.anmelden($<HTMLInputElement>('kMail').value, $<HTMLInputElement>('kPw').value); b.disabled = false;
  if (r.ok) { $<HTMLInputElement>('kPw').value = ''; zeigeKonto(r); } else $('kMsg').textContent = r.error || 'Anmeldung hat nicht geklappt';
});
$('kAus').onclick = async () => zeigeKonto(await W.abmelden());
/* Daten haben sich geändert (Konto hat Fahrten gebracht, Werte geändert): Lobby neu aufbauen, gewählte Runde bleibt */
let ladeT: ReturnType<typeof setTimeout> | null = null;
function neuLaden() {
  if (ladeT) clearTimeout(ladeT);
  ladeT = setTimeout(async () => {
    if (akt !== 'lobby') return;
    /* Die gewählte Runde bleibt, außer der Tag gibt jetzt eine andere vor (neue Saison, neuer Plan) */
    const vor = runden[pick] ? runden[pick].st.id : null, hVor = heuteId, n = runden.length, heute = await ladeRunden(), i = runden.findIndex(r => r.st.id === vor);
    pick = i >= 0 && heuteId === hVor ? i : heute; baueKarten(); fuelleLobby();
    if (!n || !runden[pick] || runden[pick].st.id !== vor) { rev = false; fuelleLobby(); zeige(pick); } else wahl(runden[pick]);
    if (sicht === 'rivalen') zeigeRivalen(); if (sicht === 'fahrten') zeigeFahrten();
    if (fhAuf) { if (!alleFahrten.some(f => f.id === fhAuf)) oeffneFahrt(''); else if (weltVon !== 'f' + fhAuf) weltZurFahrt(); }
  }, 300);
}
W.aufDaten(neuLaden);

/* ---------- Bereiche: Rivalen und Fahrten ---------- */
type Sicht = 'start' | 'lobby' | 'rivalen' | 'fahrten';
let sicht: Sicht = 'start';
function setzeSicht(x: Sicht) {
  if (x !== 'fahrten' && fhAuf) oeffneFahrt('');
  sicht = x; document.body.dataset.sicht = x; blatt(null);
  document.querySelectorAll<HTMLElement>('nav button').forEach(b => b.classList.toggle('on', b.dataset.s === x));
  if (x === 'rivalen') zeigeRivalen(); if (x === 'fahrten') zeigeFahrten();
}
document.querySelectorAll<HTMLElement>('nav button').forEach(b => { b.onclick = () => { if (akt === 'lobby') setzeSicht(b.dataset.s as Sicht); }; });
const datum = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: '2-digit' });
/* Rivalen: die Segmente der gewählten Runde (ganze Runde und Anstiege) mit Bestzeit; ein Klick zeigt die Versuche */
let rvFuer = '', rvAuf = '';
async function zeigeRivalen() {
  const r = runden[pick]; if (!r) return;
  $('rvName').textContent = r.st.name + (rev && !r.st.test ? ' (umgekehrt)' : ''); ($('rvWeg') as HTMLButtonElement).textContent = 'Runde entfernen'; $('rvWeg').dataset.sicher = '';
  const fuer = r.st.id; rvFuer = fuer;
  const laeufe = await W.laeufe(r.st.id, rev && !r.st.test); if (rvFuer !== fuer || sicht !== 'rivalen') return;
  const box = $('rvListe'); box.innerHTML = '';
  for (const seg of segmente(rtVon(r))) {
    const v = versuche(seg, laeufe), b = document.createElement('button'); b.className = 'rv' + (rvAuf === seg.id ? ' auf' : ''); b.type = 'button';
    b.innerHTML = '<b></b><span class="z"></span><span class="d"></span><span class="n"></span>';
    const titel = b.children[0] as HTMLElement; titel.textContent = seg.art === 'runde' ? 'Ganze Runde' : `Anstieg km ${fmt(seg.von / 1000, 1)}`;
    if (seg.art === 'anstieg') { const k = document.createElement('small'); k.textContent = `${fmt(seg.len / 1000, 1)} km · ${fmt(seg.g, 1)} %`; titel.appendChild(k); }
    b.children[1].textContent = v.length ? zeit(v[0].zeit) : '–'; b.children[2].textContent = v.length ? datum(v[0].start) : ''; b.children[3].textContent = v.length ? v.length + '×' : '';
    b.onclick = () => { rvAuf = rvAuf === seg.id ? '' : seg.id; zeigeRivalen(); };
    box.appendChild(b);
    if (rvAuf === seg.id && v.length) {
      const l = document.createElement('div'); l.className = 'vs';
      for (const x of v.slice(0, 8)) { const z = document.createElement('div'); z.innerHTML = '<span></span><span></span><span></span><span></span>'; z.children[0].textContent = datum(x.start); z.children[1].textContent = zeit(x.zeit); z.children[2].textContent = x === v[0] ? 'Bestzeit' : '+' + zeit(x.zeit - v[0].zeit); l.appendChild(z); }
      box.appendChild(l);
    }
  }
}
/* Runde entfernen: erster Klick fragt, zweiter entfernt (nur hier auf dem Gerät) */
$('rvWeg').onclick = async () => {
  const b = $('rvWeg'), r = runden[pick]; if (!r) return;
  if (!b.dataset.sicher) { b.dataset.sicher = '1'; b.textContent = 'Wirklich entfernen'; setTimeout(() => { if (b.dataset.sicher) { b.dataset.sicher = ''; b.textContent = 'Runde entfernen'; } }, 3000); return; }
  b.dataset.sicher = ''; await W.streckeWeg(r.st.id);
};
/* Fahrten: alle Fahrten, neueste zuerst, nach Monat. Draußen-Fahrten aus Strava lassen sich als Strecke anlegen,
   jede Fahrt lässt sich löschen (erster Klick fragt, zweiter löscht). */
let loFrage = '', loT = 0;
/* Fahrt ansehen: ein Klick auf die Zeile zeigt rechts ihre Zahlen und dahinter ihre Welt. Gibt es die Strecke, ist es
   deren Welt; sonst wird aus Höhe über Strecke eine Schleife erzeugt (die Höhen sind echt, der Weg nicht). */
let fhAuf = '', fhDet: FahrtDetail | null = null;
async function oeffneFahrt(id: string) {
  fhAuf = id;
  if (!id) { fhDet = null; delete document.body.dataset.fahrt; $('fhDetail').hidden = true; if (sicht === 'fahrten') zeigeFahrten(); if (weltVon !== 'r' && runden[pick]) blende(() => zeige(pick)); return; }
  const d = await W.fahrtDetail(id); if (fhAuf !== id) return; if (!d) { oeffneFahrt(''); return; }
  fhDet = d; document.body.dataset.fahrt = '1'; zeigeFahrten(); zeigeDetail(); weltZurFahrt();
}
function weltZurFahrt() {
  const f = alleFahrten.find(x => x.id === fhAuf), d = fhDet; if (!f || !d) return;
  const r = (f.routeId ? runden.find(x => x.st.id === f.routeId) || (testR && testR.st.id === f.routeId ? testR : null) : null) || (f.stravaId ? runden.find(x => x.st.id === 'sr' + f.stravaId) : null) || null;
  let rt: Bahn | null = null, seed = seedOf(f.id);
  if (r) { rt = f.rev && !r.st.test ? bahn(r.st, true) : r.rt; seed = r.seed; }
  else if (d.hoehe) { const st = ausFahrt(f.name, d.hoehe, seed); if (st) rt = bahn(st); }
  if (!rt) { if (weltVon !== 'r' && runden[pick]) blende(() => zeige(pick)); return; }
  const id = f.id, bahnF = rt; blende(() => { if (fhAuf !== id) return; welt.strecke(bahnF, seed); weltVon = 'f' + id; });
}
function zeigeDetail() {
  const d = fhDet, f = alleFahrten.find(x => x.id === fhAuf); $('fhDetail').hidden = !d || !f; if (!d || !f) return;
  $('fdL').textContent = new Date(d.start).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (f.draussen ? ' · draußen' : f.rolle ? ' · Rolle' : '');
  $('fdName').textContent = d.name;
  const n = (x: number | null, st = 0) => x ? fmt(x, st) : null;
  type Z = [string, string, string | null];
  const fuelle = (id: string, zz: Z[]) => { const box = $(id); box.innerHTML = ''; for (const [k, l, v] of zz) if (v) { const e = document.createElement('span'), bb = document.createElement('b'); bb.textContent = v; bb.dataset.k = k; e.append(bb, l); box.appendChild(e); } return box.children.length; };
  fuelle('fdH', [['zeit', 'Fahrzeit', zeit(d.dauer)], ['km', 'km', n(d.km, 1)], ['watt', d.geschaetzt ? 'Watt geschätzt' : 'Watt im Schnitt', n(d.avgW)], ['punkte', 'Punkte', n(d.tss)]]);
  fuelle('fdZ', [['np', 'Watt gewichtet', n(d.np)], ['anteil', '% der FTP', n(d.anteil)], ['kj', 'Kilojoule', n(d.kj)], ['max', 'Watt maximal', n(d.maxW)], ['kmh', 'km/h', n(d.kmh, 1)], ['hm', 'Höhenmeter', n(d.hm)]]);
  $('fdKoerperC').hidden = !fuelle('fdK', [['hr', 'Puls', n(d.hr)], ['hrMax', 'Puls maximal', n(d.hrMax)], ['cad', 'Kadenz', n(d.cad)]]);
  /* Bestwerte als Balken; die 20 Minuten grün, wenn sie an die FTP der Fahrt heranreichen */
  const B: [string, string, number | null][] = [['b5', '5 s', d.b5], ['b60', '1 min', d.b60], ['b300', '5 min', d.b300], ['b1200', '20 min', d.b1200]], hi = Math.max(1, ...B.map(x => x[2] || 0)), bb = $('fdBest'); bb.innerHTML = '';
  for (const [k, l, v] of B) if (v) {
    const e = document.createElement('div'); e.className = 'bw' + (k === 'b1200' && v >= d.ftp * .95 ? ' gut' : ''); e.innerHTML = '<span></span><i class="weg"><i></i></i><b></b>';
    e.children[0].textContent = l; (e.children[1].firstChild as HTMLElement).style.width = (v / hi * 100).toFixed(1) + '%'; e.children[2].textContent = `${fmt(v)} W`; (e.children[2] as HTMLElement).dataset.k = k; bb.appendChild(e);
  }
  $('fdBestC').hidden = !bb.children.length;
  $('fdKurveC').hidden = d.kurve.length < 2; if (d.kurve.length >= 2) leistung($<HTMLCanvasElement>('fdKurve'), d.kurve, d.avgW || 0, d.ftp);
  const hz = d.hoehe && d.hoehe.some(x => Math.abs(x[1] - d.hoehe![0][1]) > 3) ? d.hoehe : null;
  $('fdHoeheC').hidden = !hz; if (hz) flaeche($<HTMLCanvasElement>('fdHoehe'), hz.map(x => x[1]), Math.min(...hz.map(x => x[1])), 30, 'rgba(246,240,230,.12)', '#F3B56B');
}
/* Fläche mit Linie darüber */
function flaeche(cv: HTMLCanvasElement, v: number[], lo: number, spanne: number, fuell: string | CanvasGradient, farbe: string) {
  const g = cv.getContext('2d')!, Wd = cv.width, H = cv.height, hi = Math.max(lo + spanne, ...v), n = v.length - 1;
  const X = (i: number) => i / n * Wd, Y = (x: number) => H - 6 - (H - 22) * (x - lo) / (hi - lo);
  g.clearRect(0, 0, Wd, H); g.beginPath(); g.moveTo(0, H); v.forEach((x, i) => g.lineTo(X(i), Y(x))); g.lineTo(Wd, H); g.closePath(); g.fillStyle = fuell; g.fill();
  g.beginPath(); v.forEach((x, i) => i ? g.lineTo(X(i), Y(x)) : g.moveTo(X(i), Y(x))); g.strokeStyle = farbe; g.lineWidth = 3.5; g.lineJoin = g.lineCap = 'round'; g.stroke();
  return Y;
}
/* Leistung über die Fahrt: Fläche, dazu der Schnitt (hell) und die FTP (gestrichelt) */
function leistung(cv: HTMLCanvasElement, v: number[], schnitt: number, ftpF: number) {
  const g = cv.getContext('2d')!, Wd = cv.width, H = cv.height, gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(243,181,107,.5)'); gr.addColorStop(1, 'rgba(243,181,107,.04)');
  const Y = flaeche(cv, v, 0, Math.max(ftpF * 1.08, 50), gr, '#F3B56B');
  g.font = '600 22px Manrope, sans-serif'; g.textBaseline = 'bottom'; g.lineWidth = 2;
  const linie = (w: number, t: string, farbe: string, strich: number[], rechts: boolean) => { if (!(w > 0)) return; const y = Y(w); g.setLineDash(strich); g.strokeStyle = farbe; g.beginPath(); g.moveTo(0, y); g.lineTo(Wd, y); g.stroke(); g.setLineDash([]); g.fillStyle = farbe; g.textAlign = rechts ? 'right' : 'left'; g.fillText(t, rechts ? Wd - 8 : 8, y - 5); };
  linie(ftpF, `FTP ${fmt(ftpF)} W`, 'rgba(246,240,230,.55)', [10, 10], true); linie(schnitt, `Schnitt ${fmt(schnitt)} W`, '#F6F0E6', [], false);
}
function zeigeFahrten() {
  const box = $('fhListe'); box.innerHTML = ''; let mon = '';
  const liste = alleFahrten.slice().sort((a, b) => b.start.localeCompare(a.start));
  if (!liste.length) { const p = document.createElement('p'); p.className = 'leer'; p.textContent = 'Noch keine Fahrt'; box.appendChild(p); return; }
  for (const f of liste) {
    const m = new Date(f.start).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    if (m !== mon) { mon = m; const h = document.createElement('div'); h.className = 'mon'; h.textContent = m; box.appendChild(h); }
    const row = document.createElement('div'); row.className = 'fh' + (fhAuf === f.id ? ' on' : ''); row.onclick = e => { if (!(e.target as HTMLElement).closest('button')) oeffneFahrt(fhAuf === f.id ? '' : f.id); }; row.innerHTML = '<span></span><b></b><span></span><span></span><span></span>';
    row.children[0].textContent = new Date(f.start).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }); row.children[1].textContent = f.name;
    row.children[2].textContent = f.km ? fmt(f.km, 1) + ' km' : ''; row.children[3].textContent = zeit(f.zeit); row.children[4].textContent = f.avgW ? fmt(f.avgW) + ' W' : '';
    if (f.draussen && f.stravaId) {
      const da = runden.some(r => r.st.id === 'sr' + f.stravaId), b = document.createElement('button'); b.type = 'button'; b.textContent = da ? 'ist Strecke' : 'Als Strecke'; b.disabled = da;
      b.onclick = async () => { b.disabled = true; b.textContent = 'holt'; const r = await W.alsStrecke(f.id); b.textContent = r.ok ? 'ist Strecke' : 'geht nicht'; };
      row.appendChild(b);
    } else { const e = document.createElement('em'); e.textContent = f.draussen ? 'draußen' : f.rolle ? '' : 'Strava'; row.appendChild(e); }
    {
      /* die Rückfrage merkt sich die Liste selbst: sie baut sich bei jeder Änderung der Daten neu auf */
      const b = document.createElement('button'), fragt = loFrage === f.id; b.type = 'button'; b.className = 'lo'; b.textContent = fragt ? 'Wirklich?' : 'Löschen'; if (fragt) b.dataset.sicher = '1';
      b.onclick = async () => {
        if (loFrage !== f.id) { loFrage = f.id; clearTimeout(loT); loT = window.setTimeout(() => { loFrage = ''; if (sicht === 'fahrten') zeigeFahrten(); }, 3000); zeigeFahrten(); return; }
        loFrage = ''; clearTimeout(loT); b.disabled = true; await W.fahrtLoeschen(f.id);
      };
      row.appendChild(b);
    }
    box.appendChild(row);
  }
}

/* ---------- Saison und Fortschritt ---------- */
const tagLang = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
let saEdit = false;
const hMin = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
function zeigeSaison() {
  const heute = heuteTag(), F = form(alleFahrten, heute), s = saison, p = plan;
  if (!s) saEdit = false;
  $('saNeu').hidden = !!s && !saEdit; $('saLauf').hidden = !s || saEdit; $('saAend').hidden = !s || saEdit;
  $('saEnde').hidden = $('saAb').hidden = !s; $('saOk').textContent = s ? 'Speichern' : 'Saison starten'; $('saNeuT').textContent = s ? 'Ziel ändern' : 'Dein Ziel';
  $('saL').textContent = s && p ? `Saison · Woche ${p.woche.nr} von ${p.wochen}${p.woche.art === 'ruhe' ? ' · ruhige Woche' : p.woche.art === 'ziel' ? ' · Zielwoche' : ''}` : 'Saison';
  if (s && p && !saEdit) {
    const eh = s.art === 'ftp' ? 'W' : 'km', rest = tagAus(s.bis) - heute, fo = fortschritt(s, alleFahrten, ftp);
    $('saZielT').textContent = `${fmt(s.ziel)} ${eh} bis ${tagLang(s.bis)}`;
    $('saRest').textContent = rest > 1 ? `noch ${rest} Tage` : rest === 1 ? 'morgen' : rest === 0 ? 'heute' : 'vorbei';
    $('saFort').textContent = `${fmt(fo.jetzt)} von ${fmt(s.ziel)} ${eh}`; $('saFort').classList.toggle('gut', fo.anteil >= 1); $('saFortB').style.width = (fo.anteil * 100).toFixed(1) + '%';
    $('saHeute').textContent = p.art === 'frei' ? (p.erledigt ? 'Geschafft' : 'Frei') : `${ART[p.art].name} · ${p.minuten} min · ${p.watt} W`; $('saHeute').classList.toggle('gut', p.erledigt);
    $('saWoche').textContent = `${p.fahrtenIst} von ${p.fahrtenSoll} Fahrten`; $('saWoche').classList.toggle('gut', p.ist >= p.soll * .95);
    $('saWocheB').style.width = (clamp(p.ist / Math.max(p.soll, 1), 0, 1) * 100).toFixed(1) + '%';
    /* die Woche zum Abarbeiten */
    const P = wochenplan(s, alleFahrten, heute, ftp, true), WT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], box = $('saTage'); box.innerHTML = '';
    let ist = 0, offen = 0;
    P.forEach((d, i) => {
      if (d.gefahren) ist += d.minuten; else offen += d.minuten;
      const e = document.createElement('div'); e.className = 'tg' + (d.heute ? ' heute' : '') + (d.gefahren ? ' fertig' : d.minuten ? '' : ' frei'); e.innerHTML = '<span></span><b></b><small></small>';
      e.children[0].textContent = WT[i];
      e.children[1].textContent = d.gefahren ? (d.km >= 1 ? `${fmt(d.km)} km` : `${d.minuten} min`) : d.minuten ? `${d.minuten} min` : '–';
      e.children[2].textContent = d.gefahren ? `${hMin(d.minuten)} h` : d.minuten ? (d.art === 'test' ? 'FTP-Test' : `${ART[d.art].name} · ${d.watt} W`) : d.tag < heute ? '' : 'frei';
      box.appendChild(e);
    });
    $('saStd').textContent = `${hMin(ist)} von ${hMin(ist + offen)} h`;
    weg(s, heute);
  } else if (!s && !$<HTMLInputElement>('saBis').value) saisonVorgabe();
  const v = F.verlauf, trend = v[v.length - 1] - v[v.length - 15];
  $('saForm').textContent = alleFahrten.length ? `${formWort(F.form)[0].toUpperCase()}${formWort(F.form).slice(1)} · ${trend > 1 ? 'steigt' : trend < -1 ? 'sinkt' : 'hält'}` : '–'; $('saForm').classList.toggle('gut', trend > 1);
  kurve($<HTMLCanvasElement>('saKurve'), v, trend > 1 ? '#8FD9B0' : '#F3B56B');
  const n = serie(alleFahrten, heute); $('saSerie').textContent = n ? `${n} ${n === 1 ? 'Woche' : 'Wochen'} in Folge` : '–'; $('saSerie').classList.toggle('gut', n >= 2);
  $('saFtpZ').hidden = !(s && s.art === 'ftp');
  $('saFtp').textContent = s && s.art === 'ftp' ? `${fmt(ftp)} von ${fmt(s.ziel)} W` : `${fmt(ftp)} W`;
  /* Meilensteine als Marken, die der letzten Woche grün */
  const box = $('saGesch'); box.innerHTML = '';
  for (const m of meilensteine(alleFahrten)) {
    const [l, w] = m.text.includes(': ') ? m.text.split(': ') : ['Fahrten', m.text], d = document.createElement('div');
    d.className = 'ms' + (heute - tagNr(m.start) <= 7 ? ' neu' : ''); d.innerHTML = '<small></small><b></b><span></span>'; d.children[0].textContent = l; d.children[1].textContent = w; d.children[2].textContent = datum(m.start); box.appendChild(d);
  }
  $('saGeschL').hidden = !box.children.length;
}
/* Die Wochen der Saison als Balken: Höhe = Pensum in Stunden. Vergangene Wochen sind so weit gefüllt, wie sie
   geschafft wurden (grün ab vier Fünfteln), die laufende ist hell umrandet, darüber ihr Pensum. */
function weg(s: Saison, heute: number) {
  const cv = $<HTMLCanvasElement>('saWeg'), g = cv.getContext('2d')!, Wd = cv.width, H = cv.height, Wo = wochen(s), n = Wo.length;
  g.clearRect(0, 0, Wd, H);
  const hi = Math.max(...Wo.map(w => w.soll)), bw = (Wd - 8) / n, lu = Math.min(14, bw * .18), unten = H - 34, hoch = unten - 44;
  const jetzt = clamp(Math.floor((heute - Wo[0].mo) / 7), 0, n - 1);
  g.textAlign = 'center'; g.textBaseline = 'top'; g.font = '600 22px Manrope, sans-serif';
  Wo.forEach((w, i) => {
    const x = 4 + i * bw + lu / 2, b = bw - lu, h = Math.max(8, hoch * w.soll / hi), y = unten - h, r = Math.min(8, b / 2);
    g.fillStyle = i > jetzt ? 'rgba(246,240,230,.13)' : 'rgba(246,240,230,.2)'; g.beginPath(); g.roundRect(x, y, b, h, r); g.fill();
    if (i <= jetzt) {
      const a = clamp(wocheIst(alleFahrten, w.mo).punkte / Math.max(w.soll, 1), 0, 1);
      if (a > 0) { g.save(); g.beginPath(); g.roundRect(x, y, b, h, r); g.clip(); g.fillStyle = a >= .8 ? '#8FD9B0' : '#F3B56B'; g.fillRect(x, unten - h * a, b, h * a); g.restore(); }
    }
    if (i === jetzt) { g.strokeStyle = '#F6F0E6'; g.lineWidth = 3; g.beginPath(); g.roundRect(x, y, b, h, r); g.stroke(); g.fillStyle = '#F6F0E6'; g.textBaseline = 'bottom'; g.fillText(`${hMin(stundenVon(w.soll) * 60)} h`, clamp(x + b / 2, 44, Wd - 44), y - 8); g.textBaseline = 'top'; }
    if (n <= 30 || i % 4 === 0 || i === n - 1) { g.fillStyle = i === jetzt ? '#F6F0E6' : w.art === 'ruhe' ? 'rgba(207,198,210,.55)' : '#CFC6D2'; g.fillText(String(w.nr), x + b / 2, unten + 8); }
  });
}
function kurve(cv: HTMLCanvasElement, v: number[], farbe = '#F3B56B') {
  const g = cv.getContext('2d')!, Wd = cv.width, H = cv.height, hi = Math.max(10, ...v), lo = Math.min(...v);
  g.clearRect(0, 0, Wd, H); g.beginPath();
  v.forEach((x, i) => { const px = 3 + (Wd - 6) * i / (v.length - 1), py = H - 5 - (H - 10) * (x - lo) / Math.max(hi - lo, 5); i ? g.lineTo(px, py) : g.moveTo(px, py); });
  g.strokeStyle = farbe; g.lineWidth = 3.5; g.lineJoin = g.lineCap = 'round'; g.stroke();
}
/* Neues Ziel: Vorgabe ist eine FTP gut 8 % über der jetzigen in zwölf Wochen, bei der Tour 100 km */
let saArt: 'ftp' | 'tour' = 'ftp';
function saisonVorgabe() {
  $<HTMLInputElement>('saZiel').value = String(saArt === 'ftp' ? Math.round(ftp * 1.08 / 5) * 5 : 100);
  $('saZielL').textContent = saArt === 'ftp' ? 'FTP' : 'Strecke'; $('saEinh').textContent = saArt === 'ftp' ? 'W' : 'km';
  $<HTMLInputElement>('saBis').value = isoTag(heuteTag() + 84); $<HTMLInputElement>('saBis').min = isoTag(heuteTag() + 7);
}
document.querySelectorAll<HTMLElement>('#saArt button').forEach(b => { b.onclick = () => { saArt = b.dataset.art as 'ftp' | 'tour'; document.querySelectorAll('#saArt button').forEach(x => x.classList.toggle('on', x === b)); saisonVorgabe(); }; });
$('saNeu').addEventListener('submit', async e => {
  e.preventDefault(); const ziel = +$<HTMLInputElement>('saZiel').value, bis = $<HTMLInputElement>('saBis').value, heute = heuteTag();
  if (!(ziel > 0) || !bis || tagAus(bis) <= heute) return;
  /* ein neues Ziel beginnt heute; ein geändertes behält seinen Anfang */
  saison = await W.saisonSetzen(saison ? { ...saison, art: saArt, ziel, bis } : { art: saArt, ziel, bis, von: isoTag(heute), ftp0: ftp, last0: Math.round(gewohnt(alleFahrten, heute)) });
  saEdit = false; neuLaden();
});
$('saAend').onclick = () => {
  const s = saison; if (!s) return;
  saEdit = true; saArt = s.art; document.querySelectorAll<HTMLElement>('#saArt button').forEach(x => x.classList.toggle('on', x.dataset.art === s.art));
  $('saZielL').textContent = s.art === 'ftp' ? 'FTP' : 'Strecke'; $('saEinh').textContent = s.art === 'ftp' ? 'W' : 'km';
  $<HTMLInputElement>('saZiel').value = String(s.ziel); $<HTMLInputElement>('saBis').value = s.bis; $<HTMLInputElement>('saBis').min = isoTag(heuteTag() + 1);
  zeigeSaison();
};
$('saAb').onclick = () => { saEdit = false; zeigeSaison(); };
/* Saison beenden: erster Klick fragt, zweiter beendet */
$('saEnde').onclick = async () => {
  const b = $('saEnde');
  if (!b.dataset.sicher) { b.dataset.sicher = '1'; b.textContent = 'Wirklich beenden'; setTimeout(() => { if (b.dataset.sicher) { b.dataset.sicher = ''; b.textContent = 'Saison beenden'; } }, 3000); return; }
  b.dataset.sicher = ''; b.textContent = 'Saison beenden'; $<HTMLInputElement>('saBis').value = ''; saEdit = false; saison = await W.saisonSetzen(null); neuLaden();
};

/* ---------- Bedienung ---------- */
$('start').onclick = $('startH').onclick = start; $('end').onclick = () => W.befehl({ was: 'ende' }); $('home').onclick = () => W.befehl({ was: 'lobby' });
$('coach').onclick = $('wbtn').onclick = () => W.befehl({ was: 'coach' });
$('less').onclick = () => W.befehl({ was: 'stufe', d: -10 }); $('more').onclick = () => W.befehl({ was: 'stufe', d: 10 });
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey) return;
  if (document.body.dataset.blatt) { if (e.key === 'Escape') blatt(null); return; }   // im Blatt gehören die Tasten den Feldern
  if ((e.target as HTMLElement).closest?.('input') && e.key !== 'Escape') return;   // in einem Feld gehören die Tasten dem Feld
  if (e.key === 'ArrowUp' && akt === 'ride') { W.befehl({ was: 'stufe', d: 10 }); e.preventDefault(); }
  else if (e.key === 'ArrowDown' && akt === 'ride') { W.befehl({ was: 'stufe', d: -10 }); e.preventDefault(); }
  else if (e.key === 'Enter' && akt === 'lobby' && (sicht === 'lobby' || sicht === 'start')) start();
  else if (e.key === 'Enter' && akt === 'done') W.befehl({ was: 'lobby' });
  else if (e.key === 'ArrowRight' && akt === 'lobby' && (sicht === 'lobby' || sicht === 'rivalen' || sicht === 'start')) waehle(pick + 1);
  else if (e.key === 'ArrowLeft' && akt === 'lobby' && (sicht === 'lobby' || sicht === 'rivalen' || sicht === 'start')) waehle(pick - 1);
  else if (e.key === 'Escape' && sicht === 'fahrten' && fhAuf) oeffneFahrt('');
  else if (e.key === 'Escape' && akt === 'lobby' && sicht !== 'lobby' && sicht !== 'start') setzeSicht('lobby');
  else if (e.key === ' ' && akt === 'ride') { W.befehl({ was: 'pause' }); e.preventDefault(); }
  else if (e.key === 'c' && akt === 'ride') W.befehl({ was: 'coach' });
  else if (e.key === 'h' && akt === 'ride') W.befehl({ was: 'halten' });
  else if (e.key === 'Escape' && akt === 'count') W.befehl({ was: 'abbruch' });
});
function groesse() { const pc = $<HTMLCanvasElement>('prof'), pr = Math.min(devicePixelRatio || 1, 2); pc.width = Math.max(200, Math.round((innerWidth - 80) * pr)); pc.height = Math.round(44 * pr); welt.groesse(); }
addEventListener('resize', groesse);
W.aufVollbild(v => document.body.classList.toggle('voll', v));
W.geraete().then(g => { gemerkt = g; });

/* ---------- Schleife ---------- */
let vor = performance.now(), hudT = 0, sZeig = 0, sVor = 0, vZeig = 0, ruck = 0, gZeig = 0, gv = 0, gvRoh = 0, gLetzt = 0, gT = 0;
function bild() {
  const now = performance.now(), dt = Math.min((now - vor) / 1000, .05), echt = (now - vor) / 1000; vor = now;
  try {
    if (z && runden.length) {
      /* Die Stelle des Fahrers läuft hier jedes Bild mit seinem Tempo weiter und wird nur sanft an die Meldungen des
         Maschinenraums (zehnmal pro Sekunde) herangezogen. So fährt er gleichmäßig statt in kleinen Sprüngen. */
      const fahr = z.phase === 'ride' && !z.pause, soll = fahr ? z.s + z.v * Math.min((now - zZeit) / 1000, .5) : z.s;
      vZeig = lerp(vZeig, z.v, 1 - Math.exp(-dt * 4));
      if (!fahr || Math.abs(soll - sZeig) > 30) sZeig = soll;
      else { const vorS = sZeig; sZeig += vZeig * dt; sZeig += (soll - sZeig) * (1 - Math.exp(-dt * 1.5)); if (sZeig < vorS) sZeig = vorS; }
      ruck = Math.max(ruck * .995, fahr && dt > 0 ? Math.abs((sZeig - sVor) / dt - vZeig) : 0); sVor = sZeig;
      if (z.gs != null) { const g = z.gs; if (!fahr || Math.abs(g - gZeig) > 30) { gZeig = g; gv = 0; } else { gv = lerp(gv, clamp((g - gZeig) / .35 + gvRoh, 0, 25), 1 - Math.exp(-dt * 3)); gZeig += gv * dt; } if (g !== gLetzt) { gvRoh = clamp((g - gLetzt) / Math.max((now - gT) / 1000, .05), 0, 25); gLetzt = g; gT = now; } }
      welt.bild(echt > .25 ? dt : echt, { akt, s: sZeig, v: vZeig, cad: z.cad, grade: z.grade, gs: z.gs == null ? null : gZeig, gv: clamp(gv, 0, 25), pause: z.pause, maus });
      hudT += dt; if (akt === 'ride' && hudT > .12) { hudT = 0; anzeige(); }
    }
  } catch (err) { console.error(err); }   // ein Fehler in der Grafik darf die Schleife nicht beenden
  requestAnimationFrame(bild);
}

ladeRunden().then(i => {
  pick = i; baueKarten(); fuelleLobby(); groesse();
  if (runden.length) { zeige(pick); welt.einflug(); }
  W.bereit(); W.konto().then(zeigeKonto); W.strava().then(zeigeStrava);
  setTimeout(() => { $('flash').classList.remove('on'); setTimeout(() => $('flash').style.transitionDuration = '', 1500); }, 200);
  (window as any).__wb = { get akt() { return akt; }, get z() { return z; }, get welt() { return welt.stand; }, get runden() { return runden.map(r => r.st.id); }, get ruck() { return ruck; }, get weltVon() { return weltVon; } };
  bild();
});
