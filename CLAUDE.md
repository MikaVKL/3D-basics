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
  `protocol.ts` (Nachrichten, Version), `gameRules.ts` (Schaden, Schild,
  Respawn, Spawn-Schutz, Rundenziel), `arenaLayout.ts` (Maße, Spawn-Punkte).
- `server/index.ts` – autoritativ für Leben/Schild/Tod/Respawn/Punkte/Teams,
  Treffer-Prüfung (Schütze meldet, Server prüft), Runden, Team-Ausgleich,
  AFK/Geister-Entfernung. Läuft direkt als TypeScript (Node ≥ 22.18).
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

- `npm run test:movement` – Kisten, Rampen, Durchgang, Fenster-Duck-Sprung
- `npm run test:stuck -- [spieler] [sekunden] [seed] [duckanteil]` –
  Fuzz-Test gegen Steckenbleiben (deterministisch pro Seed). Nach jeder
  Änderung an Kollision oder Level-Geometrie laufen lassen, mehrere Seeds.
- `npm run test:mp` – zwei Browser: Beitritt, Sync, Treffer, Kill, Respawn,
  Leuchtspuren, Tabelle. `node tests/multiplayer.mjs --long` zusätzlich
  Menü-Austritt, eingefrorener Tab, AFK (~2,5 Min.).
  Mit Ping: `SIMULATED_LATENCY_MS=150 SIMULATED_JITTER_MS=30 npm run test:mp`.
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
- Der Container wird gelegentlich neu gestartet; manuell gestartete
  Dev-Server laufen dann nicht mehr.

## Getroffene Entscheidungen (nicht wieder "reparieren")

- Fenster-Deckungswand ist per **Duck-Sprung durchkletterbar** (gewollter
  Trick-Weg, Öffnung 1,4 m); stehend passt man nicht durch.
- Rampe B liegt bündig an der Trennwand (kein Bord auf der Wandseite).
- Punktetabelle per Tab gedrückt halten bzw. Tippen auf den Punktestand –
  so lassen.
- Zeiten: Menü/Hintergrund → nach 20 s raus, eingefrorener Tab → 15 s,
  AFK → 90 s. Runde: erstes Team mit 20 Kills, 6 s Pause.
- Treffer: "was der Schütze sah, zählt" (keine Server-Sichtlinienprüfung).

## Offene Ideen / nächste Schritte

- Politur: Sound (Schüsse, Schritte, Treffer), Spielermodell statt Kapsel,
  Effekte, Arena-Optik.
- Noch zu entscheiden: Kopftreffer-Bonus? Kollision zwischen Spielern?
- Später: Raum-Codes für private Runden, Ping-Anzeige, strengere
  Bewegungsprüfung auf dem Server, Hintergrund-Tab sendet nur ~1×/s.
