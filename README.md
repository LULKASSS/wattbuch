# Wattbuch

Watt aufnehmen und auswerten mit dem Van Rysel D100 (oder einer anderen Rolle mit Bluetooth FTMS), dazu Strecken mit echter Steigung abfahren.

**Öffnen:** https://lulkasss.github.io/wattbuch/

- Mac: als **App** (siehe unten) oder in **Chrome** öffnen (Safari kann kein Web-Bluetooth)
- iPhone: in der App **Bluefy** öffnen

## Was drin ist

- Live-Watt, Zonen, NP, kJ, Puls, Trittfrequenz, virtuelles Tempo und Distanz
- Strecken: Höhenprofil mit Punkt, Streckenlinie, Steigung geht an die Rolle (Steigungsstärke 25–100 %)
- Zielleistung (ERG)
- Fahrten, Bestwerte, FTP-Schätzung, TCX-Export
- **Fahrt-Ansicht**: Straße der Strecke zum Durchfahren, Geist der besten Fahrt oder Schrittmacher als Radfahrer, große Anzeige. Tageszeit wechselt mit der Fahrtdauer (Abendrot, Nacht, Morgengrauen, Tag, Sonnenuntergang), Landschaft mit der Strecke (Wald, Felder, Alpen). Taste F für echtes Vollbild
- Countdown, Momente während der Fahrt (Bestwerte, Meilensteine, Gipfel), Zusammenfassung mit Highlights
- Zufallsstrecken (Hügelrunde, Bergwertung, Flachstück) per „Würfeln“
- **FTP-Test** (Rampentest: +20 W pro Minute über die Zielleistung, FTP = 75 % der besten Minute)
- **Strava**: in der Mac-App direkt hochladen (einmalig eigene Strava-API-App anlegen, Einstellungen → Strava), auf Wunsch automatisch nach jeder Fahrt; im Browser als TCX exportieren

**Tasten am Mac:** Leertaste Start/Pause/Weiter · F Vollbild · ↑↓ Zielleistung ±5 W · Esc Vollbild verlassen

## Daten

Fahrten und Strecken liegen im Browser des jeweiligen Geräts. Die Mac-App sichert nach jeder Fahrt automatisch nach iCloud Drive (`Wattbuch/`) und holt die Sicherung bei leerem Speicher von selbst zurück. Strecken und Sicherungen werden über „Laden“ eingelesen (Streckendatei, GPX oder Sicherung). Persönliche Daten gehören nicht in dieses Repo, es ist öffentlich.

## Mac-App

```bash
npm install
npm run app:install
```

Baut `Wattbuch.app` und legt sie in den Programme-Ordner. Gleiche Oberfläche wie die Webseite, dazu Geräteauswahl für Bluetooth, automatische Sicherung und Rückfrage beim Schließen während einer Aufnahme.

## Entwicklung

- `npm run dev` – lokal unter http://localhost:5173, mit `/?fake` ohne echte Geräte (simulierte Rolle)
- `npm test` – Fehlercheck und automatische Tests (Browser, iPhone-Größe, Mac-App)
