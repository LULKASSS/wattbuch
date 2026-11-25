---
name: fehlercheck
description: Gründlicher Fehlercheck für Wattbuch Neu vor dem Zeigen oder auf Zuruf – Typen, Tests, Konsolenfehler, persönliche Daten, Darstellung, Leistung. Nutzen bei "check mal auf Fehler", "ist das sauber", "review", "bevor du es zeigst".
---

# Fehlercheck

Der Reihe nach, bei jedem Fund: beheben, Test ergänzen, weiter.

1. `npm run check` – persönliche Daten, Schlüssel, simulierte Rolle nicht in der App, nichts aus dem Netz, IDs, Typen.
2. `npm test` – Logik- und App-Tests.
3. `git diff` lesen und gezielt suchen nach:
   - Bluetooth: Bytes gegen FTMS (Little Endian, Tempo 0,01 km/h, Kadenz 0,5 rpm, Steigung 0,01 %), ERG und Steigung nie zugleich.
   - Aufnahme: läuft sie ohne Bühne weiter, steht jede Sekunde im Journal, überlebt sie Abstürze (Tests „stürzt ab“)?
   - Grafik: wird jede Geometrie wieder freigegeben, entsteht pro Bild nichts Neues?
4. Darstellung: `node scripts/bilder.mjs` und die Bilder ansehen; kleines Fenster 960×600; nichts bricht um.
5. Leistung: `node scripts/dauerlauf.mjs 10` – Bildzeit unter 16 ms, Kacheln und Speicher wachsen nicht.
6. Ergebnis für Lukas: kurze Liste „gefunden → behoben“, offene Punkte mit Empfehlung.
