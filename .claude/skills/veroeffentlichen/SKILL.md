---
name: veroeffentlichen
description: Wattbuch-Änderungen veröffentlichen – prüfen, committen, auf GitHub pushen, GitHub Pages abwarten und die Live-Seite kontrollieren, optional Mac-App aktualisieren. Nutzen bei "veröffentlichen", "push das", "online stellen", "live schalten", "release".
---

# Veröffentlichen

1. **Vorher:** `npm test` muss grün sein. Sonst abbrechen und erst den Skill `fehlercheck` nutzen.
2. **Datenschutz:** `git status` ansehen. Nichts aus `daten/`, keine `*.gpx`, `*sicherung*.json`, keine Schlüssel. `npm run check` meldet das auch.
3. **Commit:** auf Deutsch, eine Zeile was sich für Lukas ändert, z. B. `Zielleistung: Hinweis bleibt stehen, wenn die Rolle blockiert`. Dann `git push`.
   - Schlägt der Push mit Anmeldefehler fehl: `gh auth status` prüfen; Lukas soll `gh auth login --web` selbst im Terminal ausführen (nie Token eintippen oder anzeigen).
4. **Pages abwarten:** `gh run list --limit 3` bis „pages build and deployment“ und „Fehlercheck“ fertig sind (`gh run watch` im Hintergrund statt Polling).
5. **Live prüfen:** `curl -s -o /dev/null -w '%{http_code}' https://lulkasss.github.io/wattbuch/` muss 200 sein; mit `curl -s … | grep -c '<neues Merkmal>'` sicherstellen, dass die neue Version ausgeliefert wird (Pages-Cache kann 1–2 min brauchen).
6. **Mac-App:** wenn `index.html` oder `desktop/` geändert wurde: `npm run app:install` (beendet und startet die App neu).
7. Lukas kurz melden: was live ist, Link, ob die Mac-App aktualisiert wurde.
