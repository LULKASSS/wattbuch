---
name: mac-app
description: Die Mac-App „Wattbuch Neu“ (Electron) starten, bauen, installieren oder erweitern – Fenster, Brücke, Bluetooth ohne Auswahldialog, Journal, Datenordner. Nutzen bei "App startet nicht", "installier die neue App", "Bluetooth in der App", "Fenster", "Datenordner".
---

# Mac-App „Wattbuch Neu“

- **Starten:** `npm run app` (echte Geräte, echter Datenordner) oder `npm run app:sim` (simulierte Rolle, `.sim/`).
- **Installieren:** `npm run app:install` → `/Applications/Wattbuch Neu.app`, ad hoc signiert. Nur wenn Lukas es will. Die alte `Wattbuch.app` bleibt unberührt (eigene Kennung `de.rueckborn.wattbuch.neu`, eigener Datenordner `~/Library/Application Support/Wattbuch Neu/`).
- **Kein Release, kein Updater:** nichts veröffentlichen und nichts nachladen, bis Lukas abgenommen hat.
- **Aufbau:** `app/main.cjs` baut zwei Fenster (Bühne sichtbar, Maschinenraum unsichtbar), lädt `bau/` über `app://wattbuch-neu/`, reicht `Zustand` und `Befehl` durch und schreibt Journal und Fahrten (`app/daten.cjs`). Neue Funktion: `ipcMain` in `main.cjs`, in `app/preload.cjs` unter `window.wattbuch` freigeben, Typ in `src/bruecke.d.ts`.
- **Bluetooth:** Der Maschinenraum ruft `requestDevice` auf (Nutzergeste kommt vom Hauptprozess über `executeJavaScript(…, true)`, alle 15 s für alles, was fehlt). `select-bluetooth-device` nimmt das in `geraete.json` gemerkte Gerät; ohne gemerktes das erste gefundene. Die Rolle nimmt nur eine Verbindung an: alte App und Zwift müssen zu sein.
- Ad hoc signiert: macOS fragt nach einer Neuinstallation ggf. erneut nach der Bluetooth-Erlaubnis.
