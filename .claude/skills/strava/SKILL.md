---
name: strava
description: Strava im Neubau von Wattbuch – verbinden, Fahrten hochladen, draußen gefahrene Runden als Strecken und Welten, Fahrten übernehmen. Nutzen bei "Strava", "hol meine Runden", "die Runde von gestern als Strecke", "Upload klappt nicht".
---

# Strava

Code: `app/strava.cjs` (Zugang) und `app/stravalauf.cjs` (was von selbst läuft). Bedienung: Profil-Blatt (Klick auf die Stufe) → Strava → „Verbinden“; das klickt Lukas selbst. **Nie Zugangsdaten eintippen, anzeigen oder kopieren.**

- **Zwei Zugänge.** Gemeinsame Strava-App (Client-ID 286463, Token-Tausch über die Supabase-Funktion `strava-token`, Secret nur dort): hochladen, Aktivitätenliste, Linie und Höhe einzelner Fahrten für die meistgefahrenen Runden. Eigene Strava-App von Lukas (`clientId` und `clientSecret` in `<Datenordner>/strava.json`): zusätzlich neue Fahrten übernehmen. Der Neubau führt eine eigene `strava.json`; die der alten App nicht anfassen und nichts daraus kopieren, bevor Lukas zugestimmt hat.
- **Hochladen:** jede Fahrt mit echter Rolle nach 15 s (im Ergebnisbild abbrechbar), TCX mit `trainer=1`, `external_id` = `wattbuch-<id>` (doppelte erkennt Strava, auch wenn die alte App dieselbe Fahrt hochlädt), danach per PUT zum `VirtualRide`. Stand je Fahrt in `r.strava` (`wartet`, `laeuft`, `verarbeitung`, `fehler`, `ok`, `aus`).
- **Runden:** täglich, die drei meistgefahrenen Draußen-Runden (mind. 3-mal) als Strecken `sf<Strava-ID>`. Höhen aus Strava rauschen, `ausPunkten()` in `src/kern/strecke.ts` glättet (25 m, zweimal über 7 Punkte). Sofort neu holen: `strava-stand.json` löschen oder neu verbinden.
- **Grenzen:** höchstens 90 Abrufe pro 15 min, Streams nur für Neues. Die bisherigen Strava-Fahrten liegen schon im Konto.
- **Tests:** `strava()` in `test/app.spec.js` baut Strava nach (`WATTBUCH_STRAVA_URL`), nie gegen das echte. Mit simulierter Rolle ist das echte Strava gesperrt.
- Eigene Strecken von Lukas nie ins Repo.
