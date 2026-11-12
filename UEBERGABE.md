# Übergabe (Stand 2026-11-12)

Kurz-Stand für die nächste Sitzung. Dauerhafte Regeln und Entscheidungen stehen in `CLAUDE.md`; diese Datei hält nur,
was gerade läuft und was als Nächstes dran ist. Nach dem Abarbeiten bitte die erledigten Punkte hier streichen.

## Wo wir stehen

- Branch `claude/peaceful-mayer-wnignw` (wechselt je Sitzung), jeder Schritt wird auch auf `claude/modest-keller-5dphta` gepusht (nur der und `main` deployen, die Seite
  https://mikavkl.github.io/3D-basics/ ist nach jedem Push in ~1 Min. aktuell; harter Neuladen mit Strg+Shift+R).
- Zuletzt gebaut (alles getestet, gepusht): Teamauswahl am Start (Rot/Blau/Automatisch mit Spielerzahl, bis 2 Spieler Abstand, 1 gegen 3 geht),
  Draw Calls der Arena 163 -> 29 (`bakeStaticParts`), Einstellung "Zielen umschalten" (Touchpad), Testkarte **Skyline**, Schwinghaken-Prototyp.
- Nutzer (Mika, Zeitzone UTC+2) spielt am Laptop (Touchpad) und iPad. Er testet neue Stände direkt auf der Website.

## Testkarte Skyline (`?map=skyline`, nur offline, `src/arenaSkyline.ts`)

- Adresse: https://mikavkl.github.io/3D-basics/?map=skyline . **H = Flugmodus** (Leertaste hoch, Ducken runter, Shift schneller), Absturz unter -20 m = neu am Spawn.
- Aufbau: drei Hochhäuser (A/B 18 m, Mitte C 20 m) ohne Boden (Nebel), Hallen darunter (Boden 12 m, Spawns innen), Rampe Halle -> Dach, gerade Skybridge,
  offene Außenterrasse mit Reling (Nordseite A -> C, Südseite C -> B), Stege 18 -> 20 m, Atrium, hängende Container an Kränen, Funkmasten, Werbetafeln.
  Tageslicht-Look (Nutzerwunsch: weg vom dunklen Lasertag, Sonne, helle Texturen); ob Nexus auch so werden soll, ist offen.
- Nutzer-Rückmeldung: gefällt (Löcher, Stege), "noch roh, genau richtig"; **Proportionen stellenweise eng/weit** (konkret: Rampenfuß, ist behoben), weitere Stellen
  will er beim nächsten Durchlauf nennen. Modus: **Team-Deathmatch**, Capture the Flag ist vom Tisch. Sniper-Sorge: Karte soll auch Nahkampf bieten
  (Hallen/Terrasse). **Gemessen** (`node tests/sightlines.mjs`, Raster 1,5 m, Auge -> Auge über alle Standpunkte): Skyline hat deutlich WENIGER lange
  Sichtlinien als Nexus (über 30 m: 7,8 % gegen 20,9 %; über 40 m: 1,9 % gegen 6,7 %; Median 11,7 m gegen 19,2 m; unter 10 m: 41,6 % gegen 18,0 %;
  Standpunkte mit Sicht über 30 m: 63 % gegen 99 %). Schildpaket im Atrium also nicht nötig. Nach Umbauten (Fenster, Glas) neu messen.

## Schwinghaken (Prototyp, nur auf der Testkarte)

- Ersatz im Bewegungs-Platz (F), `swing`: Pendel am Anker (24 m), keine Abklingzeit, Ducken holt ein, Sprung in der Luft/Landung löst, Tempo gedeckelt (14/9 m/s).
  Details in `CLAUDE.md`. Der Server lehnt ihn ab, `PROTOTYPE_GADGETS`. Noch offen: Gefühl (Seillänge, Tempo, Einholen), Seil durch Wände, Seil für andere Spieler,
  Online-Anbindung. Wartet auf Rückmeldung nach dem Ausprobieren.

## Fehlersuche Netzcode/Server (2026-11-12, läuft)

- Gelesen: `server/index.ts`, `network.ts`, `remotePlayers.ts`, `shared/protocol|gameRules|movementRules`, Netz-Handler in `main.ts`.
  Noch NICHT gründlich gelesen: `weapon.ts`, `player.ts`, `gadgets.ts` (Client-Seite von Treffern, Bewegung, Gadgets).
- Behoben (je mit Test): Server-Absturz bei ungültigem WebSocket-Frame (`tests/payload.mjs`), Waffenwahl/Magazin/Gadgets nach Respawn ohne Tod
  (`tests/respawn-alive.mjs`), AFK-Rauswurf bei langsamem Umschauen (`tests/afk.mjs`).
- Gefunden, NICHT geändert (Vorschlag an Nutzer, wartet auf Antwort):
  1. Rundenpause: Gadget-Wurf lehnt der Server ab, der Client wirft trotzdem lokal (Abklingzeit weg, andere sehen nichts; ein Sprungpad
     existiert dann nur beim Werfer). Vorschlag: im Client während der Pause nicht werfen. Ebenso zeigt der Client in der Pause Treffermarker,
     obwohl der Server nichts abzieht.
  2. Treffer-Ratenlimit (Vorrat 3): Shotgun, die mehrmals hintereinander zwei Gegner je Schuss trifft, verliert den 6. Treffer (je Gegner
     eine `hit`-Nachricht). Selten; Lösung wäre ein Token je Schuss statt je Ziel.
  3. Kein Limit für Nachrichten je Sekunde (z. B. `setName`-Flut löst je Nachricht eine Spielerliste an alle aus). Nur bei Böswilligen relevant.

## Nächste Schritte (mit Nutzer abgestimmt bzw. vorgeschlagen)

1. **Rückmeldung zu Skyline und Schwinghaken abwarten**, dann Werte/Proportionen nachziehen. Skyline polieren: Fenster in den Hallen (Schüsse durch, Spieler nicht),
   Glas der Skybridge, Proportionen; danach Sichtlinien neu messen (`node tests/sightlines.mjs`).
2. **Zweite Karte online**: Karten als Daten (ID, Grenzen, Spawns), Server würfelt beim Start und meldet die ID in `welcome`, Client baut nach ID,
   `PROTOCOL_VERSION` erhöhen. Dafür Server-Grenzen (`sanitizeState`: `MAX_HEIGHT` 30 m, Arena-Grenzen) und Bewegungsprüfung auf die Höhen/den Abgrund anpassen,
   Sturztod serverseitig, Minimap für die Höhenebenen. Erst wenn Skyline sich gut anfühlt.
3. **Look**: Tageslicht auch für Nexus? (Nutzer: "Nexus wirkt wie eine Testkarte, eher im Sonnenlicht mit helleren Texturen"). Details erhöhen im Budget
   (Draw Calls <= 60 Arena, gesamt <= 150).
4. Bot-Messung der Spawns nach Kartenänderungen (`npm run test:bots`), Nexus-Spawns waren unauffällig.
5. Zurückgestellt: Raum-Codes (in Roblox-Variante unnötig), Waffe inspizieren, Loadout-Skins. Offen: "welcher Schuss-Sound fühlt sich falsch an" (Nutzer erinnert sich nicht, vorerst weglassen).

## Idee: Übersetzung nach Roblox (später, wenn das Spiel fertig ist)

Nutzer will die finale Version irgendwann in Roblox nachbauen (Luau, kein Import möglich, Neubau mit dem Repo als Spezifikation: Werte aus `src/shared/`, `CLAUDE.md`,
Enterhaken-Beschreibung). Dafür bei Neuem Logik und Darstellung trennen; vor der Übersetzung ein `SPEC.md` mit dem Verhalten schreiben.

## Wichtige Eigenheiten (Details in `CLAUDE.md`)

- Tests: `npm test` oder einzeln `node tests/<name>.mjs`; **zwei Testskripte nie gleichzeitig** (Ports 5199/8099), `pkill -f "[v]ite.js --port 5199"` räumt auf.
  In diesem Container (4 Kerne) sind `background.mjs` (schon vor den Änderungen), `ping.mjs`, `fps.mjs`, `weapons.mjs`, `sniper.mjs` unter Last flaky: einzeln und bei ruhiger CPU laufen lassen.
- Commit-Messages deutsch mit `Getestet:`, Fußzeilen `Co-Authored-By: ...` und `Claude-Session: ...` (gibt die jeweilige Sitzung vor)
  (Nachricht per Datei im Scratchpad, `git commit -F`). Antworten an den Nutzer deutsch. Keine Bots im Spiel. Kleine, einzeln testbare Schritte; Design-Fragen erst vorschlagen.
- `PROTOCOL_VERSION` steht auf 22 (Teamwunsch `hello.team` und `GET /teams` sind optional bzw. neu, kein Bruch).
- Das Spiel ist nach jedem Push live (Pages + Render-Server). Neue Testkarten/Prototypen nur hinter Adresse oder Schalter lassen.

## Nebenprojekt: Racing Lab (eigenes Repository `MikaVKL/racing-lab`)

Einfaches 3D-Rennspiel (Three.js/Vite/TS, ohne Server), zwei Strecken, Geisterauto, Drift. Verbesserungsideen (noch nichts gebaut, Sitzung hatte dort nur Lesezugriff):
Drift-Boost (Mini-Turbo), Leitplanken/stärkere Offroad-Bremse, Touch-Steuerung (iPad), mehr Strecken/Autos, Sektorzeiten, Online-Rangliste oder -Rennen.
