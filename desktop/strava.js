/* Strava für die Mac-App: Fahrten hochladen und die eigenen Fahrten lesen (Import nach Wattbuch).
 * Normalfall: alle nutzen Wattbuchs gemeinsame Strava-App (CENTRAL). Deren Secret liegt nur in der Supabase Edge Function
 * strava-token (supabase/functions), die Code bzw. Erneuerungs-Token gegen Zugangs-Token tauscht. Gemeinsam heißt nur
 * Hochladen und Lesen für die eigenen meistgefahrenen Runden (als Strecken, nur auf dem eigenen Gerät). Ganze Fahrten
 * übernehmen gibt es dort nicht: Stravas Regeln erlauben kein dauerhaftes Speichern von Strava-Daten bei uns.
 * Steht in strava.json ein eigenes Client-Secret (Lukas' alte Einrichtung), läuft alles direkt mit dieser App, inklusive
 * Übernehmen der eigenen Fahrten. Zugangs-Token liegen nur im App-Datenordner (strava.json, nur für den eigenen Benutzer lesbar).
 * Anmeldung: Browser öffnet Strava, Strava leitet auf http://localhost:<port>/strava zurück. */
const { net, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const CENTRAL = { clientId: '286463', tokenUrl: 'https://nysoyxbsdsxdvyknnkbc.supabase.co/functions/v1/strava-token', key: 'sb_publishable_ezMnvUv2bU521KyvyqrD7w_-Lh7TJnx' };

function createStrava({ dataDir, baseUrl = 'https://www.strava.com', tokenUrl = CENTRAL.tokenUrl, openBrowser = url => shell.openExternal(url), log = () => {} }) {
  const file = path.join(dataDir, 'strava.json');
  let cfg = null;
  const load = async () => { if (!cfg) { try { cfg = JSON.parse(await fs.readFile(file, 'utf8')); } catch { cfg = {}; } } return cfg; };
  const save = async () => { await fs.writeFile(file, JSON.stringify(cfg), { mode: 0o600 }); await fs.chmod(file, 0o600).catch(() => {}); };

  async function api(method, url, { token, form, json } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let body;
    if (form) body = form;
    else if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    const r = await net.fetch(baseUrl + url, { method, headers, body });
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch {}
    if (!r.ok) { const e = new Error((data && (data.message || data.error)) || `Strava antwortet ${r.status}`); e.status = r.status; e.data = data; throw e; }
    return data;
  }
  const formOf = obj => { const f = new FormData(); for (const [k, v] of Object.entries(obj)) if (v != null) f.append(k, v); return f; };
  const own = c => !!(c.clientId && c.clientSecret);
  /* Token holen: eigene App direkt bei Strava, gemeinsame über die Edge Function */
  async function grant(c, params) {
    if (own(c)) return api('POST', '/oauth/token', { form: formOf({ client_id: c.clientId, client_secret: c.clientSecret, ...params }) });
    const { grant_type, ...rest } = params;
    const r = await net.fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CENTRAL.key }, body: JSON.stringify(rest) });
    let data = null; try { data = await r.json(); } catch {}
    if (!r.ok) { const e = new Error((data && data.error) || `Anmeldedienst antwortet ${r.status}`); e.status = r.status; throw e; }
    return data;
  }

  async function status() {
    const c = await load();
    return { configured: true, central: !own(c), connected: !!c.refresh, athlete: c.athlete || null, canRead: /activity:read/.test(c.scope || '') };
  }

  /* Anmeldung über den Browser, wartet bis zu 5 min auf die Rückleitung */
  let pending = null;
  function connect() {
    if (pending) return pending;
    pending = (async () => {
      const c = await load();
      const state = Math.random().toString(36).slice(2);
      const { code, scope, server } = await new Promise((resolve, reject) => {
        let srv6 = null;
        const handler = (req, res) => {
          const u = new URL(req.url, 'http://localhost');
          if (u.pathname !== '/strava') { res.writeHead(404).end(); return; }
          const ok = u.searchParams.get('state') === state && u.searchParams.get('code') && /activity:write/.test(u.searchParams.get('scope') || '');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><meta charset="utf-8"><title>Wattbuch</title><body style="font:16px system-ui;background:#0c0a16;color:#F1EEFF;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${ok ? 'Mit Strava verbunden' : 'Verbindung abgebrochen'}</h2><p>${ok ? 'Du kannst dieses Fenster schließen und zurück zu Wattbuch.' : 'Bitte in Wattbuch erneut verbinden und „Aktivitäten hochladen“ erlauben.'}</p></div>`);
          if (ok) resolve({ code: u.searchParams.get('code'), scope: u.searchParams.get('scope') || '', server: both });
          else reject(Object.assign(new Error(u.searchParams.get('error') === 'access_denied' ? 'Bei Strava abgelehnt' : 'Strava hat das Hochladen nicht erlaubt'), { server: both }));
        };
        const srv = http.createServer(handler);
        /* „localhost“ kann im Browser IPv4 oder IPv6 sein: auf beiden hören, nur lokal */
        const both = { close: () => { srv.close(); if (srv6) srv6.close(); } };
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
          const port = srv.address().port;
          srv6 = http.createServer(handler);srv6.on('error', () => {});srv6.listen(port, '::1');
          const url = `${baseUrl}/oauth/authorize?` + new URLSearchParams({ client_id: own(c) ? c.clientId : CENTRAL.clientId, response_type: 'code', redirect_uri: `http://localhost:${port}/strava`, approval_prompt: 'auto', scope: 'read,activity:write,activity:read_all', state });
          Promise.resolve(openBrowser(url)).catch(reject);
        });
        setTimeout(() => reject(Object.assign(new Error('Keine Antwort von Strava (5 min)'), { server: both })), 5 * 60000);
      }).catch(e => { if (e.server) e.server.close(); throw e; });
      server.close();
      const tok = await grant(c, { code, grant_type: 'authorization_code' });
      cfg = { clientId: c.clientId, clientSecret: c.clientSecret, scope, access: tok.access_token, refresh: tok.refresh_token, expires: tok.expires_at, athlete: tok.athlete ? { id: tok.athlete.id, name: [tok.athlete.firstname, tok.athlete.lastname].filter(Boolean).join(' ') } : null };
      await save();
      log('Strava verbunden');
      return status();
    })().finally(() => { pending = null; });
    return pending;
  }

  async function token() {
    const c = await load();
    if (!c.refresh) throw new Error('Nicht mit Strava verbunden');
    if (!c.access || (c.expires || 0) * 1000 < Date.now() + 120000) {
      const tok = await grant(c, { grant_type: 'refresh_token', refresh_token: c.refresh });
      cfg = { ...c, access: tok.access_token, refresh: tok.refresh_token || c.refresh, expires: tok.expires_at };
      await save();
    }
    return cfg.access;
  }

  async function disconnect() {
    const c = await load();
    try { if (c.access) await api('POST', '/oauth/deauthorize', { token: c.access }); } catch {}
    cfg = own(c) ? { clientId: c.clientId, clientSecret: c.clientSecret } : {}; await save();
    return status();
  }

  /* Beim Hochladen lässt sich die Sportart nicht angeben (TCX kennt nur „Biking“ → Ride), also danach auf
     „Virtual Ride“ ändern: gefahren wird auf einer virtuellen Straße. Klappt das nicht, bleibt es ein Ride. */
  async function virtual(t, id) {
    try { await api('PUT', `/api/v3/activities/${id}`, { token: t, json: { sport_type: 'VirtualRide', trainer: true } }); return true; }
    catch (e) { log('Strava Sportart: ' + e.message); return false; }
  }
  /* Schon hochgeladene Wattbuch-Fahrt nachträglich zum Virtual Ride machen */
  async function sport(id) {
    if (!/^\d+$/.test(String(id))) throw new Error('Ungültige Aktivität');
    return { virtual: await virtual(await token(), id) };
  }
  /* Fahrt hochladen (TCX) und warten, bis Strava sie verarbeitet hat */
  async function upload({ tcx, name, description, externalId }) {
    const t = await token();
    const form = formOf({ data_type: 'tcx', name, description, trainer: '1', external_id: externalId });
    form.append('file', new Blob([tcx], { type: 'application/vnd.garmin.tcx+xml' }), `${externalId || 'wattbuch'}.tcx`);
    let up = await api('POST', '/api/v3/uploads', { token: t, form });
    for (let i = 0; i < 20 && !up.activity_id && !up.error; i++) {
      await new Promise(r => setTimeout(r, 1500));
      up = await api('GET', `/api/v3/uploads/${up.id_str || up.id}`, { token: t });
    }
    if (up.activity_id) return { activityId: String(up.activity_id), url: `https://www.strava.com/activities/${up.activity_id}`, virtual: await virtual(t, up.activity_id) };
    if (up.error) {
      /* schon hochgeladen? Strava nennt dann die vorhandene Aktivität */
      const dup = /duplicate of .*?(\d{6,})/i.exec(up.error);
      if (dup) return { activityId: dup[1], url: `https://www.strava.com/activities/${dup[1]}`, duplicate: true, virtual: await virtual(t, dup[1]) };
      throw new Error(up.error);
    }
    return { processing: true, uploadId: String(up.id_str || up.id) };
  }

  /* Eigene Aktivitäten lesen (braucht activity:read_all). after = Unix-Sekunden, Seiten zu je 100 */
  async function activities({ after, page = 1 } = {}) {
    const q = new URLSearchParams({ per_page: '100', page: String(page) });
    if (after) q.set('after', String(Math.floor(after)));
    return { list: await api('GET', `/api/v3/athlete/activities?${q}`, { token: await token() }) };
  }
  /* keys: ohne Angabe die Werte einer Fahrt, 'route' für Linie und Höhe (Strecken aus den meistgefahrenen Runden) */
  async function streams(id, kind) {
    if (!/^\d+$/.test(String(id))) throw new Error('Ungültige Aktivität');
    const keys = kind === 'route' ? 'latlng,altitude,distance' : 'time,watts,heartrate,cadence,distance,altitude,moving';
    return { streams: await api('GET', `/api/v3/activities/${id}/streams?keys=${keys}&key_by_type=true`, { token: await token() }) };
  }

  return { status, connect, disconnect, upload, activities, streams, sport };
}

module.exports = { createStrava };
