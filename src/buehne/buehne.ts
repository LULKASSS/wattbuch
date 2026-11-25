/* Bühne: das sichtbare Fenster. Zeigt die Welt und die Anzeige und schickt Befehle an den Maschinenraum.
   Hier wird nichts aufgenommen und nichts gerechnet, was die Fahrt ausmacht: Hängt die Grafik, läuft die Fahrt weiter. */
import '../stil.css';
import type { Strecke, FahrtKurz, Zustand, Ereignis } from '../kern/typen';
import { bahn, anstiege, fahrzeit, type Bahn } from '../kern/strecke';
import { grundleistung, lage, zone } from '../kern/coach';
import { fmt, zeit, tag } from '../kern/format';
import { segmente, versuche } from '../kern/segmente';
import { Welt, type Akt } from './welt/welt';
import type { KontoStand, Gemerkt, StravaStand } from '../bruecke';

const W = window.wattbuch;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Runde { st: Strecke; rt: Bahn; best: FahrtKurz | null; zuletzt: string | null; tag: string; min: number; seed: number }
let runden: Runde[] = [], alleFahrten: FahrtKurz[] = [], pick = 0, ftp = 200, gewicht = 84;
let z: Zustand | null = null, zZeit = 0, akt: Akt = 'lobby', aktRt: Bahn | null = null, haupt: { s: number; top: number } | null = null;
const welt = new Welt($<HTMLCanvasElement>('gl'));
const maus: [number, number] = [0, 0];
addEventListener('pointermove', e => { maus[0] = e.clientX / innerWidth - .5; maus[1] = e.clientY / innerHeight - .5; });

/* ---------- Lobby ---------- */
const seedOf = (id: string) => { let h = 7; for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0; return h % 1000; };
async function ladeRunden() {
  let [strecken, fahrten, werte] = await Promise.all([W.strecken(), W.fahrten(), W.werte()]);
  /* beim allerersten Start legt der Maschinenraum die ersten Runden gerade erst an */
  for (let i = 0; !strecken.length && i < 40; i++) { await new Promise(r => setTimeout(r, 250)); strecken = await W.strecken(); }
  if (werte) { ftp = werte.ftp || ftp; gewicht = (werte.weight || 75) + (werte.bike || 9); }
  alleFahrten = fahrten;
  const P = grundleistung(ftp);
  runden = strecken.map(st => {
    const rt = bahn(st), eigene = fahrten.filter(f => f.routeId === st.id && !f.rev && f.rolle);
    const best = eigene.filter(f => f.ganz).sort((a, b) => a.dauer - b.dauer)[0] || null;
    const zuletzt = eigene.length ? eigene[eigene.length - 1].start : null;
    return { st, rt, best, zuletzt, tag: '', min: Math.round(fahrzeit(rt, 0, rt.dist, P, gewicht) / 60), seed: seedOf(st.id) };
  });
  /* Heute für dich (vorläufig, bis es die Saison gibt): unter den Runden bis 90 Minuten die, die am längsten nicht
     gefahren wurde; gibt es keine so kurze, die kürzeste */
  const kurz = runden.filter(r => r.min <= 90), wahl = kurz.length ? kurz : runden.slice().sort((a, b) => a.min - b.min).slice(0, 1);
  const heute = wahl.slice().sort((a, b) => (a.zuletzt || '').localeCompare(b.zuletzt || '') || a.min - b.min)[0];
  for (const r of runden) r.tag = r === heute ? 'Heute für dich' : r.best ? 'Rivale wartet' : '';
  runden.sort((a, b) => (a === heute ? -1 : b === heute ? 1 : 0));
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
  $('hKm').textContent = fmt(r.rt.dist / 1000, 1); $('hHm').textContent = fmt(r.st.gain); $('hMin').textContent = String(r.min);
  $('hRival').hidden = !r.best;
  if (r.best) { $('hWhen').textContent = tag(r.best.start); $('hBest').textContent = zeit(r.best.dauer); }
  $('stufe').textContent = fmt(ftp) + ' W';
}
/* Unten stehen höchstens vier Runden: ein Fenster um die gewählte, die Pfeiltasten gehen durch alle */
let kAb = 0;
function baueKarten() {
  const box = $('cards'), n = runden.length; box.innerHTML = '';
  kAb = Math.max(0, Math.min(n - 4, pick < kAb ? pick : pick > kAb + 3 ? pick - 3 : kAb));
  runden.slice(kAb, kAb + 4).forEach((r, k) => {
    const i = kAb + k, b = document.createElement('button'); b.className = 'glass card' + (i === pick ? ' on' : ''); b.innerHTML = '<b></b><small></small><canvas width="480" height="88"></canvas>';
    b.children[0].textContent = r.st.name; b.children[1].textContent = `${fmt(r.rt.dist / 1000, 1)} km · ${fmt(r.st.gain)} Hm${r.tag ? ' · ' + r.tag : ''}`;
    profil(b.children[2] as HTMLCanvasElement, r.rt, null, null); b.onclick = () => waehle(i); box.appendChild(b);
  });
}
function zeige(i: number) { const r = runden[i]; welt.strecke(r.rt, r.seed); W.befehl({ was: 'wahl', streckeId: r.st.id, rev: false }); }
function waehle(i: number) {
  const n = runden.length; i = (i + n) % n;
  if (i === pick || akt !== 'lobby') return;
  pick = i; baueKarten(); fuelleLobby(); if (sicht === 'rivalen') { rvAuf = ''; zeigeRivalen(); } $('flash').classList.add('on');
  setTimeout(() => { zeige(pick); $('flash').classList.remove('on'); }, 360);
}
const start = () => { const r = runden[pick]; if (r && akt === 'lobby') W.befehl({ was: 'start', streckeId: r.st.id, rev: false }); };

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
  if (a === 'lobby' && vor === 'done') ladeRunden().then(i => { pick = i; baueKarten(); fuelleLobby(); zeige(pick); });
}
let cntVor = 0;
W.aufZustand((n: Zustand) => {
  z = n; zZeit = performance.now();
  /* Runde, die gerade läuft (auch nach einem Neustart der Bühne mitten in der Fahrt) */
  if (n.streckeId && (!aktRt || aktRt.id !== n.streckeId)) {
    const i = runden.findIndex(r => r.st.id === n.streckeId);
    if (i >= 0) { if (i !== pick || !aktRt) { pick = i; baueKarten(); fuelleLobby(); welt.strecke(runden[i].rt, runden[i].seed); } aktRt = runden[i].rt; const a = anstiege(aktRt).sort((x, y) => y.gain - x.gain)[0]; haupt = a ? { s: a.s, top: a.top } : null; $('rName').textContent = aktRt.name; }
  }
  if (!n.streckeId) aktRt = null;
  setzeAkt(n.phase === 'done' && !n.ergebnis ? 'lobby' : n.phase);
  if (n.phase === 'done' && n.ergebnis && n.ergebnis.id && n.ergebnis.id !== resId) { resId = n.ergebnis.id; stravaMarke(n.ergebnis.strava); }
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
  const a = e.abstand, gleich = a != null && Math.abs(a) < 1;
  $('resL').textContent = !e.ganz ? 'Runde beendet' : a == null ? 'Erste Zeit' : gleich ? 'Gleichauf' : a < 0 ? 'Neue Bestzeit' : 'Knapp dahinter';
  const t0 = performance.now(), el = $('resT');
  (function up() { const k = Math.min(1, (performance.now() - t0) / 1100); el.textContent = zeit(e.zeit * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(up); })();
  const sek = (n: number) => fmt(Math.abs(n)) + (Math.abs(Math.round(n)) === 1 ? ' Sekunde' : ' Sekunden');
  $('resP').textContent = !e.ganz ? `${fmt(e.km, 1)} km gefahren` : a == null || !e.rivale ? 'Ab jetzt dein Rivale auf dieser Runde' : gleich ? 'Kopf an Kopf mit dir vom ' + tag(e.rivale.start) : sek(a) + (a < 0 ? ' vor dir vom ' : ' hinter dir vom ') + tag(e.rivale.start);
  if (e.id && e.id !== resId) { resId = e.id; stravaMarke(e.strava); } else if (!e.id) { resId = null; stravaMarke(null); }
  $('resW').textContent = 'Ø ' + fmt(e.avgW) + ' W'; $('resK').textContent = e.ganz ? fmt(e.km, 1) + ' km' : ''; $('resH').textContent = e.hm ? fmt(e.hm) + ' Höhenmeter' : '';
  $('resB').textContent = e.bestzeiten ? (e.bestzeiten === 1 ? '1 Segment-Bestzeit' : e.bestzeiten + ' Segment-Bestzeiten') : '';
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
  $('coachT').textContent = (z.coach ? 'Coach · Ziel ' : 'Ziel ') + z.ziel + ' W';
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
  if (k.an) { $('kWer').textContent = k.email || ''; $('kSt').textContent = k.busy ? 'gleicht ab' : k.err ? 'Abgleich wartet' : k.wartet ? `${k.wartet} wartet` : k.last ? 'abgeglichen ' + new Date(k.last).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''; }
}
W.aufKonto(zeigeKonto);
function zeigeStrava(s: StravaStand) {
  const an = !!s.connected; $('svWer').textContent = an ? (s.athlete && s.athlete.name) || 'verbunden' : '';
  const b = $<HTMLButtonElement>('svB'); b.textContent = an ? 'Trennen' : 'Verbinden'; b.classList.toggle('leer', an); b.disabled = false; b.dataset.an = an ? '1' : '';
  $('svMsg').textContent = s.ok === false ? s.error || '' : '';
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
$('lvlB').onclick = () => blatt(document.body.dataset.blatt === 'profil' ? null : 'profil');
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
    const vor = runden[pick] ? runden[pick].st.id : null, n = runden.length, heute = await ladeRunden(), i = runden.findIndex(r => r.st.id === vor);
    pick = i >= 0 ? i : heute; baueKarten(); fuelleLobby();
    if (i < 0 || !n) zeige(pick);
    if (sicht === 'rivalen') zeigeRivalen(); if (sicht === 'fahrten') zeigeFahrten();
  }, 300);
}
W.aufDaten(neuLaden);

/* ---------- Bereiche: Rivalen und Fahrten ---------- */
type Sicht = 'lobby' | 'rivalen' | 'fahrten';
let sicht: Sicht = 'lobby';
function setzeSicht(x: Sicht) {
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
  $('rvName').textContent = r.st.name; ($('rvWeg') as HTMLButtonElement).textContent = 'Runde entfernen'; $('rvWeg').dataset.sicher = '';
  const fuer = r.st.id; rvFuer = fuer;
  const laeufe = await W.laeufe(r.st.id, false); if (rvFuer !== fuer || sicht !== 'rivalen') return;
  const box = $('rvListe'); box.innerHTML = '';
  for (const seg of segmente(r.rt)) {
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
/* Fahrten: alle Fahrten, neueste zuerst, nach Monat. Draußen-Fahrten aus Strava lassen sich als Strecke anlegen. */
function zeigeFahrten() {
  const box = $('fhListe'); box.innerHTML = ''; let mon = '';
  const liste = alleFahrten.slice().sort((a, b) => b.start.localeCompare(a.start));
  if (!liste.length) { const p = document.createElement('p'); p.className = 'leer'; p.textContent = 'Noch keine Fahrt'; box.appendChild(p); return; }
  for (const f of liste) {
    const m = new Date(f.start).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    if (m !== mon) { mon = m; const h = document.createElement('div'); h.className = 'mon'; h.textContent = m; box.appendChild(h); }
    const row = document.createElement('div'); row.className = 'fh'; row.innerHTML = '<span></span><b></b><span></span><span></span><span></span>';
    row.children[0].textContent = new Date(f.start).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }); row.children[1].textContent = f.name;
    row.children[2].textContent = f.km ? fmt(f.km, 1) + ' km' : ''; row.children[3].textContent = zeit(f.zeit); row.children[4].textContent = f.avgW ? fmt(f.avgW) + ' W' : '';
    if (f.draussen && f.stravaId) {
      const da = runden.some(r => r.st.id === 'sr' + f.stravaId), b = document.createElement('button'); b.type = 'button'; b.textContent = da ? 'ist Strecke' : 'Als Strecke'; b.disabled = da;
      b.onclick = async () => { b.disabled = true; b.textContent = 'holt'; const r = await W.alsStrecke(f.id); b.textContent = r.ok ? 'ist Strecke' : 'geht nicht'; };
      row.appendChild(b);
    } else { const e = document.createElement('em'); e.textContent = f.draussen ? 'draußen' : f.rolle ? '' : 'Strava'; row.appendChild(e); }
    box.appendChild(row);
  }
}

/* ---------- Bedienung ---------- */
$('start').onclick = start; $('end').onclick = () => W.befehl({ was: 'ende' }); $('home').onclick = () => W.befehl({ was: 'lobby' });
$('coach').onclick = $('wbtn').onclick = () => W.befehl({ was: 'coach' });
$('less').onclick = () => W.befehl({ was: 'stufe', d: -10 }); $('more').onclick = () => W.befehl({ was: 'stufe', d: 10 });
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey) return;
  if (document.body.dataset.blatt) { if (e.key === 'Escape') blatt(null); return; }   // im Blatt gehören die Tasten den Feldern
  if (e.key === 'ArrowUp' && akt === 'ride') { W.befehl({ was: 'stufe', d: 10 }); e.preventDefault(); }
  else if (e.key === 'ArrowDown' && akt === 'ride') { W.befehl({ was: 'stufe', d: -10 }); e.preventDefault(); }
  else if (e.key === 'Enter' && akt === 'lobby' && sicht === 'lobby') start();
  else if (e.key === 'Enter' && akt === 'done') W.befehl({ was: 'lobby' });
  else if (e.key === 'ArrowRight' && akt === 'lobby' && sicht !== 'fahrten') waehle(pick + 1);
  else if (e.key === 'ArrowLeft' && akt === 'lobby' && sicht !== 'fahrten') waehle(pick - 1);
  else if (e.key === 'Escape' && akt === 'lobby' && sicht !== 'lobby') setzeSicht('lobby');
  else if (e.key === ' ' && akt === 'ride') { W.befehl({ was: 'pause' }); e.preventDefault(); }
  else if (e.key === 'c' && akt === 'ride') W.befehl({ was: 'coach' });
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
  W.bereit();
  setTimeout(() => { $('flash').classList.remove('on'); setTimeout(() => $('flash').style.transitionDuration = '', 1500); }, 200);
  (window as any).__wb = { get akt() { return akt; }, get z() { return z; }, get welt() { return welt.stand; }, get runden() { return runden.map(r => r.st.id); }, get ruck() { return ruck; } };
  bild();
});
