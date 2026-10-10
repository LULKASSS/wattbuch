# Wattbuch

Watt-Aufnahme für Rollentrainer (Van Rysel D100, Bluetooth FTMS), Strecken mit Steigung, Auswertung.
Gehört Lukas, Sprache in App, Code-Kommentaren und Commits: **Deutsch**.

## Aufbau
- `index.html` (Markup), `app.css` (Stil), `js/*.js` (Logik, klassische Scripts mit gemeinsamem globalem Bereich, Reihenfolge wie in index.html: basis → geraete → strecken → aufnahme → diagramme → ansichten → daten → start). Kein Build-Schritt, keine Abhängigkeiten außer Google Fonts. GitHub Pages liefert das Repo 1:1 aus: https://lulkasss.github.io/wattbuch/
- `desktop/` – Mac-App (Electron): `main.js` (Fenster, `app://`-Schema, Bluetooth-Auswahl, Sicherung nach iCloud), `preload.js` (Brücke `window.wattbuchDesktop`, Geräte-Auswahldialog).
- `test/fake-ble.js` – simulierte Rolle, Pulsgurt, Trittfrequenzsensor (`window.__fakeBle`). **Nie** in `index.html` einbinden.
- `test/app.spec.js` – Browsertests (Chrome, gefälschte Uhr). `test/desktop.spec.js` – Tests der Mac-App.
- `scripts/check.mjs` – Fehlercheck ohne Browser (Syntax, IDs, persönliche Daten, Schlüssel).
- `scripts/serve.mjs` – Dev-Server auf :5173, `/?fake` blendet die simulierte Rolle ein.

## Befehle
- `npm test` – Fehlercheck + alle Tests (≈30 s). Muss vor jedem Commit grün sein.
- `npm run dev` – lokal ansehen: http://localhost:5173/?fake
- `npm run app` – Mac-App aus dem Quellcode starten; `npm run app:install` – bauen, signieren, nach /Applications.
- Nach `npm install` lädt `postinstall` das Electron-Binary.

## Regeln
- Repo ist **öffentlich**: keine Fahrten, Sicherungen, GPX/TCX/FIT, FTP/Gewicht oder Zugangsdaten committen. Echte Daten liegen in `~/Library/Mobile Documents/com~apple~CloudDocs/Wattbuch/` (Mac-App) bzw. im Browser. Testdaten nur synthetisch erzeugen (siehe `gpx()` in den Tests).
- Neue Funktion → Test in `test/app.spec.js` mit `__fakeBle` dazu. Bluetooth-Protokoll: FTMS 0x1826 (Indoor Bike Data 0x2AD2, Control Point 0x2AD9), HR 0x180D, CSC 0x1816.
- Desktop-Tests immer mit `WATTBUCH_DATA=<tmp>`, nie gegen den echten Sicherungsordner.
- Mac-App lädt dieselben Dateien; App-spezifisches nur über `window.wattbuchDesktop` abfragen, die Webseite muss ohne laufen.
- Stil beibehalten: kompaktes JS, deutsche Bezeichner in UI-Texten, `$`/`$$`-Helfer, `S` als Zustand.
