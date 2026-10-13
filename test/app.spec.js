// Wattbuch im Browser durchspielen, mit simulierter Rolle (test/fake-ble.js).
// Die Uhr ist gefälscht (page.clock), 15 Sekunden Fahrt dauern deshalb nur Millisekunden.
const { test, expect } = require('@playwright/test');
const path = require('node:path');

const FAKE = path.join(__dirname, 'fake-ble.js');

/* Kleine Teststrecke: 3 km geradeaus, erst flach, dann 6 % bergauf */
function gpx() {
  let pts = '';
  for (let i = 0; i <= 120; i++) {
    const d = i * 25, ele = d < 1500 ? 100 : 100 + (d - 1500) * 0.06;
    pts += `<trkpt lat="${(50 + d / 111320).toFixed(6)}" lon="8.000000"><ele>${ele.toFixed(1)}</ele></trkpt>`;
  }
  return Buffer.from(`<?xml version="1.0"?><gpx version="1.1"><trk><name>Testhügel</name><trkseg>${pts}</trkseg></trk></gpx>`);
}

/* Synthetische Mac-Sicherung: n Fahrten à 30 min mit 200 W im Abstand von 3 Tagen, die zweitneueste ist ein FTP-Test (190 → 200 W) */
function backupOf(n) {
  const rides = [];
  for (let i = 0; i < n; i++) {
    const p = Array(1800).fill(200), dist = p.map((_, k) => (k + 1) * 8);
    rides.push({ id: 'syn' + i, start: new Date(Date.now() - (1 + 3 * i) * 864e5).toISOString(), name: 'Rollentraining', p, hr: null, cad: null, spd: null, dist, gain: 50,
      ftp: i >= 2 ? 190 : 200, weight: 75, trainer: true, ...(i === 1 ? { ftpTest: { ftp: 200, best: 267 } } : {}) });
  }
  return { app: 'wattbuch', version: 1, saved: new Date().toISOString(), settings: { ftp: 200, weight: 75 }, rides, routes: [] };
}
const json = (name, d) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(d)) });

const fake = (page, fn) => page.evaluate(fn);
const toast = page => page.locator('#toast');

async function open(page, { before, motion = false, realtime = false, url = '/', view = 'live' } = {}) {
  const problems = [];
  // Ohne motion: „Bewegung reduzieren“, die Szene zeichnet dann nur 2-mal pro Sekunde (vorgespulte Fahrten bleiben schnell)
  if (!motion) await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', e => problems.push('Fehler: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('Konsole: ' + m.text()); });
  if (!realtime) await page.clock.install();
  await page.addInitScript({ path: FAKE });
  if (before) await page.addInitScript(before);
  // Am Computer zeigt die Webseite sonst nur die Download-Seite
  if (!/[?&](app|handy|landing)\b/.test(url)) url = url.replace(/^([^?#]*)(\?[^#]*)?/, (_, p, q) => p + (q ? q + '&app' : '?app'));
  const landing = /[?&]landing\b/.test(url);
  await page.goto(url.replace(/[?&]landing\b/, ''));
  if (!landing) await expect(page.locator('#v-' + view)).toHaveClass(/active/);
  return problems;
}

async function connectTrainer(page) {
  await page.click('#btnTr');
  await expect(page.locator('#trSub')).toHaveText('Fake D100 · FTMS');
}

/* Start mit Countdown (3-2-1-Los ≈ 3 s) */
async function start(page) {
  await page.click('[data-a="start"]');
  await expect(page.locator('.countdown')).toBeVisible();
  await page.clock.runFor(3100);
  await expect(page.locator('.countdown')).toHaveCount(0);
  await expect(page.locator('#full')).toBeVisible(); // Fahrt-Ansicht öffnet sich von selbst
}

async function ride(page, seconds, { close = true } = {}) {
  await start(page);
  await page.clock.runFor(seconds * 1000);
  await page.click('#fCtrl [data-a="end"]');
  await page.click('#fCtrl [data-a="save"]');
  if (close && seconds >= 10) { await expect(page.locator('#dlgSum')).toBeVisible(); await page.click('#sumOk'); }
}

test('startet ohne Fehler, alle Ansichten gehen auf', async ({ page }) => {
  const problems = await open(page);
  await expect(page).toHaveTitle(/Wattbuch/);
  await expect(page.locator('#noBt')).toBeHidden();
  for (const v of ['rides', 'best', 'live']) {
    await page.click(`#nav [data-v="${v}"]`);
    await page.clock.runFor(500);
    await expect(page.locator(`#v-${v}`)).toHaveClass(/active/);
  }
  expect(problems).toEqual([]);
});

test('Rolle verbinden zeigt Live-Watt, Tempo und Puls der Rolle', async ({ page }) => {
  const problems = await open(page);
  await connectTrainer(page);
  await page.clock.runFor(3000);
  await expect(page.locator('#lvPow')).toHaveText('180');
  await expect(page.locator('#lvHR')).toHaveText('132');
  await expect(page.locator('#lvCad')).toHaveText('88');
  await fake(page, () => window.__fakeBle.set({ power: 260 }));
  await page.clock.runFor(4000);
  await expect(page.locator('#lvPow')).toHaveText('260');
  await page.click('#btnTr');
  await expect(page.locator('#trSub')).toHaveText('Nicht verbunden');
  expect(problems).toEqual([]);
});

test('Startkarte: Strecke, Geräte mit Live-Werten und Start, die Live-Karte erst während der Fahrt', async ({ page }) => {
  const problems = await open(page);
  await expect(page.locator('#startCard')).toBeVisible();
  await expect(page.locator('.card.live')).toBeHidden(); // keine leeren Nullen vor der Fahrt
  await expect(page.locator('#stFree')).toBeVisible(); // frei fahren ist vorgewählt
  await expect(page.locator('#startCtrls [data-a="start"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#startCtrls')).toContainText('Erst die Rolle verbinden');
  await page.locator('#rtList [data-route]').filter({ hasText: 'Bergwertung' }).click();
  await expect(page.locator('#startCard #routeLive')).toBeVisible();
  await expect(page.locator('#stFree')).toBeHidden();
  await expect(page.locator('#rlMeta')).toContainText('km ·');
  await connectTrainer(page);
  await page.clock.runFor(2000);
  await expect(page.locator('#trVal')).toHaveText('180 W');
  await expect(page.locator('#startCtrls [data-a="start"]')).not.toHaveAttribute('aria-disabled', 'true');
  await start(page);
  await page.click('#fClose');
  await expect(page.locator('#startCard')).toBeHidden();
  await expect(page.locator('.card.live')).toBeVisible();
  await expect(page.locator('.card.live #routeLive')).toBeVisible(); // Strecke wandert in die Live-Karte
  await expect(page.locator('#startCtrls')).toBeEmpty();
  await page.click('#nav [data-v="rides"]');
  await page.clock.runFor(500);
  await page.click('#recpill'); // Laufzeit oben führt zurück in die Fahrt
  await page.clock.runFor(500);
  await expect(page.locator('#v-live')).toHaveClass(/active/);
  await expect(page.locator('#full')).toBeVisible();
  await page.click('#fClose');
  await page.click('#ctrls [data-a="end"]');
  await page.click('#ctrls [data-a="discard"]');
  await page.click('#ctrls [data-a="discard"]');
  await expect(page.locator('#startCard #routeLive')).toBeVisible();
  expect(problems).toEqual([]);
});

test('Fahrt aufnehmen, speichern und nach Neuladen wiederfinden', async ({ page }) => {
  const problems = await open(page);
  await connectTrainer(page);
  await page.clock.runFor(2000);
  await ride(page, 20);
  await expect(toast(page)).toHaveText('Fahrt gespeichert');
  await expect(page.locator('#v-detail')).toHaveClass(/active/);
  await page.reload();
  await page.click('#nav [data-v="rides"]');
  await page.clock.runFor(500);
  await expect(page.locator('#v-rides')).toContainText('Rollentraining');
  const saved = await page.evaluate(() => S.rides.filter(r => !r.sample).map(r => ({ n: r.p.length, avg: r.p.reduce((a, b) => a + b, 0) / r.p.length })));
  expect(saved).toHaveLength(1);
  expect(saved[0].n).toBeGreaterThanOrEqual(19);
  expect(saved[0].avg).toBeGreaterThan(170);
  expect(problems).toEqual([]);
});

test('kurze Fahrt unter 10 Sekunden wird nicht gespeichert', async ({ page }) => {
  await open(page);
  await connectTrainer(page);
  await ride(page, 5);
  await expect(toast(page)).toHaveText('Unter 10 Sekunden, nicht gespeichert');
});

test('Zielleistung (ERG) geht als Befehl an die Rolle', async ({ page }) => {
  const problems = await open(page);
  await connectTrainer(page);
  await page.locator('#ergQuick [data-w]').nth(2).click(); // Schwelle = FTP 200 W
  await page.clock.runFor(1500);
  expect(await fake(page, () => window.__fakeBle.ergTarget)).toBe(200);
  const ops = await fake(page, () => window.__fakeBle.writes.map(w => w[0]));
  expect(ops.slice(0, 2)).toEqual([0x00, 0x07]); // erst Steuerung anfordern, dann Start
  await page.click('#ergCard .pm[data-d="10"]');
  await page.clock.runFor(1500);
  expect(await fake(page, () => window.__fakeBle.ergTarget)).toBe(210);
  await page.clock.runFor(3000);
  await expect(page.locator('#lvPow')).toHaveText('210');
  expect(problems).toEqual([]);
});

test('Strecke laden: Steigung geht an die Rolle', async ({ page }) => {
  const problems = await open(page);
  await page.setInputFiles('#anyFile', { name: 'testhuegel.gpx', mimeType: 'application/gpx+xml', buffer: gpx() });
  await expect(toast(page)).toHaveText('1 Strecke geladen');
  await page.locator('#rtList [data-route]').filter({ hasText: 'Testhügel' }).click();
  await expect(page.locator('#routeLive')).toBeVisible();
  await connectTrainer(page);
  await start(page);
  await page.clock.runFor(2000);
  expect(await fake(page, () => window.__fakeBle.grade)).toBe(0); // flacher Anfang
  // Vorspulen bis in den Anstieg (bei 180 W und 83 kg reicht das locker)
  await page.clock.runFor(240_000);
  const grade = await fake(page, () => window.__fakeBle.grade);
  expect(grade).toBeGreaterThan(2.5); // 6 % bei Steigungsstärke 50 % = 3 %
  expect(grade).toBeLessThan(3.5);
  await expect(page.locator('#rlGrade')).toContainText('+6');
  expect(problems).toEqual([]);
});

test('Pulsgurt und Trittfrequenzsensor', async ({ page }) => {
  const problems = await open(page);
  await page.click('#btnHr');
  await expect(page.locator('#hrSub')).toHaveText('Fake Pulsgurt');
  await page.click('#btnCd');
  await expect(page.locator('#cdSub')).toHaveText('Fake Kadenz');
  await fake(page, () => window.__fakeBle.set({ hr: 151, cad: 95 }));
  await page.clock.runFor(4000);
  await expect(page.locator('#lvHR')).toHaveText('151');
  await expect(page.locator('#lvCad')).toHaveText(/^9[4-6]$/);
  expect(problems).toEqual([]);
});

test('Verbindung reißt während der Fahrt ab und kommt wieder', async ({ page }) => {
  const problems = await open(page);
  await connectTrainer(page);
  await start(page);
  await page.clock.runFor(5000);
  await fake(page, () => window.__fakeBle.drop('trainer'));
  await expect(page.locator('#trSub')).toContainText('neuer Versuch 1/5');
  await page.clock.runFor(3000);
  await expect(page.locator('#trSub')).toHaveText('Fake D100 · FTMS');
  await expect(page.locator('#fCtrl [data-a="pause"]')).toBeVisible(); // Aufnahme läuft weiter
  expect(problems).toEqual([]);
});

test('Rolle verweigert Steuerung: verständlicher Hinweis', async ({ page }) => {
  await open(page, { before: () => { window.addEventListener('DOMContentLoaded', () => { window.__fakeBle.refuseControl = true; }); } });
  await connectTrainer(page);
  await page.locator('#ergQuick [data-w]').first().click();
  await page.clock.runFor(1500);
  await expect(page.locator('#ergMsg')).toContainText('gibt die Steuerung nicht frei');
});

test('Sicherung (wie in der Mac-App), alles löschen, Sicherung wieder laden', async ({ page }) => {
  const problems = await open(page);
  await connectTrainer(page);
  await ride(page, 15);
  await expect(toast(page)).toHaveText('Fahrt gespeichert');

  await page.click('#btnSet');
  const backup = JSON.parse(await page.evaluate(() => backupJSON()));
  expect(backup.app).toBe('wattbuch');
  expect(backup.rides).toHaveLength(1);

  await page.click('#delAll');
  await page.click('#delAll');
  await expect(toast(page)).toHaveText('Alle Fahrten gelöscht');
  expect(await page.evaluate(() => S.rides.length)).toBe(0);

  expect(backup.routes).toHaveLength(3); // Sicherung enthält auch die Strecken
  await page.setInputFiles('#anyFile', { name: 'sicherung.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(toast(page)).toHaveText('3 Strecken und 1 Fahrt geladen');
  expect(await page.evaluate(() => S.rides.length)).toBe(1);
  expect(problems).toEqual([]);
});

test('kaputte Datei laden gibt eine Meldung statt abzustürzen', async ({ page }) => {
  const problems = await open(page);
  await page.setInputFiles('#anyFile', { name: 'quatsch.json', mimeType: 'application/json', buffer: Buffer.from('{kein json') });
  await expect(toast(page)).toContainText('quatsch.json');
  expect(problems).toEqual([]);
});

test('Einstellungen: Konto oben, keine Test- und Übertragungsreste, FTP-Vorschlag aus dem FTP-Test', async ({ page }) => {
  const problems = await open(page);
  await expect(page.locator('#chkDemo')).toHaveCount(0); // „Ohne Rolle testen“ gibt es nicht mehr
  await page.setInputFiles('#anyFile', json('wattbuch-sicherung.json', backupOf(4)));
  await page.click('#btnSet');
  const dlg = page.locator('#dlgSet');
  await expect(dlg.locator('h3').first()).toHaveText('Konto');
  await expect(dlg.locator('#bkExp, #bkImp')).toHaveCount(0);
  await expect(dlg.locator('#ftpEst')).toBeHidden(); // FTP 200 = Ergebnis des FTP-Tests, nichts vorzuschlagen
  await dlg.locator('#setFtp').fill('180');
  await dlg.locator('#setFtp').press('Tab');
  await page.click('#dlgSet .dlg-foot button');
  await page.click('#btnSet');
  /* Test (200 W) schlägt die Schätzung aus dem besten 20-min-Wert (95 % von 200 = 190 W) */
  await expect(dlg.locator('#ftpEst')).toContainText('Aus FTP-Test vom');
  await expect(dlg.locator('#ftpEst')).toContainText('200 W');
  await dlg.locator('#ftpEst').click();
  expect(await page.evaluate(() => S.set.ftp)).toBe(200);
  await expect(dlg.locator('#ftpEst')).toBeHidden();
  expect(problems).toEqual([]);
});

test('Fahrt-Modus: Countdown, Zonen-Leuchten, Geräte treten zurück', async ({ page }) => {
  const problems = await open(page);
  await connectTrainer(page);
  await expect(page.locator('#btnTr')).toBeVisible();
  await start(page);
  await expect(page.locator('body')).toHaveClass(/riding/);
  await expect(page.locator('#btnTr')).toBeHidden();
  await expect(page.locator('#ergCard')).toBeVisible(); // Zielleistung bleibt während der Fahrt bedienbar
  await page.clock.runFor(2000);
  expect(await page.locator('.card.live').evaluate(e => e.style.getPropertyValue('--amb'))).toBe('var(--z3)'); // 180 W bei FTP 200
  await page.click('#fCtrl [data-a="end"]');
  await page.click('#fCtrl [data-a="discard"]');
  await page.click('#fCtrl [data-a="discard"]');
  await expect(page.locator('body')).not.toHaveClass(/riding/);
  await expect(page.locator('#full')).toBeHidden(); // nach dem Verwerfen zurück zu „Fahren“
  expect(problems).toEqual([]);
});

test('Moment und Zusammenfassung bei neuem Bestwert', async ({ page }) => {
  const problems = await open(page);
  // Frühere Fahrt mit 150 W über 5 min
  const old = { id: 'alt1', start: '2026-10-01T17:00:00.000Z', name: 'Alt', p: Array(400).fill(150), hr: null, cad: null };
  await page.setInputFiles('#anyFile', { name: 'alt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'wattbuch', rides: [old] })) });
  await expect(toast(page)).toHaveText('1 Fahrt geladen');
  await connectTrainer(page);
  await start(page);
  await page.clock.runFor(62_000);
  await expect(page.locator('#moment')).toHaveClass(/show/);
  await expect(page.locator('#moment')).toContainText('Neuer Bestwert 1 min');
  await expect(page.locator('#moment')).toContainText('bisher 150 W');
  await page.clock.runFor(10_000);
  await page.click('#fCtrl [data-a="end"]');
  await page.click('#fCtrl [data-a="save"]');
  const sum = page.locator('#dlgSum');
  await expect(sum).toBeVisible();
  await expect(sum.locator('h2')).toHaveText(/neue Bestwerte|Neuer Bestwert/);
  await expect(sum).toContainText('Bestwert 1 min: 180 W');
  await expect(sum).toContainText('+30 W gegenüber vorher');
  await page.clock.runFor(1500);
  await expect(sum.locator('[data-to]').nth(0)).toHaveText('180'); // Zahlen zählen hoch
  await page.click('#sumOk');
  await expect(sum).toBeHidden();
  await expect(page.locator('#v-detail')).toHaveClass(/active/);
  expect(problems).toEqual([]);
});

test('Zusammenfassung: Export für Strava lädt TCX', async ({ page }) => {
  await open(page);
  await connectTrainer(page);
  await ride(page, 15, { close: false });
  await expect(page.locator('#dlgSum')).toBeVisible();
  page.context().on('page', p => p.close()); // Strava-Upload-Seite nicht wirklich öffnen
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sumStrava')]);
  expect(dl.suggestedFilename()).toMatch(/^wattbuch-\d{4}-\d\d-\d\d\.tcx$/);
  const xml = require('node:fs').readFileSync(await dl.path(), 'utf8');
  expect(xml).toContain('<ns3:Watts>180</ns3:Watts>');
});

test('Webseite am Computer: nur Download für Mac und Windows, Mail-Bestätigung mit Hinweis', async ({ page }) => {
  const problems = await open(page, { url: '/?landing#access_token=x&type=signup' });
  await expect(page.locator('#landing')).toBeVisible();
  await expect(page.locator('#ldMac')).toHaveAttribute('href', /Wattbuch-mac-arm64\.zip$/);
  await expect(page.locator('#ldWin')).toHaveAttribute('href', /Wattbuch-Setup-win-x64\.exe$/);
  await expect(page.locator('#nav')).toBeHidden();
  await expect(page.locator('#ldOk')).toContainText('Konto aktiviert');
  expect(await page.evaluate(() => location.hash)).toBe('');
  expect(problems).toEqual([]);
});

test('Browser: Einstellungen bieten die App zum Laden an', async ({ page }) => {
  await open(page);
  await page.click('#btnSet');
  await expect(page.locator('#svMacApp')).toHaveAttribute('href', '/'); // führt zur Download-Seite
  await expect(page.locator('#svBox input')).toHaveCount(0);
});

/* Mac-App-Brücke für Strava nachgestellt: verbunden, Uploads landen in window.__uploads, __svFail lässt sie scheitern */
const fakeDesktopStrava = () => {
  window.__uploads = []; window.__svFail = false;
  window.wattbuchDesktop = { backup: async () => {}, strava: {
    status: async () => ({ ok: true, configured: true, connected: true, athlete: { name: 'Test' } }),
    upload: async x => { if (window.__svFail) return { ok: false, error: 'Keine Verbindung' }; window.__uploads.push(x); return { ok: true, activityId: '42', url: 'https://www.strava.com/activities/42' }; }
  } };
};

test('Strava: Fahrt mit Rolle geht von selbst hoch, abbrechen und nachholen', async ({ page }) => {
  const problems = await open(page, { before: fakeDesktopStrava });
  await connectTrainer(page);
  // 1. Nach kurzer Wartezeit ohne Zutun hochgeladen
  await ride(page, 15, { close: false });
  await expect(page.locator('#sumStrava')).toContainText('Geht gleich zu Strava');
  await page.clock.runFor(16000);
  await expect(page.locator('#sumStrava')).toHaveText('Auf Strava ansehen');
  let ups = await page.evaluate(() => window.__uploads);
  expect(ups).toHaveLength(1);
  expect(ups[0].externalId).toMatch(/^wattbuch-r/);
  expect(ups[0].tcx).toContain('<ns3:Watts>180</ns3:Watts>');
  await page.click('#sumOk');
  await page.click('[data-v="live"]');
  // 2. In der Zusammenfassung abgebrochen: bleibt draußen, Knopf zum Hochladen von Hand
  await ride(page, 15, { close: false });
  await page.click('#sumStrava [data-strava-cancel]');
  await page.clock.runFor(30000);
  await expect(page.locator('#sumStrava')).toHaveText('Zu Strava hochladen');
  expect(await page.evaluate(() => window.__uploads.length)).toBe(1);
  await page.click('#sumOk');
  await page.click('[data-v="live"]');
  // 3. Offline: schlägt fehl, wird später von selbst nachgeholt
  await page.evaluate(() => { window.__svFail = true; });
  await ride(page, 15, { close: false });
  await page.clock.runFor(16000);
  await expect(page.locator('#toast')).toContainText('wird später nochmal versucht');
  await page.evaluate(() => { window.__svFail = false; });
  await page.clock.runFor(125000);
  await expect(page.locator('#sumStrava')).toHaveText('Auf Strava ansehen');
  expect(await page.evaluate(() => window.__uploads.length)).toBe(2);
  expect(problems).toEqual([]);
});

test('Vorschlagsstrecken beim ersten Start und Würfeln', async ({ page }) => {
  const problems = await open(page);
  const rows = page.locator('#rtList [data-route]:not([data-route=""])');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Hügelrunde');
  await expect(rows.nth(1)).toContainText('Bergwertung');
  await expect(rows.nth(2)).toContainText('Flachstück');
  await page.click('#rtRoll');
  await expect(rows).toHaveCount(4);
  await expect(toast(page)).toContainText('Neue Strecke:');
  await expect(page.locator('#routeLive')).toBeVisible(); // gewürfelte Strecke ist gleich gewählt
  await page.reload();
  await expect(rows).toHaveCount(4); // keine doppelten Vorschläge nach Neuladen
  expect(problems).toEqual([]);
});

/* Mac-App-Brücke mit Strava-Fahrten draußen: Runde A 4-mal, Runde B 3-mal (gleicher Start, andere Richtung des Landes),
   Runde C nur 2-mal, dazu Zwift-Fahrten. Polylines wie bei Strava (map.summary_polyline), je Fahrt leicht verrauscht. */
const fakeStravaLoops = () => {
  const enc = pts => {
    let out = '', pa = 0, po = 0;
    const e = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
    for (const [a, b] of pts) { const la = Math.round(a * 1e5), lo = Math.round(b * 1e5); out += e(la - pa) + e(lo - po); pa = la; po = lo; }
    return out;
  };
  const circle = (lat, lon, r, w0, n, jit = 0) => Array.from({ length: n + 1 }, (_, i) => { const w = w0 + i / n * 2 * Math.PI; return [lat + r * Math.sin(w) + jit, lon + r * Math.cos(w) / Math.cos(lat * Math.PI / 180) - jit]; });
  const L = {
    a: { c: [50.05, 10, .05, -Math.PI / 2] }, b: { c: [49.95, 10, .05, Math.PI / 2] }, c: { c: [50, 10.4, .04, 0] }, v: { c: [-11.6, 166.9, .05, 0] }
  };
  for (const k in L) { const [la, lo, r, w] = L[k].c; L[k].km = 2 * Math.PI * r * 111.32; L[k].line = circle(la, lo, r, w, 400); L[k].poly = [0, 1, 2].map(j => enc(circle(la, lo, r, w, 40, (j - 1) * .0008))); }
  const acts = [], add = (k, name) => acts.push({ id: acts.length + 1, name, key: k, sport_type: k === 'v' ? 'VirtualRide' : 'Ride', trainer: k === 'v', start_date: new Date(Date.now() - (acts.length + 1) * 864e5).toISOString(), moving_time: 4000, distance: L[k].km * 1000, map: { summary_polyline: L[k].poly[acts.length % 3] } });
  ['Kanalrunde', 'Kanalrunde', 'Radfahrt am Abend', 'Kanalrunde'].forEach(n => add('a', n));
  ['Morning Ride', 'Abendradfahrt', 'Radfahrt am Morgen'].forEach(n => add('b', n));
  ['Seerunde', 'Seerunde'].forEach(n => add('c', n));
  for (let i = 0; i < 4; i++) add('v', 'Zwift');
  window.__routeStreams = [];
  window.wattbuchDesktop = { backup: async () => {}, strava: {
    status: async () => ({ ok: true, configured: true, connected: true, canRead: true, athlete: { name: 'Test' } }),
    activities: async ({ page }) => ({ ok: true, list: page === 1 ? acts : [] }),
    streams: async (id, kind) => {
      if (kind !== 'route') return { ok: true, streams: {} };
      window.__routeStreams.push(String(id));
      const pts = L[acts.find(a => a.id === +id).key].line;
      return { ok: true, streams: { latlng: { data: pts }, altitude: { data: pts.map((_, i) => 200 + 60 * Math.sin(i / 20)) } } };
    }
  } };
};

test('Strava: meistgefahrene Runden werden zu Strecken', async ({ page }) => {
  const problems = await open(page, { before: fakeStravaLoops });
  await expect(toast(page)).toHaveText('2 deiner meistgefahrenen Runden sind jetzt als Strecken da');
  const rows = page.locator('#rtList [data-route]:not([data-route=""])');
  await expect(rows).toHaveCount(5); // 3 Vorschläge + 2 Runden
  await expect(rows.nth(0)).toContainText('Kanalrunde');
  await expect(rows.nth(0)).toContainText('4× gefahren');
  await expect(rows.nth(1)).toContainText('Deine Runde · 35 km');
  await expect(rows.nth(1)).toContainText('3× gefahren');
  expect(await page.evaluate(() => window.__routeStreams)).toEqual(['1', '5']); // Linie aus der jüngsten Fahrt je Runde
  const rt = await page.evaluate(() => { const r = S.routes.find(x => x.id === 'sf1'); return { km: r.dist / 1000, gain: r.gain }; });
  expect(rt.km).toBeGreaterThan(33); expect(rt.km).toBeLessThan(37);
  expect(rt.gain).toBeGreaterThan(100);
  /* Gelöschte Runde kommt beim nächsten Durchlauf nicht wieder, die andere wird nicht doppelt angelegt */
  await page.click('[data-rdel="sf1"]');
  await page.click('[data-rdel="sf1"]');
  await page.evaluate(() => favRoutes(true));
  await expect(rows).toHaveCount(4);
  expect(await page.evaluate(() => S.routes.filter(r => r.fav).map(r => r.id))).toEqual(['sf5']);
  expect(problems).toEqual([]);
});

test('Erzeugte Strecken sind fahrbar und realistisch', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => ['huegel', 'berg', 'flach'].map(t => { const x = genRoute(t, 12345); let mx = 0; for (let i = 2; i < x.ele.length; i++) mx = Math.max(mx, Math.abs((x.ele[i] - x.ele[i - 2]) / 50 * 100)); return { t, km: x.dist / 1000, hm: x.gain, mx, loop: prepRoute(x, false).loop }; }));
  for (const x of r) { expect(x.km).toBeGreaterThan(15); expect(x.km).toBeLessThan(50); expect(x.mx).toBeLessThan(13); expect(x.loop).toBe(true); }
  expect(r.find(x => x.t === 'berg').hm).toBeGreaterThan(r.find(x => x.t === 'flach').hm);
});

/* Anteil nicht-schwarzer Pixel in einem Canvas: zeigt, dass dort wirklich gezeichnet wurde */
const painted = (page, sel) => page.locator(sel).evaluate(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 64) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n / (d.length / 64); });

test('Vollbild: Szene, große Anzeige, Tastatur', async ({ page }) => {
  const problems = await open(page, { motion: true });
  await page.locator('#rtList [data-route]').filter({ hasText: 'Bergwertung' }).click();
  await connectTrainer(page);
  await page.keyboard.press('f');
  await expect(page.locator('#full')).toBeVisible();
  await expect(page.locator('#fRoute')).toContainText('Bergwertung');
  await expect(page.locator('#fCtrl [data-a="start"]')).toBeVisible();
  await page.keyboard.press(' '); // Start per Leertaste, mit Countdown
  await page.clock.runFor(3100);
  await expect(page.locator('#fCtrl [data-a="pause"]')).toBeVisible();
  await page.clock.runFor(8_000); // kurz halten: mit voller Bewegung ist jedes Bild echte Arbeit (auf GitHub langsamer)
  await expect(page.locator('#fPow')).toHaveText('180');
  await expect(page.locator('#fZone')).toHaveText('Z3 · Tempo');
  await expect(page.locator('#fKmOf')).toContainText('von 25,5 km');
  await expect(page.locator('#fMapBox')).toBeVisible(); // Strecke von oben
  expect(await painted(page, '#cvFullMap')).toBeGreaterThan(0.01);
  await expect(page.locator('#fGhost')).toBeHidden(); // Schrittmacher nur mit Zielleistung
  await page.click('#fErgW');
  await page.clock.runFor(600);
  await expect(page.locator('#fGhost')).toContainText('Schrittmacher 130 W');
  expect(await painted(page, '#cvFull')).toBeGreaterThan(0.3);
  expect(await painted(page, '#cvFullProf')).toBeGreaterThan(0.05);
  await page.keyboard.press(' ');
  await expect(page.locator('#fCtrl [data-a="resume"]')).toBeVisible();
  await page.click('#fClose');
  await expect(page.locator('#full')).toBeHidden();
  await expect(page.locator('body')).toHaveClass(/riding/);
  await page.clock.runFor(200); // erstes Bild des Hintergrunds abwarten
  expect(await painted(page, '#cvBack')).toBeGreaterThan(0.2); // Straße läuft hinter der Übersicht weiter
  await page.click('#ctrls [data-full]');
  await expect(page.locator('#full')).toBeVisible();
  expect(problems).toEqual([]);
});

/* Hügel mit Kuppe: 600 m flach, 1 km mit 6 % hoch, 1 km mit 5 % runter, 400 m flach */
function gpxKuppe() {
  let pts = '', ele = 100;
  for (let i = 0; i <= 120; i++) {
    const d = i * 25;
    if (i) ele += 25 * (d <= 600 ? 0 : d <= 1600 ? 0.06 : d <= 2600 ? -0.05 : 0);
    pts += `<trkpt lat="${(50 + d / 111320).toFixed(6)}" lon="8.000000"><ele>${ele.toFixed(1)}</ele></trkpt>`;
  }
  return Buffer.from(`<?xml version="1.0"?><gpx version="1.1"><trk><name>Kuppe</name><trkseg>${pts}</trkseg></trk></gpx>`);
}

test('Coach: nur mit bekannter FTP, sagt Anstieg, Kuppe und Erholung an', async ({ page }) => {
  test.setTimeout(120_000); // sieben Minuten Fahrt, auf GitHub deutlich langsamer
  const problems = await open(page);
  await page.setInputFiles('#anyFile', { name: 'kuppe.gpx', mimeType: 'application/gpx+xml', buffer: gpxKuppe() });
  await page.locator('#rtList [data-route]').filter({ hasText: 'Kuppe' }).click();
  // Ohne bekannte FTP lässt sich kein Coach wählen
  await expect(page.locator('#coachSeg [data-coach="zuegig"]')).toBeDisabled();
  await expect(page.locator('#coachNote')).toContainText('FTP-Test');
  await page.evaluate(() => setFtp(220));
  await page.click('#coachSeg [data-coach="zuegig"]');
  await expect(page.locator('#coachNote')).toContainText('1 Anstieg, der größte 1,0 km');
  await connectTrainer(page);
  await start(page);
  await expect(page.locator('#fCoach')).toBeVisible();
  await page.click('#fErgW'); // Zielleistung aus: selbst treten, der Coach sagt nur an
  await page.clock.runFor(5_000);
  await expect(page.locator('#fGhost')).toBeHidden(); // mit Coach fährt niemand mit
  // Erst aufwärmen: 50 % FTP plus ein bisschen, nicht gleich die volle Leistung
  await expect(page.locator('#fCoachK')).toHaveText('Aufwärmen');
  expect(+(await page.locator('#fCoachW').textContent())).toBeLessThan(130);
  await page.clock.runFor(35_000);
  await expect(page.locator('#fCoachS')).toContainText('Anstieg in');
  await page.clock.runFor(60_000);
  await expect(page.locator('#fCoachK')).toHaveText('Am Berg');
  await expect(page.locator('#fCoachS')).toContainText('am Berg bringt jedes Watt Tempo'); // immer mit Begründung
  await expect(page.locator('#cvCoach')).toBeVisible(); // Ausblick auf die nächsten 1000 m
  await expect(page.locator('#fCoachI')).toContainText('passt'); // 180 W getreten, im Aufwärmen am Berg ist das genug
  await page.clock.runFor(400_000);
  const said = await page.evaluate(() => S.mom.log.map(m => m.title));
  expect(said.some(t => t.startsWith('Anstieg in'))).toBe(true);
  expect(said.some(t => /^Noch \d+ s drücken$/.test(t))).toBe(true);
  expect(said).toContain('Erst mal aufwärmen');
  expect(said).toContain('Aufgewärmt');
  expect(said).toContain('Jetzt erholen');
  expect(said).not.toContain('Etwas zu fest'); // bergab wird nicht gemahnt
  // Ausgeschaltet: keine Anzeige bei der nächsten Fahrt
  await page.click('#fCtrl [data-a="end"]');
  await page.click('#fCtrl [data-a="save"]');
  await page.click('#sumOk');
  await page.click('#nav [data-v="live"]');
  await page.click('#coachSeg [data-coach=""]');
  await start(page);
  await page.clock.runFor(5_000);
  await expect(page.locator('#fCoach')).toBeHidden();
  expect(problems).toEqual([]);
});

test('Coach: auch an sanfter Steigung „Mehr Watt“ mit konkreter Zielleistung', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = await open(page);
  // 3,5 km flach, dann 1,5 km mit 2 % (zu flach für einen „Anstieg“, aber Grund für mehr Druck)
  let pts = '', ele = 100;
  for (let i = 0; i <= 200; i++) { const d = i * 25; if (i) ele += 25 * (d > 3500 ? 0.02 : 0); pts += `<trkpt lat="${(50 + d / 111320).toFixed(6)}" lon="8.000000"><ele>${ele.toFixed(1)}</ele></trkpt>`; }
  await page.setInputFiles('#anyFile', { name: 'welle.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(`<?xml version="1.0"?><gpx version="1.1"><trk><name>Sanfte Rampe</name><trkseg>${pts}</trkseg></trk></gpx>`) });
  await page.locator('#rtList [data-route]').filter({ hasText: 'Sanfte Rampe' }).click();
  await page.evaluate(() => setFtp(220));
  await page.click('#coachSeg [data-coach="zuegig"]');
  await connectTrainer(page);
  await start(page);
  await page.click('#fErgW');
  await page.clock.runFor(330_000);
  await expect(page.locator('#fCoachK')).toHaveText('Flach');
  await expect(page.locator('#fCoachW')).toHaveText('175'); // 80 % FTP
  await page.clock.runFor(120_000);
  await expect(page.locator('#fCoachK')).toHaveText('Leicht bergauf');
  expect(+(await page.locator('#fCoachW').textContent())).toBeGreaterThan(190);
  await expect(page.locator('#fCoachI')).toContainText('mehr');
  const said = await page.evaluate(() => S.mom.log.map(m => m.title));
  expect(said.some(t => /^Mehr Watt: (19|20)\d W$/.test(t))).toBe(true);
  expect(said).toContain('Langsam angehen'); // 180 W gleich am Anfang ist zu viel fürs Aufwärmen
  // Dauerhaft über dem Ziel: der Coach traut dir mehr zu und hebt das Ziel an
  await fake(page, () => window.__fakeBle.set({ power: 260 }));
  await page.clock.runFor(300_000);
  expect(await page.evaluate(() => S.mom.log.map(m => m.title))).toContain('Du bist gut drauf');
  expect(await page.evaluate(() => S.coach.boost)).toBeGreaterThan(1);
  expect(problems).toEqual([]);
});

test('Coach stellt die Zielleistung der Rolle ein, eigene Änderung bleibt als Versatz', async ({ page }) => {
  const problems = await open(page);
  await page.evaluate(() => setFtp(220));
  await page.click('#coachSeg [data-coach="zuegig"]');
  await connectTrainer(page);
  await start(page);
  await page.clock.runFor(3_000);
  await expect(page.locator('#fErgL')).toHaveText('Coach');
  const coachW = +(await page.locator('#fCoachW').textContent());
  await expect(page.locator('#fErgW')).toHaveText(coachW + ' W');
  await expect.poll(() => fake(page, () => window.__fakeBle.ergTarget)).toBe(coachW); // die Rolle hält, was der Coach sagt
  await page.click('[data-ferg="10"]');
  await page.clock.runFor(2_000);
  await expect(page.locator('#fCoachK')).toContainText('+10 W von dir');
  await expect(page.locator('#fCoachW')).toHaveText(String(coachW + 10));
  // Nach dem Aufwärmen bleibt der Versatz auf der höheren Leistung
  await page.clock.runFor(310_000);
  await expect(page.locator('#fErgW')).toHaveText('185 W'); // 80 % von 220 = 175, plus 10
  await page.click('#fCtrl [data-a="end"]');
  await page.click('#fCtrl [data-a="save"]');
  await page.click('#sumOk');
  expect(await page.evaluate(() => S.erg.on)).toBe(false); // der Coach hat sie eingeschaltet, also auch wieder aus
  expect(problems).toEqual([]);
});

test('Coach: Aufwärmen überspringen', async ({ page }) => {
  const problems = await open(page);
  await page.evaluate(() => setFtp(220));
  await page.click('#coachSeg [data-coach="zuegig"]');
  await connectTrainer(page);
  await start(page);
  await page.clock.runFor(3_000);
  await expect(page.locator('#fCoachK')).toHaveText('Aufwärmen');
  await page.click('#fCoachSkip');
  await expect(page.locator('#fCoachK')).toHaveText('Flach');
  await expect(page.locator('#fCoachSkip')).toBeHidden();
  await expect(page.locator('#fErgW')).toHaveText('175 W'); // gleich die volle Leistung im Flachen
  await expect(page.locator('#fCoachS')).toContainText('Frei fahren');
  expect(await page.evaluate(() => S.mom.log.map(m => m.title))).toContain('Aufwärmen übersprungen');
  expect(problems).toEqual([]);
});

test('Auto-Pause: Stehenbleiben pausiert ohne Null-Watt-Sekunden, Antreten setzt fort, abschaltbar', async ({ page }) => {
  const problems = await open(page);
  await connectTrainer(page);
  await start(page);
  await page.clock.runFor(30_000);
  await fake(page, () => window.__fakeBle.set({ power: 0, cad: 0 }));
  await page.clock.runFor(20_000);
  expect(await page.evaluate(() => S.rec.state)).toBe('pause');
  const r = await page.evaluate(() => ({ n: S.rec.p.length, min: Math.min(...S.rec.p), t: Math.round(recElapsed() / 1000) }));
  expect(r.min).toBeGreaterThan(100); // die stehenden Sekunden sind wieder raus
  expect(r.t).toBe(r.n);
  expect(await page.evaluate(() => S.mom.log.map(m => m.title))).toContain('Automatisch pausiert');
  await fake(page, () => window.__fakeBle.set({ power: 180, cad: 88 }));
  await page.clock.runFor(5_000);
  expect(await page.evaluate(() => S.rec.state)).toBe('rec');
  // Von Hand pausiert: Treten setzt nicht fort
  await page.keyboard.press(' ');
  await page.clock.runFor(5_000);
  expect(await page.evaluate(() => S.rec.state)).toBe('pause');
  await page.keyboard.press(' ');
  // Abgeschaltet: bleibt in der Aufnahme
  await page.evaluate(() => { S.set.autoPause = false; });
  await fake(page, () => window.__fakeBle.set({ power: 0, cad: 0 }));
  await page.clock.runFor(10_000);
  expect(await page.evaluate(() => S.rec.state)).toBe('rec');
  expect(problems).toEqual([]);
});

test('Geist der besten Fahrt auf derselben Strecke fährt mit', async ({ page }) => {
  const problems = await open(page);
  const route = await page.evaluate(() => { selectRoute(S.routes[0].id); return activeRoute().name; });
  // Frühere Fahrt auf der Strecke: 7 m/s konstant
  const old = { id: 'g1', start: '2026-10-02T17:00:00.000Z', name: route, route, p: Array(600).fill(170), dist: Array.from({ length: 600 }, (_, i) => i * 7), hr: null, cad: null };
  await page.setInputFiles('#anyFile', { name: 'g.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'wattbuch', rides: [old] })) });
  await connectTrainer(page);
  await start(page);
  await page.clock.runFor(40_000);
  await expect(page.locator('#fGhost')).toContainText('Dein Geist');
  const gap = await page.evaluate(() => S.pace.total - S.sim.total);
  expect(gap).toBeGreaterThan(-400);
  expect(gap).toBeLessThan(400);
  await fake(page, () => window.__fakeBle.set({ power: 420 })); // kräftig antreten, bis zum Überholen
  await page.clock.runFor(90_000);
  expect(await page.evaluate(() => S.mom.log.map(m => m.title))).toContain('Dein Geist überholt');
  expect(problems).toEqual([]);
});

test('Ziel-Leistung per Pfeiltaste', async ({ page }) => {
  await open(page);
  await connectTrainer(page);
  await page.locator('#ergQuick [data-w]').first().click();
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('ArrowUp');
  await page.clock.runFor(1500);
  expect(await fake(page, () => window.__fakeBle.ergTarget)).toBe(135);
});

test('Strecke löschen mit Rückfrage', async ({ page }) => {
  const problems = await open(page);
  const rows = page.locator('#rtList [data-route]:not([data-route=""])');
  await expect(rows).toHaveCount(3);
  await rows.nth(1).click(); // Bergwertung wählen, dann löschen
  const del = page.locator('#rtList [data-rdel]').nth(1);
  await del.click({ force: true });
  await expect(del).toHaveText('Löschen?');
  await expect(rows).toHaveCount(3);
  await del.click();
  await expect(rows).toHaveCount(2);
  await expect(toast(page)).toContainText('gelöscht');
  await expect(page.locator('#routeLive')).toBeHidden(); // gewählte Strecke war weg → frei fahren
  await page.reload();
  await expect(rows).toHaveCount(2);
  expect(problems).toEqual([]);
});

test('Welt verändert sich: Tageszeit nach Fahrtdauer, Landschaft nach Strecke', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => ({ d: [0, 25, 45, 60, 85, 120].map(m => dayAt(m).n), alp: biomeAt(activeRoute() || { }, 100, 1500), low: [0, 3500, 7000, 10500, 14000].map(s => biomeAt(null, s, 100)) }));
  expect(r.d).toEqual(['Abendrot', 'Nacht', 'Morgengrauen', 'Tag', 'Sonnenuntergang', 'Nacht']);
  expect(r.alp).toBe('alpen');
  expect(new Set(r.low)).toEqual(new Set(['wald', 'felder']));
});

test('Fahrt-Ansicht: Zielleistung direkt bedienen', async ({ page }) => {
  const problems = await open(page);
  await connectTrainer(page);
  await start(page);
  await expect(page.locator('#fErgW')).toHaveText('Aus');
  await page.click('#fErg [data-ferg="10"]');
  await page.clock.runFor(1500);
  await expect(page.locator('#fErg')).toHaveClass(/on/);
  expect(await fake(page, () => window.__fakeBle.ergTarget)).toBe(140); // 130 + 10
  await expect(page.locator('#fErgW')).toHaveText('140 W');
  await page.click('#fErgW');
  await page.clock.runFor(600);
  await expect(page.locator('#fErgW')).toHaveText('Aus');
  expect(problems).toEqual([]);
});

test('Tageszeit-Wechsel wird gemeldet', async ({ page }) => {
  await open(page);
  await connectTrainer(page);
  await start(page);
  await page.clock.runFor(1500); // erste Sekunde: Abendrot merken
  await page.evaluate(() => { S.rec.acc = 5 * 60000; S.rec.run = performance.now(); });
  await page.clock.runFor(2000);
  await page.evaluate(() => { S.rec.acc = 25 * 60000; S.rec.run = performance.now(); });
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => S.mom.log.map(m => m.title))).toContain('Die Nacht bricht herein');
});

test('Straße bewegt sich in jedem Bild (kein Ruckeln im Takt der Simulation)', async ({ page }) => {
  await open(page, { motion: true });
  await connectTrainer(page);
  await start(page);
  await page.clock.runFor(4000); // auf Tempo kommen
  const pos = [];
  for (let i = 0; i < 16; i++) { await page.clock.runFor(17); pos.push(await page.evaluate(() => SCV.vp)); }
  const steps = pos.slice(1).map((v, i) => v - pos[i]);
  for (const s of steps) { expect(s).toBeGreaterThan(0.02); expect(s).toBeLessThan(0.6); } // jedes Bild ein kleines Stück, kein Sprung
});

test('Bluetooth nicht verfügbar: Hinweis statt Stille, Abbrechen bleibt still', async ({ page }) => {
  await open(page);
  await fake(page, () => { window.__fakeBle.fail = { name: 'NotFoundError', message: 'User cancelled the requestDevice() chooser.' }; });
  await page.click('#btnTr');
  await page.clock.runFor(500);
  await expect(toast(page)).not.toHaveClass(/show/);
  await fake(page, () => { window.__fakeBle.fail = { name: 'NotFoundError', message: 'Bluetooth adapter not available.' }; });
  await page.click('#btnTr');
  await expect(toast(page)).toContainText('Bluetooth nicht verfügbar');
  await fake(page, () => { window.__fakeBle.fail = null; });
  await page.click('#btnTr');
  await expect(page.locator('#trSub')).toHaveText('Fake D100 · FTMS');
});

test('Kein Flackern: Straße bleibt auch bei hohem Tempo ruhig (Echtzeit)', async ({ page }) => {
  test.skip(!!process.env.CI, 'braucht echte 60 Bilder/s, die der GitHub-Server ohne Grafikkarte nicht liefert');
  test.setTimeout(60_000);
  // Echtzeit statt gefälschter Uhr: Flackern entsteht im Zusammenspiel echter Bilder und Bewegung
  await open(page, { motion: true, realtime: true });
  await connectTrainer(page);
  await page.click('[data-a="start"]');
  await expect(page.locator('#full')).toBeVisible({ timeout: 6000 });
  // Kräftig treten und dabei schwanken wie eine echte Rolle
  await page.evaluate(() => { let i = 0; setInterval(() => window.__fakeBle.set({ power: [720, 820, 760, 880, 740][i++ % 5] }), 1000); });
  await page.waitForTimeout(6000);
  const r = await page.evaluate(async () => {
    const c = $('#cvFull'), ctx = c.getContext('2d'), W = c.width, H = c.height, GX = 120, GY = 80, fr = [];
    await new Promise(res => { let n = 0; const f = () => { const d = ctx.getImageData(0, 0, W, H).data, a = new Float32Array(GX * GY); for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) { const o = ((Math.floor((j + .5) / GY * H)) * W + Math.floor((i + .5) / GX * W)) * 4; a[j * GX + i] = d[o] * .3 + d[o + 1] * .59 + d[o + 2] * .11; } fr.push(a); if (++n < 180) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    // Flackern = ein Punkt springt hell→dunkel→hell (oder umgekehrt) innerhalb von 3 Bildern
    let unten = 0, gesamt = 0;
    for (let t = 1; t < fr.length - 1; t++) for (let p = 0; p < GX * GY; p++) { const d1 = fr[t][p] - fr[t - 1][p], d2 = fr[t + 1][p] - fr[t][p]; if (Math.abs(d1) > 18 && Math.abs(d2) > 18 && Math.sign(d1) !== Math.sign(d2)) { gesamt++; if (p / GX >= GY * .5) unten++; } }
    return { kmh: S.sim.v * 3.6, unten, gesamt };
  });
  expect(r.kmh).toBeGreaterThan(35);
  expect(r.unten).toBeLessThan(2); // untere Bildhälfte: Straße, Mittelstreifen, Ränder
  expect(r.gesamt).toBeLessThan(15);
});

test('Fahrt-Ansicht: Distanz groß, Steigung farbig mit Wort, Nebenwerte in Pillen', async ({ page }) => {
  const problems = await open(page);
  await page.setInputFiles('#anyFile', { name: 'testhuegel.gpx', mimeType: 'application/gpx+xml', buffer: gpx() });
  await page.locator('#rtList [data-route]').filter({ hasText: 'Testhügel' }).click();
  await connectTrainer(page);
  await start(page);
  await page.clock.runFor(2000);
  await expect(page.locator('#fGradeW')).toHaveText('flach');
  const flat = await page.locator('#fGradeBox').evaluate(e => e.style.getPropertyValue('--gc'));
  await page.evaluate(() => { S.sim.d = 2200; }); // mitten im 6-%-Anstieg
  await page.clock.runFor(2000);
  await expect(page.locator('#fGradeW')).toHaveText('steil');
  expect(await page.locator('#fGradeBox').evaluate(e => e.style.getPropertyValue('--gc'))).not.toBe(flat);
  await expect(page.locator('#fKm')).toHaveText(/^2,[2-3]$/);
  await expect(page.locator('#fKmOf')).toContainText('noch');
  await expect(page.locator('.f-pill')).toHaveCount(6); // Tempo, Ø Tempo, Kadenz · Ø Watt, Puls, Höhe
  await expect(page.locator('#fHr')).toHaveText('132');
  await expect(page.locator('#fCad')).toHaveText('88');
  expect(problems).toEqual([]);
});

test('Kadenzsensor ohne eigenen Dienst: Trittfrequenz über den Leistungsdienst', async ({ page }) => {
  const problems = await open(page);
  await fake(page, () => { window.__fakeBle.cdViaPower = true; window.__fakeBle.set({ cad: 92 }); });
  await page.click('#btnCd');
  await expect(page.locator('#cdSub')).toHaveText('Fake Kadenz');
  await page.clock.runFor(4000);
  await expect(page.locator('#lvCad')).toHaveText(/^9[1-3]$/);
  // Suche fragt auch nach Leistungsdienst und üblichen Sensornamen
  const req = await fake(page, () => window.__fakeBle.requests.at(-1));
  expect(req.filters.some(f => f.services && f.services.includes(0x1818))).toBe(true);
  expect(req.filters.some(f => f.namePrefix === 'Wahoo')).toBe(true);
  expect(problems).toEqual([]);
});

test('Rolle schickt Trittfrequenz über eigenen Kadenzdienst', async ({ page }) => {
  const problems = await open(page);
  await fake(page, () => { window.__fakeBle.trainerCad = 'csc'; window.__fakeBle.set({ cad: 78 }); });
  await connectTrainer(page);
  const req = await fake(page, () => window.__fakeBle.requests.at(-1));
  expect(req.optionalServices).toContain(0x1816);
  await page.clock.runFor(4000);
  await expect(page.locator('#lvCad')).toHaveText(/^7[7-9]$/);
  expect(problems).toEqual([]);
});

test('Rolle ohne Trittfrequenz: Hinweis auf den Sensor', async ({ page }) => {
  const problems = await open(page);
  await fake(page, () => { window.__fakeBle.trainerCad = 'none'; });
  await connectTrainer(page);
  await page.clock.runFor(10_000);
  await expect(page.locator('#toast')).not.toContainText('Trittfrequenz'); // erst nach 15 s treten
  await page.clock.runFor(7000);
  await expect(page.locator('#toast')).toContainText('sendet keine Trittfrequenz');
  expect(problems).toEqual([]);
});

test('Kadenzsensor nicht in der Liste: alle Geräte zeigen', async ({ page }) => {
  const problems = await open(page);
  await fake(page, () => { window.__fakeBle.cdHidden = true; });
  await expect(page.locator('#btnCdAll')).toBeHidden();
  await page.click('#btnCd');
  await expect(page.locator('#btnCdAll')).toBeVisible();
  await page.click('#btnCdAll');
  await expect(page.locator('#cdSub')).toHaveText('Fake Kadenz');
  await expect(page.locator('#btnCdAll')).toBeHidden();
  const req = await fake(page, () => window.__fakeBle.requests.at(-1));
  expect(req.acceptAllDevices).toBe(true);
  expect(req.optionalServices).toEqual(expect.arrayContaining([0x1816, 0x1818]));
  await page.clock.runFor(4000);
  await expect(page.locator('#lvCad')).toHaveText(/^8[7-9]$/);
  expect(problems).toEqual([]);
});

test('FTP-Test: Rampe bis zur Erschöpfung, Ergebnis übernehmen', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = await open(page);
  await connectTrainer(page);
  await expect(page.locator('#ftpNow')).toHaveText('FTP 200 W');
  await fake(page, () => { window.__fakeBle.maxPower = 200; }); // mehr geht nicht
  await page.click('#btnFtpTest');
  await page.clock.runFor(3100); // Countdown
  await expect(page.locator('#full')).toBeVisible();
  await page.clock.runFor(30_000);
  expect(await fake(page, () => window.__fakeBle.ergTarget)).toBe(100); // Start bei 50 % FTP
  await expect(page.locator('#fRampT')).toContainText('Stufe 1 · 100 W');
  await page.clock.runFor(120_000);
  expect(await fake(page, () => window.__fakeBle.ergTarget)).toBe(140); // nach 2:30 dritte Stufe
  await expect(page.locator('#fGhost')).toBeHidden(); // beim Test fährt niemand mit
  await page.clock.runFor(380_000); // bis Stufe 260 W, die er nicht mehr schafft
  expect(await page.evaluate(() => S.mom.log.map(m => m.title))).toContain('FTP-Test geschafft: 150 W');
  await expect(page.locator('#fRampT')).toContainText('FTP ≈ 150 W');
  await page.click('#fCtrl [data-a="end"]');
  await page.click('#fCtrl [data-a="save"]');
  const sum = page.locator('#dlgSum');
  await expect(sum.locator('h2')).toHaveText('FTP-Test geschafft');
  await expect(sum).toContainText('Deine FTP: 150 W');
  await expect(sum).toContainText('übernommen, bisher 200 W');
  expect(await page.evaluate(() => S.set.ftp)).toBe(150); // ohne Klick übernommen
  await expect(page.locator('#ftpNow')).toHaveText('FTP 150 W');
  await expect(page.locator('#sumFtp')).toHaveText('Zurück auf 200 W');
  await page.click('#sumFtp');
  expect(await page.evaluate(() => S.set.ftp)).toBe(200);
  expect(await page.evaluate(() => S.rides.find(r => r.ftpTest).name)).toBe('FTP-Test');
  expect(problems).toEqual([]);
});

test('Handy: Übersicht statt Aufnahme, Fahrten vom Mac @mobil', async ({ page }) => {
  const problems = await open(page, { url: '/?handy', view: 'home' });
  await expect(page.locator('#nav [data-v="live"]')).toBeHidden();
  await expect(page.locator('#nav [data-v="home"]')).toBeVisible();
  expect(await page.evaluate(() => S.rides.length)).toBe(0); // keine Beispielfahrt, keine Strecken
  expect(await page.evaluate(() => S.routes.length)).toBe(0);
  await expect(page.locator('#v-home')).toContainText('Noch keine Fahrten auf dem Handy');
  await page.setInputFiles('#anyFile', json('wattbuch-sicherung.json', backupOf(6)));
  await expect(toast(page)).toHaveText('6 Fahrten geladen');
  await expect(page.locator('#v-home .sub-h')).toContainText('6 Fahrten');
  await page.click('[data-per="a"]');
  await expect(page.locator('.hp-big b')).toHaveText('3:00');
  await expect(page.locator('.hp-n')).toHaveText('6 Fahrten');
  await expect(page.locator('.hp-g')).toContainText('86,4'); // 6 × 14,4 km
  await expect(page.locator('.hp-g')).toContainText('2.160'); // kJ
  await expect(page.locator('.hd')).not.toContainText('iCloud'); // kein Datei-Abgleich mehr, nur das Konto
  await expect(page.locator('.hf')).toContainText('190 → 200 W'); // FTP-Verlauf
  await expect(page.locator('.hr-c .row')).toHaveCount(3);
  /* Grafiken: Form, Balken, Zonen, Rekorde, Kalender */
  await expect(page.locator('.hform .hk3')).toContainText('Fitness');
  expect(await page.locator('.hbars rect.b').count()).toBeGreaterThan(0);
  await expect(page.locator('.hzd-l')).toContainText('Schwelle'); // 200 W bei FTP 200
  await expect(page.locator('.hrec-t')).toHaveCount(4);
  await expect(page.locator('.hrec-t').nth(3)).toContainText('200');
  expect(await page.locator('.hcal-s rect').count()).toBeGreaterThan(100);
  await page.locator('.hbars g[data-hb]').last().click({ force: true });
  await expect(page.locator('#hbCap')).toContainText(/Fahrt|keine Fahrt/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.click('#nav [data-v="rides"]');
  await page.clock.runFor(500);
  await expect(page.locator('#v-rides .row')).toHaveCount(6);
  await page.locator('#v-rides .row').first().click();
  await page.clock.runFor(500);
  await expect(page.locator('#v-detail')).toHaveClass(/active/);
  await expect(page.locator('#btnStrava')).toHaveCount(0); // hochgeladen wird vom Mac
  await page.click('#nav [data-v="best"]');
  await page.clock.runFor(500);
  await expect(page.locator('#v-best')).toHaveClass(/active/);
  await page.keyboard.press(' '); // Leertaste startet am Handy keine Fahrt
  await expect(page.locator('.countdown')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('Handy: Werte pflegen, Fahrt umbenennen und löschen @mobil', async ({ page }) => {
  const problems = await open(page, { url: '/?handy', view: 'home' });
  await page.setInputFiles('#anyFile', json('wattbuch-sicherung.json', backupOf(3)));
  await expect(toast(page)).toHaveText('3 Fahrten geladen');
  await page.click('[data-hv="ftp"][data-d="5"]');
  await expect(page.locator('#hFtp')).toHaveValue('205');
  await page.fill('#hKg', '72,5');
  await page.locator('#hKg').press('Enter');
  await expect(page.locator('#hWkg')).toHaveText('2,83');

  await page.click('#nav [data-v="rides"]');
  await page.clock.runFor(500);
  await page.locator('#v-rides .row').first().click();
  await page.clock.runFor(500);
  await page.fill('#rideName', 'Lockere Runde');
  await page.locator('#rideName').press('Enter');
  await page.click('#v-detail [data-go="rides"]');
  await page.clock.runFor(500);
  await page.locator('#v-rides .row').nth(1).click();
  await page.clock.runFor(500);
  await page.click('#btnDel');
  await page.click('#btnDel');
  await expect(toast(page)).toHaveText('Fahrt gelöscht');
  await page.clock.runFor(500);
  await expect(page.locator('#v-rides .row')).toHaveCount(2);

  const d = JSON.parse(await page.evaluate(() => backupJSON()));
  expect(d.from).toBe('handy');
  expect(d.settings.ftp).toBe(205);
  expect(d.settings.weight).toBe(72.5);
  expect(d.rides).toHaveLength(2);
  expect(d.gone).toEqual(['syn1']);
  expect(d.rides.find(r => r.id === 'syn0')).toMatchObject({ name: 'Lockere Runde' });
  expect(problems).toEqual([]);
});

test('Abgleich: Änderungen vom Handy kommen am Mac an, Gelöschtes kommt nicht zurück', async ({ page }) => {
  const problems = await open(page);
  const mac = backupOf(3);
  mac.rides[0].strava = { state: 'ok', id: 1, url: 'https://www.strava.com/activities/1' };
  await page.setInputFiles('#anyFile', json('wattbuch-sicherung.json', mac));
  await expect(toast(page)).toHaveText('3 Fahrten geladen');
  /* Handy hatte die Fahrt noch vor dem Strava-Upload, hat sie umbenannt, eine andere gelöscht und die FTP erhöht */
  const handy = JSON.parse(JSON.stringify(mac));
  Object.assign(handy, { from: 'handy', gone: ['syn2'], settings: { ftp: 210, weight: 74 } });
  handy.rides = handy.rides.slice(0, 2);
  delete handy.rides[0].strava;
  Object.assign(handy.rides[0], { name: 'Vom Handy', edited: Date.now() });
  await page.setInputFiles('#anyFile', json('wattbuch-handy-2026-10-11.json', handy));
  await expect(toast(page)).toHaveText('2 Fahrten geladen');
  const real = () => page.evaluate(() => S.rides.filter(r => !r.sample).map(r => ({ id: r.id, name: r.name, strava: r.strava && r.strava.state })).sort((a, b) => a.id.localeCompare(b.id)));
  expect(await real()).toEqual([{ id: 'syn0', name: 'Vom Handy', strava: 'ok' }, { id: 'syn1', name: 'Rollentraining', strava: undefined }]);
  expect(await page.evaluate(() => [S.set.ftp, S.set.weight])).toEqual([210, 74]);
  /* Alte Mac-Sicherung nochmal laden: Gelöschtes bleibt weg, der neuere Name bleibt */
  await page.setInputFiles('#anyFile', json('wattbuch-sicherung.json', mac));
  expect(await real()).toEqual([{ id: 'syn0', name: 'Vom Handy', strava: 'ok' }, { id: 'syn1', name: 'Rollentraining', strava: undefined }]);
  expect(JSON.parse(await page.evaluate(() => backupJSON())).gone).toEqual(['syn2']);
  expect(problems).toEqual([]);
});

test('Handy wird von selbst erkannt, ?fahren schaltet die Aufnahme wieder frei @mobil', async ({ page }) => {
  const phone = test.info().project.name === 'iphone';
  const problems = await open(page, { view: phone ? 'home' : 'live' });
  expect(await page.evaluate(() => HANDY)).toBe(phone);
  if (phone) {
    await page.goto('/?fahren');
    await expect(page.locator('#v-live')).toHaveClass(/active/);
    expect(await page.evaluate(() => HANDY)).toBe(false);
  }
  expect(problems).toEqual([]);
});

/* Nachgebautes Supabase (Anmeldung + die zwei Wattbuch-Tabellen) im Speicher, für mehrere Geräte gleichzeitig */
function fakeSupabase() {
  const users = new Map(), rides = new Map(), werte = new Map(), urls = [];
  let tick = 0;
  const ts = () => new Date(Date.UTC(2026, 0, 1) + ++tick * 1000).toISOString();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const session = u => ({ access_token: 'tok-' + u.id, refresh_token: 'ref-' + u.id, expires_in: 3600, user: { id: u.id, email: u.email } });
  async function handle(route) {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
    const send = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: body == null ? '' : JSON.stringify(body) });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    if (p === '/auth/v1/signup') {
      urls.push(req.url());
      if (body.email.startsWith('bestaetigen')) { users.set(body.email, { id: 'u' + (users.size + 1), email: body.email, pw: body.password }); return send(200, { id: 'x', email: body.email }); }
      if (users.has(body.email)) return send(422, { error_code: 'user_already_exists', msg: 'User already registered' });
      const u = { id: 'u' + (users.size + 1), email: body.email, pw: body.password }; users.set(u.email, u); return send(200, session(u));
    }
    if (p === '/auth/v1/token') {
      const u = url.searchParams.get('grant_type') === 'password' ? users.get(body.email) : [...users.values()].find(x => 'ref-' + x.id === body.refresh_token);
      if (!u || (body.password != null && u.pw !== body.password)) return send(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(200, session(u));
    }
    if (p === '/auth/v1/logout') return send(204);
    if (p === '/auth/v1/user') { const id = (req.headers()['authorization'] || '').replace('Bearer tok-', ''), u = [...users.values()].find(x => x.id === id); return u ? send(200, { id: u.id, email: u.email }) : send(401, { msg: 'invalid' }); }
    const uid = (req.headers()['authorization'] || '').replace('Bearer tok-', '');
    if (![...users.values()].some(u => u.id === uid)) return send(401, { message: 'JWT expired' });
    if (p === '/rest/v1/wattbuch_fahrten' && m === 'GET') {
      const gt = (url.searchParams.get('geaendert') || '').replace(/^gt\./, ''), lim = +url.searchParams.get('limit') || 1000;
      const rows = [...rides.values()].filter(r => r.user_id === uid && (!gt || r.geaendert > gt)).sort((a, b) => a.geaendert.localeCompare(b.geaendert)).slice(0, lim);
      return send(200, rows.map(({ id, data, geloescht, geaendert }) => ({ id, data, geloescht, geaendert })));
    }
    if (p === '/rest/v1/wattbuch_fahrten' && m === 'POST') {
      const out = body.map(r => { const row = { ...r, user_id: uid, geaendert: ts() }; rides.set(uid + '|' + r.id, row); return { id: r.id, geaendert: row.geaendert }; });
      return send(201, out);
    }
    if (p === '/rest/v1/wattbuch_werte' && m === 'GET') return send(200, werte.has(uid) ? [werte.get(uid)] : []);
    if (p === '/rest/v1/wattbuch_werte' && m === 'POST') { const row = { werte: body[0].werte, geaendert: ts() }; werte.set(uid, row); return send(201, [{ geaendert: row.geaendert }]); }
    return send(404, { message: 'unbekannt ' + p });
  }
  return {
    route: ctx => ctx.route('https://nysoyxbsdsxdvyknnkbc.supabase.co/**', handle),
    rides: () => [...rides.values()], werte: uid => werte.get(uid), urls
  };
}
/* Uhr weiterdrehen, bis der Abgleich durch ist (Netz läuft echt, Wartezeiten mit der gefälschten Uhr) */
const settle = async (page, fn, want) => expect.poll(async () => { await page.clock.runFor(2000); return fn(); }, { timeout: 10000 }).toEqual(want);

test('Konto: Bestätigungs-Mail führt zurück zu Wattbuch und meldet gleich an', async ({ page }) => {
  const sb = fakeSupabase();
  await sb.route(page.context());
  let problems = await open(page);
  await page.click('#btnSet');
  const box = page.locator('#dlgSet .konto');
  await box.locator('[name=email]').fill('bestaetigen@example.org');
  await box.locator('[name=pw]').fill('geheim123');
  await box.locator('[data-k="neu"]').click();
  await expect(box).toContainText('Link in der Mail');
  expect(new URL(sb.urls[0]).searchParams.get('redirect_to')).toBe('https://lulkasss.github.io/wattbuch/');
  // Link aus der Mail: Supabase schickt mit der Anmeldung im Anker zurück (frisch laden, nur der Anker ändert sonst nichts)
  await page.goto('about:blank');
  problems = await open(page, { url: '/#access_token=tok-u1&refresh_token=ref-u1&expires_in=3600&token_type=bearer&type=signup' });
  await expect(toast(page)).toHaveText('E-Mail bestätigt, du bist angemeldet');
  expect(await page.evaluate(() => location.hash)).toBe('');
  await page.click('#btnSet');
  await expect(page.locator('#dlgSet .konto')).toContainText('Angemeldet als bestaetigen@example.org');
  // Abgelaufener Link: verständlicher Hinweis statt Fehler
  await page.goto('about:blank');
  problems = await open(page, { url: '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired' });
  await expect(toast(page)).toContainText('abgelaufen oder schon benutzt');
  expect(problems).toEqual([]);
});

test('Konto: Fahrten vom Mac kommen von selbst aufs Handy, Änderungen am Handy zurück', async ({ page, browser }) => {
  const sb = fakeSupabase();
  await sb.route(page.context());
  const problems = await open(page);
  await page.setInputFiles('#anyFile', json('wattbuch-sicherung.json', backupOf(3)));
  await expect(toast(page)).toHaveText('3 Fahrten geladen');
  /* Mac: Konto anlegen, alles geht hoch */
  await page.click('#btnSet');
  const box = page.locator('#dlgSet .konto');
  await box.locator('[name=email]').fill('fahrer@example.org');
  await box.locator('[name=pw]').fill('geheim123');
  await box.locator('[data-k="neu"]').click();
  await expect(box).toContainText('Angemeldet als fahrer@example.org');
  await settle(page, () => sb.rides().map(r => r.id).sort(), ['syn0', 'syn1', 'syn2']);
  expect(sb.werte('u1').werte.ftp).toBe(200);
  await page.click('#dlgSet .dlg-foot button');

  /* Handy: anmelden, Fahrten erscheinen ohne Datei */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await sb.route(ctx);
  const phone = await ctx.newPage();
  const problems2 = await open(phone, { url: '/?handy', view: 'home' });
  const hb = phone.locator('#v-home .konto').first();
  await hb.locator('[name=email]').fill('fahrer@example.org');
  await hb.locator('[name=pw]').fill('falsch');
  await hb.locator('[data-k="in"]').click();
  await expect(hb.locator('.k-msg')).toHaveText('E-Mail oder Passwort stimmt nicht');
  await hb.locator('[name=pw]').fill('geheim123');
  await hb.locator('[name=pw]').press('Enter');
  await settle(phone, () => phone.evaluate(() => S.rides.length), 3);
  await expect(phone.locator('#v-home .sub-h')).toContainText('3 Fahrten');
  await expect(phone.locator('.hd')).toContainText('Angemeldet als fahrer@example.org');

  /* Handy: umbenennen, löschen, FTP ändern → landet im Konto */
  await phone.click('[data-hv="ftp"][data-d="5"]');
  await phone.evaluate(async () => { const r = S.rides.find(x => x.id === 'syn0'); r.name = 'Vom Handy'; r.edited = Date.now(); await DB.put(r); await forget(S.rides.find(x => x.id === 'syn1')); });
  await settle(phone, () => sb.rides().filter(r => r.geloescht).map(r => r.id), ['syn1']);
  await settle(phone, () => sb.werte('u1').werte.ftp, 205);
  expect(sb.rides().find(r => r.id === 'syn0').data.name).toBe('Vom Handy');

  /* Mac gleicht ab (beim nächsten Anlass von selbst, hier direkt) */
  await page.evaluate(() => sync());
  expect(await page.evaluate(() => S.rides.filter(r => !r.sample).map(r => r.id + ':' + r.name).sort())).toEqual(['syn0:Vom Handy', 'syn2:Rollentraining']);
  expect(await page.evaluate(() => S.set.ftp)).toBe(205);

  /* Neue Fahrt am Mac → Handy */
  await connectTrainer(page);
  await ride(page, 15);
  await settle(page, () => sb.rides().filter(r => !r.geloescht).length, 3);
  await phone.evaluate(() => sync());
  expect(await phone.evaluate(() => S.rides.length)).toBe(3);
  expect(problems).toEqual([]);
  expect(problems2.filter(x => !/status of 400/.test(x))).toEqual([]); // 400 = absichtlich falsches Passwort
  await ctx.close();
});

test('Fahrt zeigt Ø Watt und Ø km/h', async ({ page }) => {
  const problems = await open(page);
  await connectTrainer(page);
  await start(page);
  await page.clock.runFor(30000);
  await expect(page.locator('#fPowAvg')).toHaveText('180');
  await expect(page.locator('#fSpdAvg')).toHaveText(/^\d+,\d$/);
  const avg = parseFloat((await page.locator('#fSpdAvg').textContent()).replace(',', '.'));
  expect(avg).toBeGreaterThan(20);
  expect(avg).toBeLessThan(45);
  await page.click('#fClose');
  await expect(page.locator('#lvSpdAvg')).toHaveText(/^Ø \d+,\d$/);
  expect(problems).toEqual([]);
});

test('Fahrt ohne Wattmesser (aus Strava): Liste, Detail, Übersicht, keine Rekorde', async ({ page }) => {
  const problems = await open(page, { url: '/?handy', view: 'home' });
  const n = 3600, out = { id: 'sv1', start: new Date(Date.now() - 2 * 864e5).toISOString(), name: 'Hausrunde', src: 'strava', noW: true, dur: n, estW: 180,
    p: [], hr: Array(n).fill(150), cad: Array(n).fill(80), spd: null, dist: Array.from({ length: n }, (_, i) => (i + 1) * 8), alt: Array(n).fill(200), gain: 400,
    strava: { state: 'ok', id: '1', url: 'https://www.strava.com/activities/1' } };
  const b = backupOf(1); b.rides.push(out);
  await page.setInputFiles('#anyFile', json('wattbuch-sicherung.json', b));
  await expect(toast(page)).toHaveText('2 Fahrten geladen');
  await page.click('[data-per="a"]');
  await expect(page.locator('.hp-big b')).toHaveText('1:30'); // 30 min Rolle + 60 min draußen
  await expect(page.locator('.hrec-t').nth(3)).toContainText('200'); // Rekorde nur aus echter Messung
  await page.click('#nav [data-v="rides"]');
  await page.clock.runFor(500);
  await expect(page.locator('#v-rides .row[data-ride="sv1"]')).toContainText('~180');
  await page.locator('#v-rides .row[data-ride="sv1"]').click();
  await page.clock.runFor(500);
  await expect(page.locator('#v-detail .hero')).toContainText('28,8'); // km
  await expect(page.locator('#v-detail .kv')).toContainText('~180');
  await expect(page.locator('#cvRide')).toBeVisible(); // Pulsverlauf
  await page.click('#nav [data-v="best"]');
  await page.clock.runFor(500);
  await expect(page.locator('#v-best')).toHaveClass(/active/);
  expect(problems).toEqual([]);
});

/* Mac-App-Brücke für das Apple TV nachgestellt: ein Gerät „Wohnzimmer“, zwei Codes (1234, 5678), Tasten landen in window.__tvKeys.
   paired=true: schon gekoppelt. Läuft gerade etwas, meldet es state 'playing'. */
const fakeDesktopTv = (paired, on = true) => {
  window.__tvKeys = []; let cb = null, step = 0, dev = paired ? { id: 'ATV1', name: 'Wohnzimmer' } : null, conn = false, state = on ? 'playing' : 'idle';
  const emit = m => setTimeout(() => cb && cb(m), 0);
  const status = () => ({ ok: true, device: dev, connected: conn, play: conn ? { state } : null, power: conn ? on : null, prepared: true });
  window.wattbuchDesktop = { backup: async () => {}, appletv: {
    status: async () => status(), prepare: async () => ({ ok: true }),
    scan: async () => ({ ok: true, devices: [{ id: 'ATV1', name: 'Wohnzimmer', model: 'Apple TV 4K' }] }),
    pair: async () => { step = 1; return { ok: true, pin: true }; },
    pin: async c => {
      if (c !== ['', '1234', '5678'][step]) return { ok: false, error: 'Code stimmt nicht. Auf dem Fernseher steht jetzt ein neuer.' };
      if (step === 1) { step = 2; return { ok: true, pin: true, again: true }; }
      dev = { id: 'ATV1', name: 'Wohnzimmer' }; return { ok: true, done: true, ...status() };
    },
    cancel: async () => ({ ok: true }),
    connect: async () => { conn = true; emit({ ev: 'state', connected: true }); emit({ ev: 'power', on }); emit({ ev: 'play', state, title: 'Testfolge', app: 'Testkino' }); return status(); },
    key: async k => {
      window.__tvKeys.push(k);
      const s = { play: 'playing', pause: 'paused', play_pause: state === 'playing' ? 'paused' : 'playing' }[k];
      if (s) { state = s; emit({ ev: 'play', state, title: 'Testfolge', app: 'Testkino' }); }
      if (k === 'turn_on' || k === 'turn_off') { on = k === 'turn_on'; state = on ? 'playing' : 'idle'; emit({ ev: 'power', on }); emit({ ev: 'play', state, title: 'Testfolge', app: 'Testkino' }); }
      return { ok: true };
    },
    forget: async () => { dev = null; conn = false; return { ok: true, ...status() }; },
    onEvent: f => { cb = f; }
  } };
};

test('Apple TV: im Browser unsichtbar', async ({ page }) => {
  await open(page);
  await expect(page.locator('#fTv')).toBeHidden();
  await page.click('#btnSet');
  await expect(page.locator('#tvWrap')).toBeHidden();
  await page.keyboard.press('t');
  await expect(page.locator('#full')).toBeHidden();
});

test('Apple TV: suchen und mit zwei Codes koppeln', async ({ page }) => {
  const problems = await open(page, { before: `(${fakeDesktopTv})(false)` });
  await page.click('#btnSet');
  await expect(page.locator('#tvWrap')).toBeVisible();
  await page.click('#tvScan');
  await page.click('[data-tvdev="ATV1"]');
  await expect(page.locator('#tvBox')).toContainText('Auf dem Fernseher erscheint ein Code');
  await page.fill('#tvPin', '0000');
  await page.click('#tvPinOk');
  await expect(page.locator('#tvBox')).toContainText('Code stimmt nicht');
  await page.fill('#tvPin', '1234');
  await page.click('#tvPinOk');
  await expect(page.locator('#tvBox')).toContainText('zweiter Code');
  await page.fill('#tvPin', '5678');
  await page.press('#tvPin', 'Enter');  // Enter koppelt und lässt den Dialog offen
  await expect(toast(page)).toHaveText('Mit Wohnzimmer gekoppelt');
  await expect(page.locator('#dlgSet')).toBeVisible();
  await expect(page.locator('#tvBox')).toContainText('Wohnzimmer');
  await expect(page.locator('#tvAuto')).toBeChecked();
  await page.click('#tvOff');
  await expect(page.locator('#tvScan')).toBeVisible();
  expect(problems).toEqual([]);
});

test('Apple TV: aus nur ein An/Aus-Knopf, an steht die Fernbedienung ganz da, automatisch pausieren', async ({ page }) => {
  const problems = await open(page, { before: `(${fakeDesktopTv})(true, false)` }); // Apple TV im Ruhezustand
  await connectTrainer(page);
  await page.clock.runFor(2000);
  await start(page);
  await page.clock.runFor(2000); // Fahrt-Ansicht verbindet und erfährt: aus
  const keys = () => page.evaluate(() => window.__tvKeys.slice());
  const ride = () => page.evaluate(() => S.rec.state);
  await expect(page.locator('#fTv')).toBeVisible();
  await expect(page.locator('#fTv')).toHaveClass(/pw/);
  await expect(page.locator('#fTvPad')).toBeHidden();
  await expect(page.locator('.f-keys')).toHaveCount(0); // keine Tasten-Legende in der Fahrt-Ansicht
  // Aus: Leertaste bleibt bei der Fahrt
  await page.keyboard.press(' ');
  expect(await ride()).toBe('pause');
  await page.keyboard.press(' ');
  expect(await ride()).toBe('rec');
  expect(await keys()).toEqual([]);
  // Einschalten: die Fernbedienung steht ganz da, der Knopf oben verschwindet
  await page.click('#fTv');
  await page.clock.runFor(500);
  await expect(page.locator('#fTvPad')).toBeVisible();
  await expect(page.locator('#fTv')).toBeHidden();
  await expect(page.locator('#fTvNow')).toHaveText('Testkino · Testfolge');
  expect(await keys()).toEqual(['turn_on']);
  // Aufhören zu treten: nach 5 s hält das Apple TV an, wieder treten lässt es weiterlaufen
  await fake(page, () => window.__fakeBle.set({ power: 0, cad: 0 }));
  await page.clock.runFor(8000);
  expect(await keys()).toEqual(['turn_on', 'pause']);
  await expect(toast(page)).toHaveText('Apple TV pausiert');
  await fake(page, () => window.__fakeBle.set({ power: 200, cad: 88 }));
  await page.clock.runFor(4000);
  expect(await keys()).toEqual(['turn_on', 'pause', 'play']);
  // Zuklappen (T): Leertaste pausiert wieder die Fahrt, das Apple TV hält mit an und läuft mit weiter
  await page.keyboard.press('t');
  await expect(page.locator('#fTvPad')).toBeHidden();
  await expect(page.locator('#fTv')).not.toHaveClass(/pw/);
  await page.keyboard.press(' ');
  await page.clock.runFor(2000);
  expect(await ride()).toBe('pause');
  await page.keyboard.press(' ');
  await page.clock.runFor(4000);
  expect(await keys()).toEqual(['turn_on', 'pause', 'play', 'pause', 'play']);
  // Wieder aufklappen: Tasten gehen ans Apple TV, nicht an die Fahrt
  await page.keyboard.press('t');
  await expect(page.locator('#fTvPad')).toBeVisible();
  for (const k of ['ArrowDown', 'ArrowRight', 'Enter', 'Escape', ' ', '+', '-', 'h']) await page.keyboard.press(k);
  await page.click('#fTvPad [data-tv="up"]');
  await page.clock.runFor(500);
  expect((await keys()).slice(5)).toEqual(['down', 'right', 'select', 'menu', 'play_pause', 'volume_up', 'volume_down', 'home', 'up']);
  expect(await ride()).toBe('rec');
  await expect(page.locator('#full')).toBeVisible();
  // Von Hand pausiert: Wattbuch setzt nicht von selbst fort
  await page.click('#fTvClose');
  await expect(page.locator('#fTvPad')).toBeHidden();
  await fake(page, () => window.__fakeBle.set({ power: 0, cad: 0 }));
  await page.clock.runFor(8000);
  await fake(page, () => window.__fakeBle.set({ power: 200, cad: 88 }));
  await page.clock.runFor(4000);
  expect((await keys()).slice(14)).toEqual([]);
  // Ausschalten in der Fernbedienung: zurück zum An/Aus-Knopf
  await page.click('#fTv');
  await expect(page.locator('#fTvPad')).toBeVisible();
  await page.click('#fTvOff');
  await page.clock.runFor(500);
  await expect(page.locator('#fTvPad')).toBeHidden();
  await expect(page.locator('#fTv')).toHaveClass(/pw/);
  expect((await keys()).slice(14)).toEqual(['turn_off']);
  expect(problems).toEqual([]);
});
