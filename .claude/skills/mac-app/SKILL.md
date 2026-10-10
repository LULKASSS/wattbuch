---
name: mac-app
description: Die Wattbuch Mac-App (Electron) bauen, installieren, starten oder erweitern – Menü, Fenster, Bluetooth-Auswahl, Sicherung, Icon. Nutzen bei "Mac-App", "App aktualisieren", "App startet nicht", "Bluetooth in der App", "Icon ändern".
---

# Mac-App

- **Aus dem Code starten:** `npm run app` (schnell, für Entwicklung).
- **Installieren/aktualisieren:** `npm run app:install` → Fehlercheck, `electron-builder --dir`, Ad-hoc-Signatur, Kopie nach `/Applications/Wattbuch.app`.
- **Testen:** `npx playwright test --project=app` (eigener Datenordner über `WATTBUCH_DATA`).
- **Icon:** `desktop/icon.svg` bearbeiten, dann `npm run icon` → `desktop/icon.png`.

Aufbau: `desktop/main.js` lädt `index.html` über `app://wattbuch/` (feste Herkunft für IndexedDB, sicherer Kontext für Bluetooth). Bluetooth-Suche: `select-bluetooth-device` → `preload.js` zeigt Auswahl → `bt:choose`.
Neue Desktop-Funktionen: in `main.js` per `ipcMain.handle`, in `preload.js` unter `wattbuchDesktop` freigeben, in `index.html` nur nutzen, wenn `window.wattbuchDesktop` existiert.

Bekannte Punkte:
- Ad-hoc-signiert: macOS fragt nach einem Update ggf. erneut nach Bluetooth-Erlaubnis (Systemeinstellungen → Datenschutz → Bluetooth).
- Rolle wird nicht gefunden: läuft Zwift/eine andere App mit Verbindung zur Rolle? Rolle durch Treten wecken.
- „App ist beschädigt“: `codesign --verify --deep --strict /Applications/Wattbuch.app` prüfen, neu installieren.
