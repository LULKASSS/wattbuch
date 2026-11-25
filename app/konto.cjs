/* Konto: Abgleich über Supabase (Projekt „Apps“), dieselben Tabellen wie die alte App: wattbuch_fahrten und
 * wattbuch_werte, Zeilenschutz (jeder sieht nur seine Zeilen). Ohne Bibliothek, direkt über REST.
 * Die Tabellen werden nie geändert, es wird nie eine Zeile gelöscht. Neue Fahrten gehen im Format der alten App
 * hinein (plus routeId, rev, ganz, app), damit die alte App sie weiter lesen kann.
 * Ablauf wie in der alten App: Jede hier gespeicherte Fahrt landet im Ausgang. Ein Abgleich holt erst alles, was seit
 * dem letzten Mal im Konto neu ist, und schickt dann den Ausgang. Beim ersten Abgleich nach der Anmeldung gewinnt das
 * Konto. Im Konto gelöschte Fahrten (geloescht=true) verschwinden auch hier.
 * Die Anmeldung (Token) liegt in konto.json im Datenordner, nur für den eigenen Benutzer lesbar. */
const fs = require('node:fs');
const path = require('node:path');
const SB = { url: process.env.WATTBUCH_SUPABASE_URL || 'https://nysoyxbsdsxdvyknnkbc.supabase.co', key: 'sb_publishable_ezMnvUv2bU521KyvyqrD7w_-Lh7TJnx' };

function createKonto({ daten, melde = () => {}, log = () => {} }) {
  const file = path.join(daten.dir, 'konto.json');
  const K = { s: null, out: new Map(), pulled: null, first: false, werte: false, wg: null, last: null, busy: false, err: '', mine: {}, weg: [] };
  { const d = daten.lies(file, null); if (d) Object.assign(K, { s: d.s || null, out: new Map(d.out || []), pulled: d.pulled || null, first: !!d.first, werte: !!d.werte, wg: d.wg || null, last: d.last || null, weg: d.weg || [] }); }
  const save = () => { fs.writeFileSync(file, JSON.stringify({ s: K.s, out: [...K.out], pulled: K.pulled, first: K.first, werte: K.werte, wg: K.wg, last: K.last, weg: K.weg }), { mode: 0o600 }); };
  const status = () => ({ an: !!K.s, email: K.s ? K.s.email : null, busy: K.busy, err: K.err, last: K.last, wartet: K.out.size });
  const sag = () => melde(status());
  const okRide = x => !!(x && x.id && x.start && Array.isArray(x.p) && (x.p.length || x.noW && x.dur > 0));

  function authMsg(d) {
    const m = String(d.error_code || d.msg || d.error_description || d.message || '');
    if (/invalid_credentials|invalid login/i.test(m)) return 'E-Mail oder Passwort stimmt nicht';
    if (/email_not_confirmed|not confirmed/i.test(m)) return 'E-Mail noch nicht bestätigt';
    return m || 'Anmeldung hat nicht geklappt';
  }
  async function sbAuth(p, body) {
    const r = await fetch(SB.url + '/auth/v1/' + p, { method: 'POST', headers: { apikey: SB.key, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(authMsg(d)), { status: r.status });
    return d;
  }
  const session = d => { K.s = { access: d.access_token, refresh: d.refresh_token, exp: Date.now() + (d.expires_in || 3600) * 1000, id: d.user && d.user.id, email: d.user && d.user.email }; };
  async function anmelden(email, pw) {
    session(await sbAuth('token?grant_type=password', { email, password: pw }));
    /* Erster Abgleich: alles hier Aufgenommene vormerken, das Konto gewinnt bei Fahrten, die es schon kennt */
    Object.assign(K, { first: true, pulled: null, werte: false, wg: null, err: '', mine: {}, out: new Map(daten.fahrtIds().filter(f => f.neu).map(f => [f.id, Date.now()])) });
    save(); sag(); abgleich();
    return status();
  }
  function abmelden() {
    const t = K.s && K.s.access;
    Object.assign(K, { s: null, out: new Map(), pulled: null, first: false, werte: false, wg: null, last: null, err: '' }); save(); sag();
    if (t) fetch(SB.url + '/auth/v1/logout', { method: 'POST', headers: { apikey: SB.key, authorization: 'Bearer ' + t } }).catch(() => {});
    return status();
  }
  async function token() {
    if (Date.now() > K.s.exp - 60000) {
      try { session(await sbAuth('token?grant_type=refresh_token', { refresh_token: K.s.refresh })); save(); }
      catch (e) { if (e.status >= 400 && e.status < 500) abmelden(); throw e; }
    }
    return K.s.access;
  }
  async function sb(p, { method = 'GET', body, prefer } = {}, again = true) {
    const r = await fetch(SB.url + '/rest/v1/' + p, { method, headers: { apikey: SB.key, authorization: 'Bearer ' + await token(), 'content-type': 'application/json', ...(prefer ? { prefer } : {}) }, body: body && JSON.stringify(body) });
    if (r.status === 401 && again && K.s) { K.s.exp = 0; return sb(p, { method, body, prefer }, false); }
    const tx = await r.text();
    if (!r.ok) throw Object.assign(new Error('Konto antwortet nicht (' + r.status + ')'), { status: r.status });
    return tx ? JSON.parse(tx) : null;
  }

  let timer = null;
  const bald = (ms = 1500) => { if (!K.s) return; clearTimeout(timer); timer = setTimeout(abgleich, ms); };
  /* Neue oder geänderte Fahrt vormerken */
  function merke(id) { if (!K.s) return; K.out.set(id, Date.now() + Math.random()); save(); bald(); sag(); }
  function merkeWerte() { if (!K.s) return; K.werte = true; save(); bald(); }

  /* Eine Zeile aus dem Konto übernehmen */
  function uebernimm(x) {
    if (K.mine[x.id] === x.geaendert) { delete K.mine[x.id]; return 0; }   // eigenes Echo
    if (K.out.has(x.id)) { if (K.first) K.out.delete(x.id); else return 0; }
    if (x.geloescht) { if (!K.weg.includes(x.id)) K.weg.push(x.id); if (daten.fahrt(x.id)) { daten.fahrtLoeschen(x.id); return 1; } return 0; }
    if (!okRide(x.data)) return 0;
    K.weg = K.weg.filter(i => i !== x.id);
    daten.fahrtSpeichern(x.data); return 1;
  }
  let lauf = null;
  function abgleich() {
    if (!K.s) return Promise.resolve(status());
    if (lauf) { lauf.then(() => bald(200)); return lauf; }
    clearTimeout(timer);
    lauf = (async () => {
      K.busy = true; sag(); let n = 0;
      try {
        for (;;) {
          const rows = await sb('wattbuch_fahrten?select=id,data,geloescht,geaendert&order=geaendert.asc&limit=10' + (K.pulled ? '&geaendert=gt.' + encodeURIComponent(K.pulled) : ''));
          for (const x of rows) { n += uebernimm(x); K.pulled = x.geaendert; }
          save();
          if (rows.length < 10) break;
        }
        const w = (await sb('wattbuch_werte?select=werte,geaendert'))[0];
        if (w && w.geaendert !== K.wg && (K.first || !K.werte)) {
          const v = w.werte || {}, alt = daten.werte() || {}, fin = x => typeof x === 'number' && isFinite(x);
          daten.werteSpeichern({ ...alt, ...(fin(v.ftp) ? { ftp: v.ftp } : {}), ...(fin(v.weight) ? { weight: v.weight } : {}), ...(fin(v.bike) ? { bike: v.bike } : {}) });
          K.werte = false; K.wg = w.geaendert; n++;
        }
        /* Ausgang: bis fünf Fahrten oder gut 1,5 MB pro Anfrage */
        const ids = [...K.out.keys()];
        for (let k = 0; k < ids.length;) {
          const part = [], rows = []; let size = 0;
          while (k < ids.length && part.length < 5 && (!part.length || size < 1.5e6)) {
            const id = ids[k++], r = daten.fahrt(id);
            if (!r) { K.out.delete(id); continue; }   // hier wird nichts gelöscht, also auch nichts als gelöscht gemeldet
            size += JSON.stringify(r).length; part.push([id, K.out.get(id)]); rows.push({ id, start: r.start, data: r, geloescht: false });
          }
          if (!rows.length) continue;
          const res = await sb('wattbuch_fahrten?on_conflict=user_id,id&select=id,geaendert', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=representation' });
          for (const x of res || []) K.mine[x.id] = x.geaendert;
          for (const [id, st] of part) if (K.out.get(id) === st) K.out.delete(id);
          save();
        }
        if (K.werte) {
          const v = daten.werte() || {};
          const res = await sb('wattbuch_werte?on_conflict=user_id&select=geaendert', { method: 'POST', body: [{ werte: { ftp: v.ftp, weight: v.weight, bike: v.bike } }], prefer: 'resolution=merge-duplicates,return=representation' });
          K.werte = false; K.wg = res && res[0] ? res[0].geaendert : null;
        }
        Object.assign(K, { first: false, last: new Date().toISOString(), err: '' }); save();
        if (n) log(`Konto: ${n} Änderungen übernommen`);
      } catch (e) { K.err = (e && e.message) || 'Fehler'; }
      finally { K.busy = false; lauf = null; }
      sag();
      if (K.s && (K.out.size || K.werte)) bald(K.err ? 60000 : 500);
      return status();
    })();
    return lauf;
  }
  const takt = setInterval(() => bald(0), 5 * 60000);
  return { status, anmelden, abmelden, abgleich, merke, merkeWerte, weg: () => K.weg, stop: () => { clearInterval(takt); clearTimeout(timer); } };
}
module.exports = { createKonto };
