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

const fake = (page, fn) => page.evaluate(fn);
const toast = page => page.locator('#toast');

async function open(page, { before } = {}) {
  const problems = [];
  page.on('pageerror', e => problems.push('Fehler: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('Konsole: ' + m.text()); });
  await page.clock.install();
  await page.addInitScript({ path: FAKE });
  if (before) await page.addInitScript(before);
  await page.goto('/');
  await expect(page.locator('#v-live')).toHaveClass(/active/);
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
}

async function ride(page, seconds, { close = true } = {}) {
  await start(page);
  await page.clock.runFor(seconds * 1000);
  await page.click('[data-a="end"]');
  await page.click('[data-a="save"]');
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
  await expect(page.locator('[data-a="pause"]')).toBeVisible(); // Aufnahme läuft weiter
  expect(problems).toEqual([]);
});

test('Rolle verweigert Steuerung: verständlicher Hinweis', async ({ page }) => {
  await open(page, { before: () => { window.addEventListener('DOMContentLoaded', () => { window.__fakeBle.refuseControl = true; }); } });
  await connectTrainer(page);
  await page.locator('#ergQuick [data-w]').first().click();
  await page.clock.runFor(1500);
  await expect(page.locator('#ergMsg')).toContainText('gibt die Steuerung nicht frei');
});

test('Sicherung speichern, alles löschen, Sicherung wieder laden', async ({ page }) => {
  const problems = await open(page);
  await connectTrainer(page);
  await ride(page, 15);
  await expect(toast(page)).toHaveText('Fahrt gespeichert');

  await page.click('#btnSet');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bkExp')]);
  expect(dl.suggestedFilename()).toMatch(/^wattbuch-sicherung-\d{4}-\d\d-\d\d\.json$/);
  const backup = JSON.parse(require('node:fs').readFileSync(await dl.path(), 'utf8'));
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

test('Ohne Rolle testen (Demo) liefert Werte @mobil', async ({ page }) => {
  const problems = await open(page);
  await page.click('#chkDemo');
  await page.clock.runFor(3000);
  await expect(page.locator('#lvPow')).not.toHaveText('–');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
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
  await page.click('[data-a="end"]');
  await page.click('[data-a="discard"]');
  await page.click('[data-a="discard"]');
  await expect(page.locator('body')).not.toHaveClass(/riding/);
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
  await page.click('[data-a="end"]');
  await page.click('[data-a="save"]');
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

test('Erzeugte Strecken sind fahrbar und realistisch', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => ['huegel', 'berg', 'flach'].map(t => { const x = genRoute(t, 12345); let mx = 0; for (let i = 2; i < x.ele.length; i++) mx = Math.max(mx, Math.abs((x.ele[i] - x.ele[i - 2]) / 50 * 100)); return { t, km: x.dist / 1000, hm: x.gain, mx, loop: prepRoute(x, false).loop }; }));
  for (const x of r) { expect(x.km).toBeGreaterThan(15); expect(x.km).toBeLessThan(50); expect(x.mx).toBeLessThan(13); expect(x.loop).toBe(true); }
  expect(r.find(x => x.t === 'berg').hm).toBeGreaterThan(r.find(x => x.t === 'flach').hm);
});
