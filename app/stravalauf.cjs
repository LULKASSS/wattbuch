/* Was mit Strava von selbst läuft:
 * 1. Hochladen: Jede Fahrt mit echter Rolle geht nach kurzer Wartezeit (15 s, im Ergebnisbild abbrechbar) als TCX hoch
 *    und wird danach zum „Virtual Ride“. Fehlschläge werden bis viermal nachgeholt (immer länger warten). Doppelte
 *    erkennt Strava an der external_id wattbuch-<id>, auch wenn die alte App dieselbe Fahrt hochlädt.
 * 2. Runden: Aus den Polylines der Draußen-Fahrten werden gleiche Runden erkannt (Start und Ziel höchstens 1 km
 *    auseinander, Länge ±8 %, Linien decken sich auf 300 m). Die drei meistgefahrenen (mind. 3-mal) kommen als Strecken
 *    sf<Strava-ID> dazu, Linie und Höhe aus der jüngsten Fahrt. Einmal am Tag. Gelöschte kommen nicht wieder.
 * 3. Fahrten übernehmen (nur mit eigener Strava-App): neue Radfahrten als Fahrt sv<Strava-ID>, draußen ohne Wattmesser
 *    als noW mit Dauer und Stravas Schätzung. Über das Konto sieht sie auch die alte App.
 * Höchstens 90 Abrufe pro 15 min (Strava erlaubt 100). */
const path = require('node:path');
const SVR = /^(Ride|VirtualRide|GravelRide|MountainBikeRide|EBikeRide|EMountainBikeRide|Velomobile|Handcycle)$/;
const SVDEF = /^(morning|lunch|afternoon|evening|night|morgen|vormittag|mittag|nachmittag|abend|nacht)\w*[- ]?(ride|radfahrt|ausfahrt|fahrt)?$|(ride|radfahrt|ausfahrt|fahrt) (am|in the) /i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* TCX einer Fahrt (ein Punkt pro Sekunde, mit Watt) */
function tcx(r) {
  const t0 = Date.parse(r.start), n = r.p.length; let dist = 0, pts = '';
  const hasD = !!(r.dist || r.spd), hv = (r.hr || []).filter(v => v > 0), kj = r.p.reduce((s, v) => s + v, 0) / 1000;
  for (let i = 0; i < n; i++) {
    if (r.dist) dist = r.dist[i] || dist; else if (r.spd) dist += (r.spd[i] || 0) / 3.6;
    const alt = r.alt && r.alt[i] != null ? `<AltitudeMeters>${r.alt[i]}</AltitudeMeters>` : '';
    const hr = r.hr && r.hr[i] > 0 ? `<HeartRateBpm><Value>${r.hr[i]}</Value></HeartRateBpm>` : '';
    const cad = r.cad ? `<Cadence>${Math.min(254, r.cad[i] || 0)}</Cadence>` : '';
    pts += `<Trackpoint><Time>${new Date(t0 + i * 1000).toISOString()}</Time>${alt}${hasD ? `<DistanceMeters>${dist.toFixed(1)}</DistanceMeters>` : ''}${hr}${cad}<Extensions><ns3:TPX><ns3:Watts>${r.p[i]}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>\n`;
  }
  const iso = new Date(t0).toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Biking"><Id>${iso}</Id>
<Lap StartTime="${iso}"><TotalTimeSeconds>${n}</TotalTimeSeconds><DistanceMeters>${dist.toFixed(1)}</DistanceMeters><Calories>${Math.round(kj)}</Calories>${hv.length ? `<AverageHeartRateBpm><Value>${Math.round(hv.reduce((s, v) => s + v, 0) / hv.length)}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${Math.max(...hv)}</Value></MaximumHeartRateBpm>` : ''}<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>
<Track>
${pts}</Track></Lap><Creator><Name>Wattbuch</Name></Creator></Activity></Activities></TrainingCenterDatabase>`;
}
/* Normalized Power: 30-s-Mittel, vierte Potenz */
function np(p) {
  if (p.length < 30) return p.length ? p.reduce((s, v) => s + v, 0) / p.length : 0;
  let s = 0, sum = 0, n = 0;
  for (let i = 0; i < p.length; i++) { s += p[i]; if (i >= 30) s -= p[i - 30]; if (i >= 29) { sum += (s / 30) ** 4; n++; } }
  return Math.pow(sum / n, .25);
}
/* Google-Polyline entpacken, alle 100 m ein Punkt, damit lange gerade Stücke vergleichbar bleiben */
const dm = (a, b) => Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
function polyDec(s) {
  const pts = []; let i = 0, la = 0, lo = 0;
  while (i < s.length) {
    const v = [0, 0];
    for (const k of [0, 1]) { let b, sh = 0, r = 0; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32 && i < s.length); v[k] = r & 1 ? ~(r >> 1) : r >> 1; }
    la += v[0]; lo += v[1]; const p = [la / 1e5, lo / 1e5], q = pts[pts.length - 1];
    if (q) { const n = Math.floor(dm(q, p) / 100); for (let j = 1; j <= n; j++) pts.push([q[0] + (p[0] - q[0]) * j / (n + 1), q[1] + (p[1] - q[1]) * j / (n + 1)]); }
    pts.push(p);
  }
  return pts;
}
function covers(a, b) { const st = Math.max(1, Math.floor(a.length / 25)); for (let i = 0; i < a.length; i += st) { let ok = false; for (const q of b) if (dm(a[i], q) < 300) { ok = true; break; } if (!ok) return false; } return true; }
const sameLoop = (a, b) => Math.abs(a.km - b.km) <= .08 * Math.max(a.km, b.km) && dm(a.s, b.s) < 1000 && dm(a.e, b.e) < 1000 && covers(a.pts, b.pts) && covers(b.pts, a.pts);
function runden(list) {
  const cl = [];
  for (const a of list.slice().sort((a, b) => b.start_date.localeCompare(a.start_date))) {
    if (!SVR.test(a.sport_type || a.type || '') || a.trainer || a.sport_type === 'VirtualRide' || !(a.distance >= 10000) || !a.map || !a.map.summary_polyline) continue;
    const pts = polyDec(a.map.summary_polyline); if (pts.length < 2) continue;
    const x = { a, pts, km: a.distance / 1000, s: pts[0], e: pts[pts.length - 1] }, c = cl.find(c => sameLoop(c[0], x));
    if (c) c.push(x); else cl.push([x]);
  }
  return cl.filter(c => c.length >= 3).sort((a, b) => b.length - a.length);
}
/* Name: der, den die Runde am häufigsten bekam (Stravas „Radfahrt am Morgen“ zählt nicht) */
function rundenName(c) {
  const m = new Map(); for (const x of c) { const n = (x.a.name || '').trim(); if (n && !SVDEF.test(n)) m.set(n, (m.get(n) || 0) + 1); }
  const b = [...m].sort((a, b) => b[1] - a[1])[0];
  return b && b[1] >= 2 ? b[0].slice(0, 60) : `Deine Runde · ${Math.round(c[0].km)} km`;
}
/* Strava-Streams → Fahrt mit einem Wert pro Sekunde Bewegung (Pausen fallen raus) */
function fahrtAus(a, st) {
  const g = k => st && st[k] && Array.isArray(st[k].data) ? st[k].data : null;
  const T = g('time'); if (!T || T.length < 2) return null;
  const W = g('watts'), H = g('heartrate'), C = g('cadence'), D = g('distance'), A = g('altitude'), M = g('moving');
  const hasW = !!(W && a.device_watts !== false && W.some(v => v > 0)), p = [], hr = [], cad = [], dist = [], alt = [];
  for (let i = 1; i < T.length; i++) {
    const dt = T[i] - T[i - 1]; if (dt <= 0 || dt > 10 || (M && !M[i])) continue;
    for (let k = 1; k <= dt; k++) { if (hasW) p.push(Math.round(W[i] || 0)); hr.push(H ? Math.round(H[i] || 0) : 0); cad.push(C ? Math.round(C[i] || 0) : 0); if (D) dist.push(Math.round(D[i - 1] + (D[i] - D[i - 1]) * k / dt)); if (A) alt.push(Math.round(A[i])); }
  }
  const n = hr.length; if (n < 60) return null;
  const any = x => x.some(v => v > 0);
  const r = { id: 'sv' + a.id, start: new Date(a.start_date).toISOString(), name: a.name || 'Ausfahrt', src: 'strava', sport: a.sport_type || a.type || 'Ride', p: hasW ? p : [], hr: any(hr) ? hr : null, cad: any(cad) ? cad : null, spd: null, dist: D ? dist : null, alt: A ? alt : null,
    gain: Math.round(a.total_elevation_gain || 0), route: null, trainer: !!a.trainer || a.sport_type === 'VirtualRide', strava: { state: 'ok', id: String(a.id), url: 'https://www.strava.com/activities/' + a.id } };
  if (!hasW) Object.assign(r, { noW: true, dur: n, estW: a.average_watts ? Math.round(a.average_watts) : null });
  return r;
}

function createStravaLauf({ strava, daten, konto, melde = () => {}, strecke = () => {}, log = () => {}, wartezeit = 15000 }) {
  const merk = path.join(daten.dir, 'strava-stand.json');
  const S = { st: { connected: false }, calls: [], laeuft: false, offen: new Set(), busy: new Set(), t: null };
  const stand = () => daten.lies(merk, {}), setze = x => daten.schreib(merk, { ...stand(), ...x });
  const sag = (id, s) => melde({ id, state: s ? s.state : null, url: s && s.url });
  const sichern = r => { daten.fahrtSpeichern(r); konto.merke(r.id); };

  async function status() { S.st = await strava.status(); return { ...S.st, eigen: !S.st.central }; }
  async function ruf(fn) {
    for (;;) { const now = Date.now(); S.calls = S.calls.filter(t => now - t < 15 * 60000); if (S.calls.length < 90) break; await sleep(S.calls[0] + 15 * 60000 - now + 500); }
    S.calls.push(Date.now());
    try { return await fn(); } catch (e) { if (e.status === 429) { await sleep(15 * 60000); return ruf(fn); } throw e; }
  }

  /* ---------- 1. Hochladen ---------- */
  /* Neue Fahrt vormerken (vor dem Speichern aufgerufen) */
  function vormerken(r) { if (r.trainer && S.st.connected) { r.strava = { state: 'wartet', due: Date.now() + wartezeit, auto: true }; S.offen.add(r.id); setTimeout(lauf, wartezeit + 100); } }
  function faellig(r) {
    const s = r.strava;
    if (!s) return r.trainer && r.app === 'neu' && Date.now() - Date.parse(r.start) < 3 * 864e5 ? 0 : null;
    if (s.state === 'wartet') return s.due || 0;
    if (s.state === 'laeuft') return 0;
    if ((s.state === 'verarbeitung' || s.state === 'fehler' && s.auto) && (s.tries || 0) < 4) return s.retry || 0;
    return null;
  }
  async function hoch(id) {
    let r = daten.fahrt(id); if (!r || S.busy.has(id)) return;
    S.busy.add(id);
    const tries = (r.strava && r.strava.tries || 0) + 1; let res;
    try { res = await strava.upload({ tcx: tcx(r), name: r.name, description: `Mit Wattbuch auf der Rolle${r.route ? ` · Strecke ${r.route}` : ''}\nNormalized Power ${Math.round(np(r.p))} W`, externalId: 'wattbuch-' + r.id }); }
    catch (e) { res = { error: e.message }; }
    finally { S.busy.delete(id); }
    r = daten.fahrt(id); if (!r) return;
    if (res.error) r.strava = { state: 'fehler', error: res.error, auto: true, tries, retry: Date.now() + 2 ** tries * 60000 };
    else if (res.processing) r.strava = { state: 'verarbeitung', uploadId: res.uploadId, auto: true, tries, retry: Date.now() + 60000 };
    else { r.strava = { state: 'ok', id: res.activityId, url: res.url, at: new Date().toISOString(), vr: !!res.virtual }; S.offen.delete(id); }
    sichern(r); sag(id, r.strava);
  }
  function abbrechen(id) { const r = daten.fahrt(id); if (!r || !r.strava || r.strava.state !== 'wartet') return false; r.strava = { state: 'aus' }; S.offen.delete(id); sichern(r); sag(id, r.strava); return true; }
  async function lauf() {
    if (S.laeuft || !S.st.connected) return;
    S.laeuft = true; clearTimeout(S.t); let naechst = Infinity;
    try {
      for (const id of [...S.offen]) {
        const r = daten.fahrt(id), d = r ? faellig(r) : null;
        if (d == null) { S.offen.delete(id); continue; }
        if (d <= Date.now()) await hoch(id);
        const r2 = daten.fahrt(id), d2 = r2 ? faellig(r2) : null; if (d2 != null) naechst = Math.min(naechst, d2);
      }
    } finally { S.laeuft = false; }
    if (naechst < Infinity) S.t = setTimeout(lauf, Math.max(500, naechst - Date.now()));
  }
  /* Beim Start: was noch offen ist (App war zu, Netz war weg) */
  function offeneSuchen() { for (const f of daten.fahrtIds()) if (f.neu) { const r = daten.fahrt(f.id); if (r && faellig(r) != null) S.offen.add(r.id); } }

  /* ---------- 2. Meistgefahrene Runden als Strecken ---------- */
  async function liste(after) { const list = []; for (let page = 1; page < 50; page++) { const r = await ruf(() => strava.activities({ after, page })); list.push(...(r.list || [])); if (!r.list || r.list.length < 100) break; } return list; }
  async function hole(force) {
    if (S.holt || !S.st.connected || !S.st.canRead) return;
    const st = stand(); if (!force && st.am && Date.now() - st.am < 864e5) return;
    S.holt = true;
    try {
      const list = await liste(0);
      const weg = new Set(st.rundenWeg || []), da = daten.strecken(), hat = (c, ids) => c.some(y => ids.has('sf' + y.a.id));
      for (const c of runden(list).filter(c => !hat(c, weg)).slice(0, 3)) {
        const alt = da.find(r => r.fav && hat(c, new Set([r.id])));
        if (alt) { if (alt.fav.n !== c.length) { alt.fav.n = c.length; daten.streckeSpeichern(alt); } continue; }
        const x = c[0], sm = (await ruf(() => strava.streams(x.a.id, 'route'))).streams || {}, L = sm.latlng && sm.latlng.data, A = sm.altitude && sm.altitude.data;
        if (!L || !A || L.length !== A.length) continue;
        strecke({ id: 'sf' + x.a.id, name: rundenName(c), fav: { n: c.length }, pts: L.map((p, i) => [p[0], p[1], A[i]]) });
      }
      /* 3. Fahrten übernehmen: nur mit eigener Strava-App */
      if (!S.st.central) {
        const ids = new Set(daten.fahrtIds().map(f => f.id)), alle = daten.fahrten(), wegF = new Set(konto.weg ? konto.weg() : []);
        const kennt = a => ids.has('sv' + a.id) || wegF.has('sv' + a.id) || /wattbuch-/.test(a.external_id || '') || alle.some(f => !f.id.startsWith('sv') && Math.abs(Date.parse(f.start) - Date.parse(a.start_date)) < 10 * 60000);
        const neu = list.filter(a => SVR.test(a.sport_type || a.type || '') && (a.moving_time || 0) >= 300 && (!st.letzte || Date.parse(a.start_date) / 1000 > st.letzte - 86400) && !kennt(a)).sort((a, b) => b.start_date.localeCompare(a.start_date));
        let n = 0;
        for (const a of neu) { const r = fahrtAus(a, (await ruf(() => strava.streams(a.id))).streams); if (r) { sichern(r); n++; } }
        if (n) log(`Strava: ${n} Fahrten übernommen`);
        setze({ letzte: list.reduce((m, a) => Math.max(m, Math.floor(Date.parse(a.start_date) / 1000)), st.letzte || 0) });
      }
      setze({ am: Date.now() });
    } catch (e) { log('Strava: ' + e.message); }
    finally { S.holt = false; }
  }
  function rundeWeg(id) { const st = stand(); setze({ rundenWeg: [...new Set([...(st.rundenWeg || []), id])] }); }

  async function start() { try { await status(); } catch {} if (S.st.connected) { offeneSuchen(); lauf(); hole(); } }
  const takt = setInterval(() => { if (S.st.connected) { lauf(); hole(); } }, 30 * 60000);
  return {
    status, start, vormerken, abbrechen, hole, rundeWeg,
    verbinden: async () => { await strava.connect(); const s = await status(); offeneSuchen(); lauf(); hole(true); return s; },
    trennen: async () => { await strava.disconnect(); return status(); },
    stop: () => { clearInterval(takt); clearTimeout(S.t); }
  };
}
module.exports = { createStravaLauf, tcx, runden, polyDec, fahrtAus };
