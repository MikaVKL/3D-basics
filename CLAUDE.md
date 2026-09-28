# Dusk Arena – Hinweise für Claude

Browserbasierter Low-Poly-Multiplayer-FPS im Krunker.io-Stil: Three.js + Vite +
TypeScript (Client), Node.js + `ws` (Server). Architektur, Hosting und
Steuerung stehen in der [README](README.md) – hier nur, was man zum
Weiterarbeiten wissen muss.

## Arbeitsweise (vom Nutzer so gewünscht – bitte einhalten)

- **Kleine, einzeln testbare Schritte** statt vieler Änderungen auf einmal.
  Architektur- oder Design-Fragen erst kurz vorschlagen und abstimmen.
- **Im laufenden Spiel testen**, nicht nur kompilieren: Browser-Tests (siehe
  unten), Screenshots, bei Netzwerk-Änderungen mit mehreren Clients und
  simuliertem Ping. Fehler, die dabei auffallen, zuerst reproduzieren, dann
  an der Ursache beheben (keine Sonderregel obendrauf).
- **Nach jedem abgeschlossenen Schritt committen und pushen** – die Sitzung
  kann jederzeit enden, das Projekt darf nie kaputt liegen bleiben.
- **Branch:** `claude/modest-keller-5dphta` (nicht `main`). Nur von diesem
  Branch (und `main`) wird deployt.
- **Code-Kommentare auf Deutsch**, sparsam, nur wenn das WARUM nicht
  offensichtlich ist. Bestehenden Stil beibehalten (keine TS-Parameter-
  Properties: `erasableSyntaxOnly` ist an).
- **Commit-Messages auf Deutsch:** Titelzeile, dann Ursache/Fix bzw. was und
  warum, dann ein Abschnitt `Getestet:` mit den konkreten Testschritten und
  Messwerten (z.B. "vorher 66 Probleme, nachher 0").
- Antworten an den Nutzer auf Deutsch.

## Deployment (läuft automatisch bei jedem Push)

- **Client:** GitHub Pages über `.github/workflows/deploy.yml` →
  https://mikavkl.github.io/3D-basics/. Die Server-Adresse kommt aus der
  Repository-Variable `SERVER_URL` (`wss://dusk-arena-server.onrender.com`).
- **Server:** Render.com, kostenloser Tarif, Region Frankfurt, Blueprint
  `render.yaml`, baut bei jedem Push auf den Branch neu (Spieler fliegen dabei
  1–3 Min. raus und verbinden sich neu). Schläft nach ~15 Min. ohne Spieler.
  Umgebungsvariablen: `ALLOWED_ORIGINS`, optional `KILLS_TO_WIN`.
- Nach einem Update müssen Spieler die Seite neu laden. Bei inkompatiblen
  Protokolländerungen **`PROTOCOL_VERSION`** in `src/shared/protocol.ts`
  erhöhen – alte Clients sehen dann "Veraltete Version".
- Diese Arbeitsumgebung (Claude-Container) kann `*.onrender.com` und
  `mikavkl.github.io` nicht erreichen (Netzwerk-Policy); Deploy-Status über die
  GitHub-Actions-Logs prüfen.

## Code-Landkarte

- `src/shared/` – von Client UND Server importiert (kein Three.js/DOM):
  `protocol.ts` (Nachrichten, Version), `gameRules.ts` (Schild, Respawn,
  Spawn-Schutz, Rundenziel), `weapons.ts` (Waffenwerte: Schaden, Feuerrate,
  Magazin, Tempo, Streuung), `arenaLayout.ts` (Maße, Spawn-Punkte).
- `server/index.ts` – autoritativ für Leben/Schild/Tod/Respawn/Punkte/Teams,
  Treffer-Prüfung (Schütze meldet, Server rechnet Schaden nach der Waffe im
  letzten Zustand, Feuerrate per Token-Bucket), Runden, Team-Ausgleich,
  AFK/Geister-Entfernung. Läuft direkt als TypeScript (Node ≥ 22.18).
- `src/sound.ts` – synthetisierte Sounds (Web Audio, keine Dateien)
- `src/effects.ts` – kurzlebige Effekte (Mündung, Funken, Zerfall), Kamera-Ruck
  und `SlideView` (Rutschen: Neigung + FOV, nur fürs Rendern)
- `src/playerAvatar.ts` – Spielerfigur: `root` sichtbar, `mesh` (Körper-Kapsel)
  und `headMesh` (Kopf-Box, `userData.headshot`) unsichtbare Trefferflächen
- `src/network.ts` (Verbindung, join/leave), `src/remotePlayers.ts`
  (Interpolation auf der Uhr des Absenders), `src/player.ts` (Bewegung und
  Kollision: Boden über die ganze Standfläche, Deckenkollision, "nur tiefer
  hinein blockiert"), `src/arena.ts` (Level-Geometrie).
- Nur im Dev-Build: `window.__dusk` (player, network, remotePlayers, camera,
  weapon, arena, lookControl, hitFeedback) für Browser-Tests.

## Tests

Einmalig: `npm run test:setup` (installiert Playwright + ws in `tests/`,
getrennt vom Hauptprojekt, damit das Hosting keine Browser-Pakete lädt).
Die Tests starten Vite und Spielserver selbst auf eigenen Ports (5199/8099).

- `npm run test:movement` – Kisten, Rampen, Durchgang, Fenster-Duck-Sprung,
  Rutschen, Bunny-Hop (+5 %), Schwung in der Luft, kein Nachgleiten
- `npm run test:stuck -- [spieler] [sekunden] [seed] [duckanteil]` –
  Fuzz-Test gegen Steckenbleiben (deterministisch pro Seed). Nach jeder
  Änderung an Kollision oder Level-Geometrie laufen lassen, mehrere Seeds.
- `npm run test:mp` – zwei Browser: Beitritt, Sync, Treffer, Kill, Respawn,
  Leuchtspuren, Tabelle. `node tests/multiplayer.mjs --long` zusätzlich
  Menü-Austritt, eingefrorener Tab, AFK (~2,5 Min.).
  Mit Ping: `SIMULATED_LATENCY_MS=150 SIMULATED_JITTER_MS=30 npm run test:mp`.
- `npm run test:sound` – jeder Sound hörbar (Offline-Rendering) und an
  den richtigen Ereignissen (Schuss, Treffer, Kill, Sprung, Schritte, ...)
- `npm run test:avatar` – Spielerfigur: Laufanimation, Duck-Pose (weich, bleibt
  am Boden), Rutsch-Pose, eigene Rutsch-Sicht (FOV/Neigung), Tod
- `npm run test:effects` – Mündungsleuchten, Funken, Todeseffekt, Kamera-Ruck
- `npm run test:headshot` – Kopftreffer 2× (auch geduckt), Schadenszahlen,
  Ton, Kill-Feed-Markierung und -Dauer
- `npm run test:weapons` – Wechsel (1/2/3, Mausrad, Q), Munition je Waffe,
  Nachladen, Dauerfeuer, Streuung, Tempo, Messer-Reichweite, Respawn,
  Server-Schaden/Ratenlimit/Reichweite, Waffe/Töne bei anderen, Kill-Feed-Symbol
- `npm run test:bots -- [bots=4] [sekunden=180]` – Bot-Dauertest zur
  Fehlersuche (nicht in `npm test`): Bots spielen gegeneinander, dazu
  Störungen (Menü, Neuladen, Hintergrund, eingefroren) und ein Fuzz-Bot mit
  kaputten Nachrichten; prüft Invarianten (Leben/Munition/Tempo, Punkte und
  Tabelle bei allen gleich, Positionen, Sichtbarkeit, Steckenbleiben,
  Speicher, Server-Fehler). Auch mit Ping laufen lassen.
- `npm run test:touch` – Touch-Steuerung (Handy-Emulation): Ducken-Button
  halten = ducken/rutschen, loslassen = aufstehen
- `npm run test:ping` – Ping-Anzeige: Messwert (auch mit 200 ms simuliert),
  Farbe, ausgeblendet ohne Verbindung, Ping-Spalte in der Tab-Tabelle,
  Spielerliste bei stabilem Ping selten verschickt
- `npm run test:connection` – Verbindungswarnung: nie im normalen Spiel (auch
  mit Ping), erscheint bei eingefrorenem Server (SIGSTOP), verschwindet danach,
  Spiel läuft weiter
- `npm run test:hud` – HUD: Lebensanzeige (Werte, Aufblitzen bei Schaden,
  Pulsieren ab 30 Leben, nicht bei Tod/Respawn)
- `npm test` – alles Schnelle hintereinander.

Stolperfallen bei Headless-Tests:
- Headless-Chromium rendert mit Software-WebGL nur ~5–20 FPS – Glätte nie
  über Frame-Abstände messen, sondern Physik direkt über `player.update(dt)`
  oder Interpolation mit Zeitstempeln.
- Unter Pointer Lock schickt jeder Klick ein synthetisches Mausereignis, das
  `LookControl` die Kamera zurückdrehen lässt – zum Zielen `lookControl.euler`
  mitsetzen und im selben `evaluate` schießen (siehe `shootAt` in `tests/lib.mjs`).
- `Escape` gibt den Pointer Lock headless nicht frei → `document.exitPointerLock()`.
- Frisch beigetretene Spieler haben 2 s Spawn-Schutz – vor Treffer-Tests warten.
- Bei mehr als ~4 Browsern sinkt die Bildrate auf 4–10 FPS; fremde Spieler
  erscheinen dann entsprechend später (bei 33 FPS ~150 ms, bei 5 FPS ~600 ms).
  Der Bot-Test rechnet das ein (Weg mit Zeitstempeln) – kein Spielfehler.
- Der Container wird gelegentlich neu gestartet; manuell gestartete
  Dev-Server laufen dann nicht mehr.

## Getroffene Entscheidungen (nicht wieder "reparieren")

- Fenster-Deckungswand ist per **Duck-Sprung durchkletterbar** (gewollter
  Trick-Weg, Öffnung 1,4 m); stehend passt man nicht durch.
- Rampe B liegt bündig an der Trennwand (kein Bord auf der Wandseite).
- Ducken wird überall gehalten, auch auf Touch (Nutzerwunsch, kein Umschalter):
  Rutschen nur, solange gehalten.
- Punktetabelle per Tab gedrückt halten bzw. Tippen auf den Punktestand –
  so lassen.
- Zeiten: Menü/Hintergrund → nach 20 s raus, eingefrorener Tab → 15 s,
  AFK → 90 s. Runde: erstes Team mit 20 Kills, 6 s Pause.
- Treffer: "was der Schütze sah, zählt" (keine Server-Sichtlinienprüfung).
- Kopftreffer = 2× Schaden; Schadenszahlen bei jedem Treffer (Kopf rot),
  Kill-Feed markiert Kopftreffer-Kills und zeigt Einträge 6 s.
- Waffen (abgestimmt): 1 Pistole (20, 5/s, 12er, Tempo 100 %),
  2 Sturmgewehr (12, 10/s auto, 30er, 92 %, Streuung ab dem 4. Schuss),
  3 Messer (50, 2/s, 2,5 m, 115 %, Kopf auch 2x). Wechsel 0,3 s, Respawn mit
  Pistole. Server prüft Reichweite je Waffe (+2 m Zuschlag für Verzögerung).
- Bewegung (`player.ts`): horizontale Geschwindigkeit mit Schwung. Bis zum
  normalen Tempo der Haltung folgt man der Eingabe sofort (wie früher),
  nur der Überschuss wird gelenkt/abgebremst. Rutschen = Ducken im Sprint
  (1,25x, max. 13 m/s, läuft mit 10 m/s² aus, 0,6 s Abklingzeit).
  Bunny-Hop: Sprung bis 0,12 s nach der Landung (oder 0,15 s vorher
  gedrückt) +5 % (Nutzerwunsch, vorher 8 %), Deckel 12 m/s; mit Ducken
  landen = weiterrutschen. Als Schwung zählt nur Tempo über dem Sprint-
  (geduckt: Duck-)Tempo; darunter folgt man der Eingabe sofort.
  Leertaste halten hüpft per Tasten-Wiederholung automatisch weiter.

## Offene Ideen / nächste Schritte

- Reihenfolge (mit Nutzer abgestimmt): Sound, Spielermodell, Effekte,
  Kopftreffer, Waffen, Rutschen/Bunny-Hop (erledigt) -> Ping ->
  Arena/Optik/HUD -> Raum-Codes -> Hintergrund-Tab -> Server-Prüfung.
- Spielermodell soll später nochmal überarbeitet werden (Wunsch des Nutzers).
- Noch zu entscheiden: Kollision zwischen Spielern?
- Später: Raum-Codes für private Runden, Ping-Anzeige, strengere
  Bewegungsprüfung auf dem Server, Hintergrund-Tab sendet nur ~1×/s.
