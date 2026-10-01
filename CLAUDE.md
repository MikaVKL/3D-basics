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
- `src/weaponIcons.ts` – Waffen-Umrisse (SVG) für Kill-Feed und Waffenfeld
- `src/sky.ts` – Abendhimmel-Kuppel (Farbverlauf), folgt der Kamera
- `src/surfaceTextures.ts` – Kisten-/Plattenmuster (Canvas, Graustufen x
  Palettenfarbe); `worldBox()` statt BoxGeometry, damit Muster nicht verzerren
- `src/decorations.ts` – Wandlampen, Rampen-Schilder A/B (reine Optik: nicht
  in solids/shootables, Schüsse gehen durch)
- `src/playerAvatar.ts` – Spielerfigur: `root` sichtbar, `mesh` (Körper-Kapsel)
  und `headMesh` (Kopf-Box, `userData.headshot`) unsichtbare Trefferflächen.
  Look: fast schwarze Rüstung (Weste, Helm) mit Leuchtteilen in Teamfarbe
- `src/minimap.ts` – Minimap rechts oben (Norden oben): Grenzen und Zeichnung aus
  `arena.solids` + `arena.ramps`, Pfeil für dich, Punkte für dein Team
- `src/network.ts` (Verbindung, join/leave), `src/remotePlayers.ts`
  (Interpolation auf der Uhr des Absenders), `src/player.ts` (Bewegung und
  Kollision: Boden über die ganze Standfläche, Deckenkollision, "nur tiefer
  hinein blockiert"), `src/arena.ts` (Level-Geometrie).
- Nur im Dev-Build: `window.__dusk` (player, network, remotePlayers, camera,
  weapon, arena, lookControl, hitFeedback, renderer, ...) für Browser-Tests;
  `renderer.info.render.calls` = Draw Calls (Leistung).

## Tests

Einmalig: `npm run test:setup` (installiert Playwright + ws in `tests/`,
getrennt vom Hauptprojekt, damit das Hosting keine Browser-Pakete lädt).
Die Tests starten Vite und Spielserver selbst auf eigenen Ports (5199/8099).

- `npm run test:movement` – Kisten, Rampen, Durchgang, Fenster-Duck-Sprung,
  obere Ebene (Rampe A -> Brücken -> Nord-/Südsteg, Geländer, Absprung,
  unter dem Steg), Rutschen, Bunny-Hop (+5 %), Schwung, kein Nachgleiten
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
- `npm run test:tracer` – Laserstrahl: Kern + Schein in Teamfarbe, 0,2 s mit
  weichem Ausblenden, aufgeräumt, fremde Strahlen rot/blau
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
  Speicher, Server-Fehler). Auch mit Ping laufen lassen. Gibt je Spawn-Punkt
  aus, wie oft man kurz nach dem Spawn getroffen wird/stirbt.
- `npm run test:touch` – Touch-Steuerung (Handy-Emulation): Ducken-Button
  halten = ducken/rutschen, loslassen = aufstehen; Schießen halten + wischen =
  zielen; Sprung halten = weiterhüpfen
- `npm run test:ping` – Ping-Anzeige: Messwert (auch mit 200 ms simuliert),
  Farbe, ausgeblendet ohne Verbindung, Ping-Spalte in der Tab-Tabelle,
  Spielerliste bei stabilem Ping selten verschickt
- `npm run test:background` – Hintergrund-Tab: Zustand versteckt ~1/s statt
  20/s, danach wieder volle Rate, Spieler bleibt für andere sichtbar
- `npm run test:movement-check` – Prüf-Logik der Server-Bewegungsprüfung mit
  24000 echten Zuständen (0 Fehlalarme bei Ping/Bündelung/Hintergrund-Tab)
  und simulierten Cheats (Teleport, Speedhack, Fliegen)
- `npm run test:movement-enforce` – im Spiel: normales Laufen/Rutschen/Springen
  ohne Korrektur, Teleport wird zurückgesetzt (andere sehen ihn nie an der
  Fake-Stelle), wiederholt = Rauswurf ins Menü
- `npm run test:connection` – Verbindungswarnung: nie im normalen Spiel (auch
  mit Ping), erscheint bei eingefrorenem Server (SIGSTOP), verschwindet danach,
  Spiel läuft weiter; Server erst später erreichbar bzw. Neustart: Abblenden +
  Hinweis beim Beitritt, Hinweis bei Verbindungsverlust, keiner beim Menü
- `npm run test:hud` – HUD: Lebensanzeige (Werte, Aufblitzen bei Schaden,
  Pulsieren ab 30 Leben, nicht bei Tod/Respawn), Waffenfeld (Nachlade-Balken,
  leeres Magazin), Fadenkreuz (Lücke = echte Streuung, Messer-Ring)
- `npm run test:menu` – Pausenmenü: Weiter/Einstellungen, Zurück, Klick daneben,
  Wiederkehr nach ESC
- `npm run test:minimap` – Karte: Ausschnitt aus den Arena-Daten, Wand/Kiste/Steg
  gezeichnet, neues Objekt außerhalb weitet den Ausschnitt, eigener Pfeil,
  OBEN/UNTEN, nur Teamkameraden (Gegner nie), andere Etage gedimmt
- `npm run test:roundstats` – Rundenende: Statistik-Liste (Stern, Teamfarben,
  Kills/Tode/Kopftreffer, eigene Zeile), Nachzügler sehen sie, nächste Runde
  startet bei 0
- `npm run test:settings` – Einstellungen: Regler (Empfindlichkeit 0,3-8×,
  Blickfeld 60-110°, Lautstärke 0-100 %) wirken sofort, Rutschen +7° auf das
  gewählte Blickfeld, Minimap an/aus (Haken, Taste N), gemerkt im Browser,
  kaputte Speicherwerte, Zurücksetzen
- `npm run test:layout` – keine HUD-Überlappungen in 6 Bildschirmgrößen
  (Rechner bis kleines Handy quer, online mit langem Status/Kill-Feed),
  Handy hochkant zeigt "Gerät drehen". Nach jeder HUD-Änderung laufen lassen.
- `npm run test:contrast` – Erkennbarkeit: rote/blaue Figur vor Kiste, Wand,
  Boden, Weite; Farbabstand ΔE (Median >= 28, schwächstes Fünftel >= 20).
  Nach jeder Änderung an Farben, Licht, Materialien oder Deko laufen lassen.
- `node tests/topdown.mjs [ordner]` – Draufsicht der Arena (Norden oben,
  Meterraster, Spawns S0..S5) als `topdown.png` und `topdown-unten.png` (ohne
  obere Ebene). Für Abstimmungen über Kartenänderungen mitschicken.
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
- Läuft auf 5199/8099 schon etwas, bricht `startServers` mit Meldung ab
  (früher testete man unbemerkt gegen einen verwaisten Vite). Aufräumen mit
  `pkill -f "[v]ite.js --port 5199"` (das `[v]` verhindert, dass pkill die
  eigene Shell trifft).
- Der Container wird gelegentlich neu gestartet; manuell gestartete
  Dev-Server laufen dann nicht mehr.

## Getroffene Entscheidungen (nicht wieder "reparieren")

- **Obere Ebene** auf 2,8 m (Höhe Plattform A): 3 m tiefe Laufstege an
  Nord- und Südwand (Trennwand bis Ostwand), je eine Brücke von Plattform A,
  Geländer 1 m mit Absprung-Lücke (Nord x 26..28, Süd x -16..-14), Unterkante
  2,5 m (stehend passt man drunter, im Sprung stößt man an). Aufgänge: Rampe A
  und Eck-Rampen Nordwest/Südost (3x3-Plattform in der Ecke, 10-m-Rampe am
  Steg entlang, stegseitig Wand statt Bord). Südwest: über Rampe B und das Fenster (s.u.).
  Die mittleren Spawns (0, ±18) liegen darunter. Wandlampen auf 5,2 m.
  Nichts unter Steg/Brücke stellen (Kisten wurden deshalb versetzt).
- Fenster-Deckungswand ist per **Duck-Sprung durchkletterbar** (gewollter
  Trick-Weg, Öffnung 1,4 m); stehend passt man nicht durch.
- Rampe B (2,8 m) liegt bündig an der Trennwand (kein Bord auf der Wandseite).
- Ducken wird überall gehalten, auch auf Touch (Nutzerwunsch, kein Umschalter):
  Rutschen nur, solange gehalten.
- Punktetabelle per Tab gedrückt halten bzw. Tippen auf den Punktestand –
  so lassen.
- Zeiten: Menü/Hintergrund → nach 20 s raus, eingefrorener Tab → 15 s,
  AFK → 90 s. Runde: erstes Team mit 20 Kills, 10 s Pause (Rundenstatistik).
- Treffer: "was der Schütze sah, zählt" (keine Server-Sichtlinienprüfung).
- Fadenkreuz zeigt nur echte Streuung (Sturmgewehr-Dauerfeuer), nicht Laufen/
  Springen - die beeinflussen die Treffsicherheit nicht.
- Handy hochkant: nur Hinweis "Gerät drehen" (Buttons + HUD passen nicht).
- Kisten sandbraun statt orange (zu nah an Team Rot, messbar schlechter
  erkennbar). Farben in `src/palette.ts`.
- Deckungskisten vor den mittleren Spawns (0, ±18). Bot-Test mit Sichtlinie:
  Nord-Spawn 68 % -> 41 % früh getroffen; Süd-Spawn bleibt ~80 % (Schüsse
  kommen schräg) - Lösung mit Nutzer abstimmen. Mit den Laufstegen
  darüber (5 Bots x 420 s, 2 Läufe): Nord 38/17 %, Süd 63/38 % früh
  getroffen (je nur 8 Spawns, Schüsse schräg aus West-Zone und Osten).
  Daraufhin (Nutzerwahl) Süd-Spawn rundum gedeckt: Front 7 m, Seitenteile
  bis zur Stegkante, raus seitlich unter dem Steg (Stütze dafür x -3 -> -7).
  Danach mit Eck-Rampen (2 Läufe): Süd 0/0 % (nur 2/4 Spawns), Nord 60/60 %
  (je 5 Spawns). Daraufhin Nord-Spawn genauso gedeckt (Ost-Seitenteil bis
  an die Fensterwand, L-Deckung bei (-3, -16) entfiel): Nord 0/14 %
  (5/7 Spawns), Süd 20/11 % (5/9), West-Spawns 0-25 %. Danach (Nutzer: "man ist
  komplett eingesperrt") auf ein L reduziert: Front 6 m + nur das Seitenteil
  auf der Schussseite (Nord: Ost bis zur Fensterwand, Süd: West), die andere
  Seite ist offen. Nicht wieder zu einem U schließen. Tests laufen deshalb nicht
  mehr auf der Linie x = 0 (Bahnen bei x = -8 bzw. 12).
- Beitritt zur Online-Runde (auch automatisch, wenn der Server erst aufwacht
  oder neu startet) setzt einen an einen Spawn - mit kurzem Abblenden und
  Hinweis, sonst wirkt es wie ein zufälliger Teleport (Nutzer-Bugmeldung).
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

- **Fenster/Rampe B (Südwest):** West-Plattform liegt jetzt auf 2,8 m (obere
  Ebene), Rampe 9,4 m lang (Steigung ~0,3). Der Durchgang in der Trennwand
  (Sockel 2,8 m, Kopffreiheit 2,2 m) führt auf eine 2,5 m breite Verbindung
  (x -19,5..-17, z 11,5..17,5) mit Geländer im Osten, Nordende offen
  (Absprung), die am Südsteg endet (Geländerlücke dort). Damit ist die
  Südwest-Ecke kein "geht nicht" mehr; sie ist der dritte Aufgang.
- **Tunnel unter den Stegen** (Nutzer: keine Sackgassen): Der Gang unter dem
  Nordsteg ist am Westende durch die Trennwand geöffnet (z -20,5..-17,5, 2,5 m
  hoch) und führt in die West-Zone. Deshalb steht **Spawn S0 bei (-29, -11)**
  (nicht mehr (-28, -18)): aus dem Tunnel war er sonst auf 21 m einsehbar.
  `test:movement` prüft, dass aus dem Tunnel kein West-Spawn einsehbar ist.
  Einsehbarkeit je Spawn messen: Raster über die Arena, Raycast gegen
  `arena.solids` (Augenhöhe, bis 40 m): S0 11 %, S1 12 %, S2 17 %, S3 25 %.
  Der Gang zeigt nach Osten auf den Nord-Spawn S2 (schon immer so).
  **Südost-Tunnel als L in die Ostzone:** Der Gang unter dem Südsteg geht am
  Ostende durch die Hauptraum-Ostwand (z 17,5..20,5, 2,5 m hoch) nach Osten
  (bis x 36), biegt außerhalb der Räume nach Norden ab (x 33..36) und mündet
  durch die Flankenraum-Südwand (z 12) in die Ostzone. Gebaut aus Wandteilen
  (`SE_TUNNEL_*` in `arena.ts`: Durchbruch + Sturz, Südwand, Ostwand, dünne
  Westwand, Decke über beiden Armen, Bodenfläche `tunnelGround`). Die
  Eck-Plattform bleibt massiv. (Ein erster Entwurf mit hohler Plattform und
  Ausgang in den Hauptraum wurde auf Nutzerwunsch ersetzt.)
  Aus dem langen Südgang (inkl. neuem Ostarm) ist S3 (0, 18) auf 19-33 m
  einsehbar; bewusst nicht verändert (Linie gab es schon als Sackgasse). Wer
  sie entschärfen will: Spawn S3/S2 verschieben (Einsehbarkeit messen) statt
  Kisten in den Gang zu stellen.
- **Nordost-Halle** (x 32..52, z -21..-12): Zugang über 8-m-Öffnung
  (x 38..46) in der Flankenraum-Nordwand. Der Nordsteg läuft durch die
  Hauptraum-Ostwand (Öffnung z -20,5..-17,5 ab 2,8 m, Sockel darunter) als
  Regal-Steg bis zur Ostwand, Absprung-Lücke x 47..49. Die Öffnung hat
  bewusst KEINEN Sturz: mit 2,2 m Kopffreiheit stieß man im Sprung mitten
  in der Tür an (stuck-fuzz Seed 3). Spawn 5 (49,5 / -19,2) unter dem Steg.
- **Keine Requisiten** wie Autowracks, Fässer, Paletten (Nutzer: passen nicht
  zum Lasertag-Look; das Vorlagenfoto galt nur dem Aufbau der Arena). Es
  bleiben drei 6-m-Neon-Säulen (dunkler Kern `Palette.pillar`, drei
  leuchtende Ringe wie die Wandstreifen, Ringe nur Optik) und die Kisten.
  Neue Objekte nur in Neon/Low-Poly-Optik, nie realistisch.
- Bot-Test mit 6 Spawns (2 Läufe): nirgends auffällig (früh getroffen 0-33 %,
  je Spawn nur 1-9 Spawns; Ausreißer Spawn 4 mit 4x/50 %). Kills je Lauf
  fielen von ~55 auf ~20, weil Pfeiler/Wracks (Wracks inzwischen entfernt) die geradeaus laufenden Bots
  bremsen - Bots kennen keine Wege um Hindernisse, kein Spielfehler.
- **Minimap** (rechts oben, `src/minimap.ts`): wird NICHT von Hand gezeichnet,
  sondern aus `arena.solids`/`arena.ramps` erzeugt - neue Kisten, Wände, Hallen
  erscheinen von selbst, Ausschnitt = alle Objekte + 1,5 m. `Solid.kind`
  (`wall`/`cover`, sonst Struktur) färbt; Teile < 0,5 m (Stützen) bleiben weg,
  Teile ab 2 m Unterkante (Stege, Brücken) halbtransparent obendrauf. Nur
  Teamkameraden und du (Pfeil), **keine Gegner** (wäre ein Radar durch Wände),
  andere Etage gedimmt, Anzeige OBEN/UNTEN. Nach Änderungen an der Arena zur
  Laufzeit `minimap.rebuild()`. Ein/Aus: Einstellung "Minimap" oder Taste N
  (`settings.minimap`, gemerkt, Standard an; aus = kein Zeichnen mehr). Der
  Platz neben der Karte bleibt auf Touch absichtlich reserviert (dort sitzen
  rechts die Buttons, der Kill-Feed würde sie sonst überdecken). Kill-Feed sitzt unter der Karte (Touch: links
  daneben, unter "Erstes Team mit 20 Kills"); Rundenstatistik und Hinweis-Banner
  blenden ihn aus (`test:layout` prüft den Normalfall und beide Banner). Bei
  einer viel größeren Arena (> ~150 m) auf Ausschnitt um den Spieler umstellen.
- **Rundenstatistik** (`roundEnd.stats`, `src/roundStats.ts`): Liste unter dem
  Siegertext, nach Kills sortiert, Stern beim Besten, Namen in Teamfarbe,
  eigene Zeile markiert; Spalten K, T, Kopf (Kopftreffer = Treffer am Kopf,
  zählt der Server je Spieler). Angezeigt werden die besten 6 + die eigene
  Zeile; auf niedrigen Bildschirmen (< 560 px) die besten 4 + eigene, weil
  sonst Waffenfeld/Buttons überlappen (`test:layout` prüft das mit 8 Spielern).
  Alte Server schicken keine Liste (Client zeigt dann nichts).
- **Einstellungen** (`src/settings.ts`, Menü "Einstellungen"): Empfindlichkeit,
  Blickfeld, Lautstärke; `localStorage` `duskArena.settings`, jeder Wert
  einzeln begrenzt/auf Standard, wenn kaputt. Wirkt über
  `LookControl.setSensitivityScale`, `SlideView.setBaseFov` (Rutschen addiert
  weiter +7°) und `SoundFx.setVolume` (M = Stumm bleibt getrennt). Neue
  Einstellungen: Bereich in `SETTING_RANGES`, Zeile in `index.html`, Format
  in `main.ts`.
- **Laserstrahl (Leuchtspur) bleibt** (Nutzer mag ihn): heller weißer Kern +
  additiver Schein in der Teamfarbe des Schützen, 0,2 s, quadratisch
  ausgeblendet, ohne Nebel (`weapon.ts`). Je Waffe andere Stärke
  (`TRACER_STYLES`): Pistole dick/hell/0,2 s, Sturmgewehr dünn/schwächer/0,12 s. Vorher nur 0,06 s und 3 cm dünn -
  wirkte wie ein direkter Einschlag. Nicht wieder verkürzen/entfernen.
- **Bewegungsprüfung** (`src/shared/movementRules.ts`, Server): Strecken-
  Guthaben aus Serverzeit (13 m/s x 1,25 waagerecht, 9,5 m/s hoch, 30 m/s
  runter, max. 1,5 s Vorrat - Ping-Bündelung und Hintergrund-Tab bleiben
  legal). Basis ist der Spawn, den der Server wählt (Beitritt/Respawn), nie
  eine Clientposition. Verstoß: Zustand verwerfen, alle 500 ms `correct`
  (Client `player.moveTo`, Leben bleibt), 5 Korrekturen in 10 s = Rauswurf
  (`kicked: movement`). Aus dem Stand ist einmal ~24 m erlaubt (Vorrat).
  `MOVEMENT_CHECK=off|log|enforce` (Standard enforce); die Tests starten den
  Server mit `off`, weil sie absichtlich teleportieren (Bot-Test und
  movement-enforce mit enforce). Neue Bewegungsmechaniken (schneller als
  13 m/s, größere Sprünge) müssen die Konstanten dort mit anheben,
  sonst gibt es Rubber-Band. PROTOCOL_VERSION 18.
- **4,2-m-Ausguck** (Rampe aus Brettern auf dem Regal-Steg) bewusst NICHT
  gebaut: Wände 6 m, Lampen 5,2 m, Ramp-Logik nur für Rampen ab Boden
  getestet - Nutzen gering gegen Risiko. Nur nach Absprache.

- **Spielerfigur** (Lasertag-Look, abgestimmt): Weste mit Diagonalgurt vorn und
  hinten, Leuchtgürtel, Ringe an Armen/Beinen, Helm mit Visier und Antenne,
  Waffenkante in Teamfarbe. Rüstung ist bewusst *fast* schwarz (Nutzerwunsch),
  bekommt aber einen Farbschimmer (`ARMOR_GLOW` 0,22) und Leuchtkanten:
  echtes Schwarz fällt in `test:contrast` durch (schwächstes Fünftel 12-15 ΔE),
  bei 0,12/0,18 scheitert Blau vor Wand/Boden. Blau ist der knappste Fall
  (Boden 21,8 bei Schwelle 20). Wer die Rüstung schwärzer will, muss zuerst
  Kontrast klären.
- **Keine Kollision zwischen Spielern** (Empfehlung angenommen: Lasertag-
  üblich, keine Blockade-Streits an Engstellen, Server prüft nicht mehr).

## Offene Ideen / nächste Schritte

- Reihenfolge (mit Nutzer abgestimmt): Sound, Spielermodell, Effekte,
  Kopftreffer, Waffen, Rutschen/Bunny-Hop (erledigt) -> Ping ->
  Arena/Optik/HUD -> Hintergrund-Tab -> Server-Prüfung -> ganz am Ende
  (Nutzer, nur zurückgestellt): Raum-Codes für private Runden.
- **Leitlinie (Nutzer):** Das Spiel hat keine Bots und bekommt keine. Die Bots
  in `tests/bots.mjs` sind nur ein Testwerkzeug (Browser-Clients, die wie
  Spieler agieren) und werden nicht weiterentwickelt. Ab jetzt nur noch
  Dinge, die die Spielerfahrung verbessern.
- Erledigt: Hintergrund-Tab sendet nur ~1×/s (`network.ts`; Austritt nach
  20 s bleibt), Bewegungsprüfung auf dem Server (Stufe 1+2, s. unten).
  Stufe 3 (Wand-/Flug-Prüfung mit Arena-Geometrie im Server) bewusst nicht
  gebaut: `arena.ts` bräuchte eine Box-Liste in `src/shared/`, Nutzen gering
  (Nutzer rechnet nicht mit Cheatern).
- Ganz am Ende, nicht vorher anfangen: Raum-Codes (eigene Räume). Der Server
  hält Spieler, Punkte und Runde global (`clients`, `scores`, `nextRoundAt`
  in `server/index.ts`) - dafür müsste das in eine Raum-Klasse.
