---
name: veroeffentlichen
description: Wattbuch-Änderungen veröffentlichen – prüfen, committen, auf GitHub pushen, GitHub Pages abwarten und die Live-Seite kontrollieren, optional Mac-App aktualisieren. Nutzen bei "veröffentlichen", "push das", "online stellen", "live schalten", "release".
---

# Veröffentlichen

GitHub CLI: `~/.local/bin/gh` (nicht im PATH, immer mit vollem Pfad aufrufen). Repo: `LULKASSS/wattbuch`.

1. **Vorher:** `npm test` muss grün sein (Exit-Code 0). **Nicht** durch `| tail` o. Ä. leiten, sonst zählt der Exit-Code des letzten Befehls und Fehler rutschen durch – Ausgabe stattdessen mit `npm test > /tmp/test.log; echo $?` prüfen. Sonst abbrechen und erst den Skill `fehlercheck` nutzen.
2. **Datenschutz:** `git status` ansehen. Nichts aus `daten/`, keine `*.gpx`, `*sicherung*.json`, keine Schlüssel. `npm run check` meldet das auch.
3. **Commit:** auf Deutsch, eine Zeile was sich für Lukas ändert, z. B. `Zielleistung: Hinweis bleibt stehen, wenn die Rolle blockiert`. Dann `git push`.
   - Schlägt der Push mit Anmeldefehler fehl: `~/.local/bin/gh auth status` prüfen; Lukas soll `~/.local/bin/gh auth login --web` selbst im Terminal ausführen (nie Token eintippen oder anzeigen).
4. **Pages abwarten:** `~/.local/bin/gh run list --repo LULKASSS/wattbuch --limit 3` bis „pages build and deployment“ und „Fehlercheck“ fertig sind (`~/.local/bin/gh run watch <id> --exit-status` im Hintergrund statt Polling).
5. **Live prüfen:** `curl -s -o /dev/null -w '%{http_code}' https://lulkasss.github.io/wattbuch/` muss 200 sein; mit `curl -s … | grep -c '<neues Merkmal>'` sicherstellen, dass die neue Version ausgeliefert wird (Pages-Cache kann 1–2 min brauchen).
6. **Mac-App:** aktualisiert sich bei Änderungen an `index.html`, `app.css`, `js/` **von selbst** (beim Start und alle 30 min, prüft `manifest.json` der Webseite). Kontrolle: `curl -s https://lulkasss.github.io/wattbuch/manifest.json | grep version` muss zur lokalen `manifest.json` passen. Nur bei Änderungen an `desktop/` oder `package.json` ist `npm run app:install` nötig (beendet und startet die App neu).
7. Lukas kurz melden: was live ist, Link, ob die Mac-App aktualisiert wurde.
