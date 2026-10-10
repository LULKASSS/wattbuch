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

async function open(page, { before, motion = false, realtime = false } = {}) {
  const problems = [];
  // Ohne motion: „Bewegung reduzieren“, die Szene zeichnet dann nur 2-mal pro Sekunde (vorgespulte Fahrten bleiben schnell)
  if (!motion) await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', e => problems.push('Fehler: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('Konsole: ' + m.text()); });
  if (!realtime) await page.clock.install();
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
  await expect(page.locator('#fProg')).toContainText('von 25,5 km');
  await expect(page.locator('#fGhost')).toContainText('Schrittmacher 150 W');
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

test('Ziel-Leistung per Pfeiltaste @mobil', async ({ page }) => {
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
