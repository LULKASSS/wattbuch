---
name: testen
description: Wattbuch Neu testen – automatische Tests mit simulierter Rolle laufen lassen, neue Tests schreiben oder die App ohne echte Geräte durchfahren und Bilder machen. Nutzen bei "teste das", "läuft das noch", "probier das aus", "schreib einen Test", "zeig mir Bilder".
---

# Wattbuch Neu testen

1. **Alles:** `npm test` (Fehlercheck, Typen, Logik, Build, App). Exit-Code prüfen, nicht durch `| tail` leiten.
   - Nur Logik: `npx vitest run` · Nur App: `npx vite build && npx playwright test` · Einzeln: `npx playwright test -g "Rivalen"`
2. **Ansehen:** `npm run app:sim` startet die App mit simulierter Rolle (Daten in `.sim/`). Der simulierte Fahrer tritt ab dem Countdown ungefähr das Ziel.
3. **Bilder:** `node scripts/bilder.mjs <Ordner> [Sekunden Fahrt]`, mit `RIVALE=1` die Runde mit Rivalen, mit `RUNDE=1` zusätzlich eine andere Runde. Bilder ansehen, bevor Lukas sie bekommt.
4. **Steuern in Tests** (Seite des Maschinenraums): `__fakeBle.set({power, cad, hr})`, `__fakeBle.grade`/`ergTarget`/`writes`/`requests`, `__fakeBle.drop('trainer')`, `__simFahrer.aus = true` (dann gelten die gesetzten Werte), `__simFahrer.faktor`. Zustand: `__wb.z` (beide Fenster), Welt: `__wb.welt` (Bühne).
5. **Neue Funktion → neuer Test:** Rechenregel in `test/kern/kern.test.ts`, Ablauf in `test/app.spec.js` im Stil der vorhandenen (`ordner()`, `starte(dir, tempo)`, am Ende `expect(probleme).toEqual([])`). `WATTBUCH_TEMPO` lässt die Uhr der Fahrt schneller laufen.
6. Immer `WATTBUCH_DATA=<tmp>`, nie der echte Datenordner. Testdaten im Test erzeugen, nie echte Dateien ins Repo.
7. Was die simulierte Rolle nicht abdeckt (echtes Bluetooth, Verbinden ohne Dialog, D100-Eigenheiten): Lukas bitten, kurz mit der echten Rolle zu testen, und sagen, worauf er achten soll.
