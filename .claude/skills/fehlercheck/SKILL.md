---
name: fehlercheck
description: Gründlicher Fehlercheck für Wattbuch vor einer Veröffentlichung oder auf Zuruf – Syntax, Tests, Konsolenfehler, persönliche Daten, Darstellung auf Mac und iPhone. Nutzen bei "check mal auf Fehler", "ist das sauber", "review", "bevor wir veröffentlichen".
---

# Fehlercheck

Der Reihe nach, bei jedem Fund: beheben, Test ergänzen, weiter.

1. `npm run check` – Syntax, fehlende/doppelte IDs, persönliche Daten und Schlüssel im Repo.
2. `npm test` – alle Browser- und App-Tests.
3. `git diff` seit dem letzten Commit lesen und gezielt suchen nach:
   - Bluetooth: Bytes/Flags gegen FTMS-Spezifikation (Little Endian, Einheiten: Tempo 0,01 km/h, Kadenz 0,5 rpm, Steigung 0,01 %).
   - Aufnahme: geht bei Abbruch/Neuladen nichts verloren (`saveDraft`, `beforeunload`)?
   - Speichern: jede Änderung an Fahrten/Strecken ruft `autoBackup()`.
   - Timer/Listener, die sich bei erneutem Verbinden doppeln.
4. Darstellung: per `preview_start` (`wattbuch`) `/?fake` öffnen, mit `resize_window` Handy (375 px) und Desktop prüfen, hell und dunkel. Kein waagrechtes Scrollen, nichts abgeschnitten.
5. Ergebnis für Lukas: kurze Liste „gefunden → behoben“, offene Punkte mit Empfehlung.
