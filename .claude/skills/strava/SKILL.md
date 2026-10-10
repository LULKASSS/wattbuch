---
name: strava
description: Touren aus Lukas' Strava-Konto als Wattbuch-Strecken übernehmen oder Strava-Daten für Wattbuch nutzen (FTP, Zonen, typische Profile). Nutzen bei "Strava", "hol meine Touren", "die Runde von gestern als Strecke", "fahr meine TDE nach", "neue Strecken aus Strava".
---

# Strava → Wattbuch

Strava ist über den Strava-Connector verbunden (Tools `list_activities`, `get_activity_streams`, `get_athlete_zones`).

**Strecken übernehmen**
1. `list_activities` (nur `sport_type` Ride, nicht VirtualRide/Hike), mit Lukas die Touren auswählen. Gut geeignet: viel Höhe pro km, Lieblingsrunden, Touren mit Geschichte.
2. Pro Tour `get_activity_streams` mit `["location","altitude"]` und `resolution: 250` (reicht für ein Rollenprofil, spart Kontingent).
3. Streams als `[{name, location, altitude}]` in eine Datei im Scratchpad/`/private/tmp` schreiben – **nie ins Repo** (verrät Wohnort und Wege).
4. `node scripts/strecke-aus-punkten.mjs <eingabe.json> "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Wattbuch/Import/strava-<datum>.json"`
5. Die Mac-App übernimmt alles aus `Import/` beim nächsten Start und verschiebt die Datei nach `Import/Erledigt/`. Im Browser: Einstellungen → „Datei laden“.

**Zahlen abgleichen**
- `get_athlete_zones` liefert FTP und Leistungszonen. Weicht die FTP von Wattbuch ab, Lukas fragen, ob sie übernommen werden soll (Einstellungen → FTP).

**Fahrten zu Strava**
- Nach jeder Fahrt bietet die Zusammenfassung „Für Strava exportieren“: lädt die TCX und öffnet strava.com/upload/select. Ein automatischer Upload bräuchte eine eigene Strava-API-App mit Geheimschlüssel und gehört nicht in die öffentliche Webseite.

Bereits übernommen (Okt. 2026): Göttinger Hausrunde, TDE 2026, Ischgl-Bergtour.
