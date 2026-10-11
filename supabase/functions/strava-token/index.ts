/* Strava-Token-Tausch für Wattbuch (Supabase-Projekt „Apps“).
 * Alle nutzen dieselbe Strava-App (Client-ID 286463). Ihr Secret darf nicht in die öffentliche App, deshalb tauscht
 * diese Funktion Anmelde-Code bzw. Erneuerungs-Token gegen Zugangs-Token. Das Secret liegt nur als Supabase-Secret
 * STRAVA_CLIENT_SECRET hier. Sonst reicht die Funktion nichts an Strava durch (kein Proxy für die API).
 * Bereitstellen ohne JWT-Prüfung (der öffentliche sb_publishable-Schlüssel ist kein JWT). */
const ID = Deno.env.get('STRAVA_CLIENT_ID') ?? '286463';
const SECRET = Deno.env.get('STRAVA_CLIENT_SECRET') ?? '';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const out = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const ok = (s: unknown) => typeof s === 'string' && /^[\w.-]{6,128}$/.test(s);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return out({ error: 'Nur POST' }, 405);
  if (!SECRET) return out({ error: 'Strava ist auf dem Server noch nicht eingerichtet' }, 503);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return out({ error: 'Ungültige Anfrage' }, 400); }
  const f = new URLSearchParams({ client_id: ID, client_secret: SECRET });
  if (ok(b.code)) { f.set('grant_type', 'authorization_code'); f.set('code', b.code as string); }
  else if (ok(b.refresh_token)) { f.set('grant_type', 'refresh_token'); f.set('refresh_token', b.refresh_token as string); }
  else return out({ error: 'Ungültige Anfrage' }, 400);
  let r: Response;
  try { r = await fetch('https://www.strava.com/oauth/token', { method: 'POST', body: f }); }
  catch { return out({ error: 'Strava nicht erreichbar' }, 502); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return out({ error: d.message || `Strava antwortet ${r.status}` }, r.status >= 400 && r.status < 500 ? r.status : 502);
  const a = d.athlete;
  return out({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at, athlete: a ? { id: a.id, firstname: a.firstname, lastname: a.lastname } : undefined });
});
