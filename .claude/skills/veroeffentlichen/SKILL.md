---
name: veroeffentlichen
description: Stand des Neubaus sichern – prüfen, committen, den Branch neubau pushen. Nutzen bei "push das", "sichere den Stand", "commit". Nicht für main, Releases oder GitHub Pages.
---

# Stand sichern (nur Branch `neubau`)

GitHub CLI: `~/.local/bin/gh` (nicht im PATH). Repo: `LULKASSS/wattbuch`.

1. `git branch --show-current` muss `neubau` sein. **Nie** nach `main` mergen oder pushen, kein Release, kein `app:release`, Pages nicht anfassen: Die alte App aller Nutzer aktualisiert sich von `main`.
2. `npm test > <Protokoll>; echo $?` muss 0 sein (nicht durch `| tail` leiten).
3. `git status` ansehen: nichts aus `.sim/`, `daten/`, keine `*.gpx`, keine Schlüssel. `npm run check` meldet das auch.
4. Commit auf Deutsch mit Anlass, dann `git push -u origin neubau`.
5. Lukas kurz melden: was auf dem Branch liegt und was offen ist.
