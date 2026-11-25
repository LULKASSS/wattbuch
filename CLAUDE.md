# Wattbuch Neu (Neubau auf dem Branch `neubau`)

## Ziel
- **Wofür:** Rollentraining soll sich wie eine Runde in einem guten Spiel anfühlen: aufsteigen, lostreten, und die App macht den Rest.
- **Wer, wann:** Lukas, zu Hause auf der Rolle (Van Rysel D100, Bluetooth FTMS), am Mac. Die Hände sind am Lenker, der Blick geht aus etwa zwei Metern auf den Bildschirm.
- **Gelungen, wenn:** Lukas vor einer Fahrt nichts auswählen muss, während der Fahrt auf einen Blick an der Farbe sieht, ob er richtig liegt, und nach der Fahrt weiß, was sie für sein Ziel gebracht hat.
- **Abgenommen:** der Entwurf in `entwurf/` (3D-Welt, Lobby, Flug in die Runde, Anzeige, Rivale), die Strava-Verbindung, eigene Strava-Runden fahren, dass sich Dinge bewegen, die Straße, an der man Kurven und Steigung sieht. Plan vom 25.11.2026 (Electron, Build-Schritt, zwei Fenster, Daten als Dateien, eine neue Tabelle).
- **Nicht gewollt:** Arbeitstool-Look, Erklärtexte, viele Schalter vor der Fahrt, flache Kacheln, Animationen aus CSS-Tricks, laute Farbverläufe in der Oberfläche.

## Stand
Schritt 1 (Runde zum Anfassen) und Schritt 2 (echte Rolle, echte Daten) sind gebaut. Schritt 2 ist nur mit simulierter Rolle und nachgebautem Konto geprüft: Verbinden ohne Dialog, Anmelden im echten Konto und die Übernahme der echten Strecken muss Lukas einmal selbst durchgehen.
Offen: 3 Strava, 4 Rivalen-/Segment-Ansichten, 5 Saison, 6 Feinschliff (voller Coach, FTP-Test, „Watt halten“). Die Bereiche Saison, Rivalen, Fahrten sind oben schon zu sehen, aber noch aus. Strecken gleichen sich noch nicht übers Konto ab (dafür braucht es die neue Tabelle `wattbuch_dokumente`, Migration liegt Lukas vor, nicht ausgeführt).
Noch nicht beantwortet von Lukas: Teilrunden langer Strecken und erzeugte Runden für kurze Tage (Schritt 5), ob Client-ID/Secret seiner Strava-App aus der alten `strava.json` kopiert werden dürfen (Schritt 3, bis dahin nicht anfassen).

## Aufbau
Mac-App mit Electron, Oberfläche in TypeScript, gebaut mit Vite nach `bau/` (`npm run bau`). Sprache in App, Kommentaren und Commits: **Deutsch**.
- `app/` (Hauptprozess, ohne Build): `main.cjs` (zwei Fenster, `app://wattbuch-neu/`, Bluetooth-Wahl ohne Dialog, Journal, Schlaf verhindern, Rückfrage beim Schließen während einer Fahrt), `preload.cjs` (Brücke `window.wattbuch`), `daten.cjs` (Dateispeicher, ordnet alte Fahrten per Streckenname zu, Rundenzeit, Rivale), `konto.cjs` (Abgleich mit Supabase per REST: Ausgang, erst holen, dann schicken, erster Abgleich: Konto gewinnt; schreibt nur neue Fahrten und Werte, löscht nie; Anmeldung in `konto.json`, Modus 0600), `alt.cjs` (einmalige Übernahme von Strecken und Werten aus der Sicherung der alten App, nur lesend, gemerkt in `alt.json`; eigene Sicherung nach `iCloud Drive/Wattbuch Neu/`, ohne Strava-Fahrten, leerer Datenordner kommt von dort zurück).
- **Geräte:** Von selbst gesucht wird nur, was in `geraete.json` gemerkt ist (alle 15 s, was fehlt). Erstwahl im Geräte-Blatt der Lobby (Klick auf die drei Punkte): gefundene Geräte erscheinen dort, die Wahl wird gemerkt, „Vergessen“ löscht sie. Profil-Blatt (Klick auf die Stufe): FTP, Gewicht, Steigungsstärke, Konto.
- **Zwei Fenster.** `maschine.html` + `src/maschine/` = unsichtbarer Maschinenraum: Bluetooth (`geraete.ts`), Fahrphysik, Aufnahme, Coach, Meldungen (`maschine.ts`); schickt zehnmal pro Sekunde den `Zustand`. `buehne.html` + `src/buehne/` = sichtbare Bühne: 3D-Welt und Anzeige, schickt nur `Befehl`e. Der Hauptprozess reicht beides durch. Stürzt die Bühne ab, lädt sie neu und hängt sich an die laufende Fahrt; stürzt der Maschinenraum ab, setzt er aus dem Journal fort.
- **Journal:** jede aufgenommene Sekunde geht sofort nach `<Datenordner>/laufend.jsonl`. Liegt beim Start eins herum (Absturz), wird daraus eine Fahrt (`gerettet`).
- `src/kern/` = Logik ohne Fenster und ohne Grafik, alles mit Tests: `physik.ts`, `strecke.ts` (Höhe, Steigung, Glättung, Anstiege), `erzeugen.ts` (erzeugte Runden), `coach.ts`, `aufnahme.ts` (Auto-Pause), `start.ts` (Start beim Tritt), `rivale.ts`, `kurve.ts` (Straße der Welt aus der Strecke, Abstand zur Straße), `typen.ts` (`Strecke`, `Fahrt`, `Zustand`, `Befehl`).
- `src/buehne/welt/`: `welt.ts` (Himmel, Kamera: Lobby-Kreis, Sturzflug, Verfolger), `gelaende.ts` (Höhe als Funktion der Stelle, Kacheln in Stufen von 4 m bis 256 m, entstehen und verschwinden mit der Fahrt), `strasse.ts` (Band, Leuchtlinie, Pfosten, Tore), `baeume.ts`, `fahrer.ts` (Fahrer und Geist aus einfachen Körpern), `guete.ts` (Detailstufen, greifen von selbst ab 22 ms Bildzeit über 4 s).
- `src/buehne/buehne.ts` + `buehne.html` + `src/stil.css`: Lobby, Countdown, Anzeige, Einblendungen, Ergebnis. Aussehen aus `entwurf/` (Vorlage für Look und Gefühl, nicht für Technik; seine Zahlen und Namen sind Beispiele und nie echte Daten).
- **Daten:** `~/Library/Application Support/Wattbuch Neu/daten/` mit `strecken/<id>.json`, `fahrten/<id>.json`, `werte.json` (FTP, Gewicht, Rad, Steigungsstärke), `geraete.json` (gemerkte Bluetooth-Geräte). Fahrten im Format der alten App (ein Wert pro Sekunde: `p`, `hr`, `cad`, `spd`, `dist`, `alt`) plus `routeId`, `rev`, `ganz` (ganze Runde gefahren), `app:'neu'`. Die alte App merkt sich nur den Streckennamen (`route`, Gegenrichtung als „ (umgekehrt)“).
- `test/fake-ble.js` (simulierte Rolle, Pulsgurt, Trittfrequenzsensor) und `test/sim-fahrer.js` (tritt ungefähr das Ziel) werden nur mit `WATTBUCH_SIM=1` aus dem Quellcode geladen, `test/` ist nicht Teil der gebauten App.

## Befehle
- `npm test` – Fehlercheck, Typen, Logik-Tests (Vitest), Build, App-Tests (Playwright, ≈2 min). Muss vor jedem Commit grün sein.
- `npm run app:sim` – App mit simulierter Rolle ansehen (Daten in `.sim/`). `npm run app` – mit echten Geräten und echtem Datenordner.
- `node scripts/bilder.mjs <Ordner> [Sekunden]` – fährt durch und legt Bilder von Lobby, Countdown, Fahrt, Pause, Ergebnis ab (`RIVALE=1`, `RUNDE=1`).
- `node scripts/dauerlauf.mjs [Minuten]` – Bildzeit, Detailstufe, Kacheln und Speicher alle 30 s.
- `npm run app:install` – baut und legt `Wattbuch Neu.app` in den Programme-Ordner (nur wenn Lukas es will). `npm run entwurf` – den Entwurf im Browser zeigen.
- Umgebung: `WATTBUCH_DATA=<Ordner>` (eigener Speicher, Pflicht in Tests), `WATTBUCH_SIM=1` (`wahl` = simulierte Geräte, aber nichts verbindet sich von selbst), `WATTBUCH_SUPABASE_URL` (nachgebautes Konto in Tests), `WATTBUCH_ALT=<Datei>` (alte Sicherung in Tests), `WATTBUCH_TEMPO=<n>` (Uhr der Fahrt läuft n-mal schneller, nur Tests), `WATTBUCH_LOG=1`.

## Regeln
- **Nichts nach `main`**, kein Release, GitHub Pages nicht anfassen, bis Lukas abgenommen hat: Die installierte alte App aller Nutzer aktualisiert sich von `main`. Der Neubau lädt selbst nichts aus dem Netz nach (prüft `scripts/check.mjs`).
- **Eigene App neben der alten:** Name „Wattbuch Neu“, Kennung `de.rueckborn.wattbuch.neu`, eigener Datenordner. In den Sicherungsordner der alten App (`iCloud Drive/Wattbuch/`) wird nie geschrieben, lesen ist erlaubt. Nichts außerhalb von `~/code/wattbuch` anlegen oder löschen, außer Datenordner, Sicherungsordner und installierter „Wattbuch Neu“.
- **Repo ist öffentlich:** keine Fahrten, GPX/TCX/FIT, FTP, Gewicht, Mails oder Schlüssel committen (außer dem öffentlichen Supabase-Schlüssel). Testdaten nur erfunden, keine Strecken von Lukas als Vorgabe.
- **Supabase (Projekt „Apps“) teilt sich der Neubau mit der alten App:** `wattbuch_fahrten`, `wattbuch_werte` nicht ändern, nichts löschen. Neues in neue Tabellen, jede Migration vorher Lukas zeigen. Tests nie gegen das echte Supabase (`konto()` in `test/app.spec.js` baut es nach). Mit simulierter Rolle ist die Anmeldung im echten Konto gesperrt, damit erfundene Fahrten dort nie landen.
- **Eine Fahrt darf nie verloren gehen:** Aufnahme nur im Maschinenraum, Speichern nur im Hauptprozess, nichts davon hängt an der Grafik.
- Neue Funktion → neuer Test (Logik in `test/kern/`, Ablauf in `test/app.spec.js` mit simulierter Rolle).
- Oberfläche: kein Titelbalken, kein Logo, kein App-Name, kein Menüzeichen. Kaum Text, keine Erklärsätze. Nichts bricht um, auch nicht bei 960×600. Keine Test-Schalter und keine Datei-Knöpfe. Signalfarben nur mit Bedeutung: Watt grün im Ziel (±5 %), bernstein darunter, rot darüber; Steigung bernstein ab 2,5 %, rot ab 6 %, kühl bergab; Tempo hervorgehoben ab 38 km/h.
- Keine Intervall-Workouts, kein Windows, kein Handy, kein Apple TV.
- Vor dem Zeigen: Auftrag und Zielkarte Punkt für Punkt gegen das Ergebnis halten, App wirklich starten, Runde mit simulierter Rolle fahren, Bilder ansehen.

## Annahmen (Rechenregeln, einfach gehalten)
- Fahrphysik wie in der alten App: cdA 0,32, Crr 0,005, Luftdichte 1,225; Tempo rechnet immer mit der echten Steigung der Strecke, die Rolle bekommt Steigung × Steigungsstärke (Vorgabe 50 %). Zeiten bleiben so vergleichbar.
- Coach in Schritt 1: Grundleistung 70 % der FTP, Ziel +5 % je Prozent Steigung 25 m voraus, höchstens +15 %/−25 %, auf 5 W gerundet. Pfeiltasten: Coach an ±5 W am Niveau, Coach aus ±10 W am Ziel.
- Start beim ersten Tritt: 3 s am Stück ≥ 40 W (mit Trittfrequenz ≥ 40), Countdown 3 s, 1 s unter 10 W oder Esc bricht ab, nach einer Runde erst nach 10 s Ruhe wieder scharf. Aufgezeichnet wird ab dem Ende des Countdowns.
- Auto-Pause: 4 s unter 5 W → Pause, die stehenden Sekunden fallen raus; 2 s ≥ 30 W → weiter. Von Hand pausiert (Leertaste) bleibt pausiert.
- Rivale: schnellster ganzer Versuch auf derselben Strecke in derselben Richtung, nur Rollenfahrten (nicht aus Strava, nicht ohne Wattmessung). Bei alten Fahrten, die über die Runde hinaus weiterfuhren, zählt die Zeit bis zum Ende der ersten Runde. Abstand = Zeitunterschied an derselben Stelle.
- „Heute für dich“ vorläufig: unter den Runden bis 90 Minuten die, die am längsten nicht gefahren wurde (wird in Schritt 5 durch den Plan ersetzt).
- Welt: Höhen der Straße sind echt, das Gelände daneben ist erzeugt. In der Lobby wird die Welt bis dreifach überhöht gezeigt, in der Fahrt nicht. Die Kamera gleicht die Steigung nur zur Hälfte aus, damit man sie sieht.
