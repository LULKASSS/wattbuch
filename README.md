# Wattbuch

Watt aufnehmen und auswerten mit dem Van Rysel D100 (oder einer anderen Rolle mit Bluetooth FTMS), dazu Strecken mit echter Steigung abfahren.

**Öffnen:** https://lulkasss.github.io/wattbuch/

- Mac: als **App** (siehe unten) oder in **Chrome** öffnen (Safari kann kein Web-Bluetooth)
- iPhone: in **Safari** öffnen, über Teilen → „Zum Home-Bildschirm“ als App ablegen und in der Übersicht mit dem Konto anmelden. Am Handy wird nicht aufgenommen, es ist die Verwaltung: Fahrten und Bestwerte ansehen, FTP und Gewicht pflegen, Fahrten umbenennen oder löschen (Aufnehmen am Handy trotzdem: Adresse mit `?fahren` in Bluefy)

## Was drin ist

- Live-Watt, Zonen, NP, kJ, Puls, Trittfrequenz, virtuelles Tempo und Distanz
- Strecken: Höhenprofil mit Punkt, Streckenlinie, Steigung geht an die Rolle (Steigungsstärke 25–100 %)
- Zielleistung (ERG)
- Fahrten, Bestwerte, FTP-Schätzung, TCX-Export
- **Fahrt-Ansicht**: Straße der Strecke zum Durchfahren, Geist der besten Fahrt oder Schrittmacher als Radfahrer, große Anzeige. Tageszeit wechselt mit der Fahrtdauer (Abendrot, Nacht, Morgengrauen, Tag, Sonnenuntergang), Landschaft mit der Strecke (Wald, Felder, Alpen). Taste F für echtes Vollbild
- Countdown, Momente während der Fahrt (Bestwerte, Meilensteine, Gipfel), Zusammenfassung mit Highlights
- Zufallsstrecken (Hügelrunde, Bergwertung, Flachstück) per „Würfeln“, mit Strava zusätzlich deine meistgefahrenen Runden als Strecken
- **FTP-Test** (Rampentest: +20 W pro Minute über die Zielleistung, FTP = 75 % der besten Minute, wird direkt übernommen)
- **Strava**: in der Mac-App einmal „Mit Strava verbinden“ (Einstellungen → Strava), dann geht jede Fahrt mit der Rolle von selbst zu Strava; im Browser als TCX exportieren

**Tasten am Mac:** Leertaste Start/Pause/Weiter · F Vollbild · ↑↓ Zielleistung ±5 W · Esc Vollbild verlassen

## Daten

**Konto:** In den Einstellungen (Mac) bzw. in der Übersicht (iPhone) mit E-Mail und Passwort anmelden. Danach gleichen sich Fahrten, Namen, Löschungen, FTP, Gewicht und Rad von selbst ab (Supabase, jeder sieht nur seine eigenen Daten). Strecken bleiben auf dem Gerät.

Fahrten und Strecken liegen außerdem im Browser des jeweiligen Geräts. Die Mac-App sichert nach jeder Fahrt automatisch nach iCloud Drive (`Wattbuch/`) und holt die Sicherung bei leerem Speicher von selbst zurück. Eigene Strecken kommen über „Laden“ bei der Strecke dazu (GPX oder Streckendatei). Persönliche Daten gehören nicht in dieses Repo, es ist öffentlich.

## Mac-App

**Laden:** [Wattbuch für Mac](https://github.com/LULKASSS/wattbuch/releases/latest/download/Wattbuch-mac-arm64.zip) (Mac mit Apple-Chip, M1 oder neuer)

1. Zip öffnen, `Wattbuch.app` in den Programme-Ordner ziehen und starten.
2. Die App ist nicht bei Apple beglaubigt. macOS meldet beim ersten Start, dass es sie nicht prüfen konnte: „Fertig“ klicken, dann Systemeinstellungen → Datenschutz & Sicherheit → ganz unten „Trotzdem öffnen“. Danach startet sie normal.
3. Bluetooth erlauben, Einstellungen → Strava → „Mit Strava verbinden“. Fahrten mit der Rolle gehen dann von selbst zu Strava.

Die Oberfläche aktualisiert sich von selbst; eine neue App-Fassung gibt es über denselben Link.

Selbst bauen:

```bash
npm install
npm run app:install
```

Baut `Wattbuch.app` und legt sie in den Programme-Ordner. `npm run app:release` baut die Zip und stellt sie als GitHub-Release bereit (Link oben). Gleiche Oberfläche wie die Webseite, dazu Geräteauswahl für Bluetooth, automatische Sicherung und Rückfrage beim Schließen während einer Aufnahme.

## Entwicklung

- `npm run dev` – lokal unter http://localhost:5173, mit `/?fake` ohne echte Geräte (simulierte Rolle)
- `npm test` – Fehlercheck und automatische Tests (Browser, iPhone-Größe, Mac-App)
