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

**Fahrten zu Strava (Upload)**
- Mac-App lädt direkt hoch (`desktop/strava.js`, Oberfläche `js/strava.js`): Lukas legt einmalig unter strava.com/settings/api eine App an (Website `http://localhost`, Callback-Domain `localhost`) und trägt Client-ID/Secret in Wattbuch → Einstellungen → Strava ein. **Nie selbst Zugangsdaten eintippen oder anzeigen**, das macht Lukas.
- Zugang liegt in `~/Library/Application Support/Wattbuch/strava.json` (0600), Token werden automatisch erneuert. Upload als TCX mit `trainer=1`, Name = Fahrtname, Beschreibung mit Ø/NP/kJ/TSS, `external_id` = `wattbuch-<id>` (doppelte Uploads erkennt Strava).
- Option „Nach jeder Fahrt automatisch hochladen“ (`S.set.stravaAuto`). Stand je Fahrt in `r.strava`.
- Browser/Webseite: „Für Strava exportieren“ (TCX speichern + strava.com/upload/select).
- Test: `test/desktop.spec.js` „Strava: verbinden und Fahrt hochladen“ gegen nachgebauten Server (`WATTBUCH_STRAVA_URL`).

Bereits übernommen (Okt. 2026): Göttinger Hausrunde, TDE 2026, Ischgl-Bergtour.
