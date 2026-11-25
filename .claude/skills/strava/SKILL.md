---
name: strava
description: Strava im Neubau von Wattbuch – verbinden, Fahrten hochladen, draußen gefahrene Runden als Strecken und Welten. Nutzen bei "Strava", "hol meine Runden", "die Runde von gestern als Strecke".
---

# Strava (kommt in Schritt 3, noch nicht gebaut)

Nachschlagen im alten Code: `git show main:desktop/strava.js`, `main:js/strava.js`, `main:js/stravaholen.js`.

- **Zwei Zugänge.** Gemeinsame Strava-App (Client-ID 286463, Token-Tausch über die Supabase-Funktion `strava-token`, Secret nur dort): hochladen, Aktivitätenliste, Linie und Höhe einzelner Fahrten für die meistgefahrenen Runden. Eigene Strava-App von Lukas (Client-ID und Secret in `strava.json`): zusätzlich alle Fahrten übernehmen.
- **Neubau meldet sich neu an** und führt eine eigene `strava.json` im eigenen Datenordner; die der alten App nicht anfassen und nichts daraus kopieren, bevor Lukas zugestimmt hat. Zugangsdaten nie anzeigen oder eintippen.
- **Grenzen:** höchstens 90 Abrufe pro 15 min, Streams nur für Neues. Die 128 Strava-Fahrten liegen schon im Konto.
- **Hochladen:** TCX mit `trainer=1`, `external_id` = `wattbuch-<id>` (doppelte erkennt Strava), danach per PUT zum `VirtualRide`.
- **Strecken:** Höhen aus Strava rauschen, `ausPunkten()` in `src/kern/strecke.ts` glättet (25 m, zweimal über 7 Punkte). Eigene Strecken von Lukas nie ins Repo.
