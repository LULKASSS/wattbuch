---
name: testen
description: Wattbuch lokal testen – automatische Tests mit simulierter Rolle laufen lassen, neue Tests schreiben oder die App im Browser ohne echte Geräte durchklicken. Nutzen bei "teste das", "läuft das noch", "probier das aus", "schreib einen Test", "schau dir das im Browser an".
---

# Wattbuch testen

1. **Alles prüfen:** `npm test` (Fehlercheck + Browsertests + Mac-App-Tests). Ausgabe lesen, Fehler beheben, wiederholen bis grün.
   - Nur Web: `npx playwright test --project=mac --project=iphone`
   - Nur Mac-App: `npx playwright test --project=app`
   - Einzelner Test: `npx playwright test -g "Zielleistung"`
2. **Selbst ansehen:** Dev-Server per `preview_start` mit Namen `wattbuch` starten, dann `http://localhost:5173/?fake` öffnen. „Verbinden“ verbindet sofort die simulierte Rolle. Werte steuern per JavaScript:
   - `__fakeBle.set({power:250, cad:90, hr:140})`
   - `__fakeBle.drop('trainer')` – Verbindungsabbruch
   - `__fakeBle.writes`, `__fakeBle.ergTarget`, `__fakeBle.grade` – was an die Rolle ging
   - `__fakeBle.refuseControl = true` – Rolle verweigert Steuerung
3. **Neue Funktion → neuer Test** in `test/app.spec.js`, im Stil der vorhandenen: `open(page)`, `connectTrainer(page)`, Zeit mit `page.clock.runFor(ms)` vorspulen, am Ende `expect(problems).toEqual([])` (keine Konsolenfehler).
4. Was die simulierte Rolle nicht abdeckt (echtes Bluetooth-Timing, D100-Eigenheiten): Lukas bitten, kurz mit der echten Rolle zu testen, und konkret sagen, worauf er achten soll.

Testdaten (GPX, Fahrten) immer im Test erzeugen, nie echte Dateien ins Repo legen.
