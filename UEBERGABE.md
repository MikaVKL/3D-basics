# Übergabe (Stand 2026-10-19)

Kurz-Stand für die nächste Sitzung. Dauerhafte Regeln und Entscheidungen stehen in `CLAUDE.md`; diese Datei hält nur,
was gerade läuft und was als Nächstes dran ist. Nach dem Abarbeiten bitte die erledigten Punkte hier streichen.

## Wo wir stehen

- Branch `claude/multiplayer-fps-networking-s0y8bp`, jeder Schritt wird auch auf `claude/modest-keller-5dphta` gepusht (nur der und `main` deployen).
- Letzte Arbeit: Gadget-Flugbahnen, Enterhaken (Titanfall-Art, balanciert), Lehnen als Umschalter, **zwei Gadget-Plätze** (Taktik G / Bewegung F),
  **neue Karte "Nexus"** (alte Karte verworfen), Umbenennung **Nexus Arena**. Gesamtlauf aller Tests war danach grün (letzter Commit `c44c623`).
- Nutzer (Mika, Zeitzone UTC+2) spielt am Laptop und iPad; die Bildschärfe-Einstellung hat dem iPad geholfen (15 FPS zu Hause war Gerät, nicht Netz).

## Nächste Schritte (in dieser Reihenfolge, mit Nutzer abgestimmt bzw. vorgeschlagen)

1. **Details erhöhen, ohne Performance zu opfern**: erst Wünsche vom Nutzer holen (Leuchtmarkierungen, Technikdeko, Wandvariation, Himmel/Ferne);
   billig = Texturen/Emissive, günstig = Instanzen (InstancedMesh), teuer = echte Lichter/Schatten/viele Einzelobjekte/Transparenz. Pakete mit Messung (`node tests/drawcalls.mjs`, Arena jetzt 29 Draw Calls) und Commit.
   Optional Einstellung "Details" (aus/an) für schwache Geräte. Keine realistischen Requisiten (Lasertag-Look).
2. **Zufällige Karte beim Serverstart**: erst sinnvoll mit einer zweiten Karte. Vorschläge für weitere Szenerien: Skyline (Türme/Dächer, Haken-Karte), Schlucht
   (Lücke, nur per Pad/Haken), Labyrinth (Rauch/Blend), Ring, Reaktor. Dafür Karten als Daten (ID, Grenzen, Spawns, Bauvorschrift), Server würfelt und meldet
   die ID in `welcome`, Client baut nach ID (Arena neu aufbaubar). `PROTOCOL_VERSION` dabei erhöhen.
3. **Bot-Messung der Spawns auf Nexus** (`npm run test:bots`): wie oft früh getroffen; Deckung vor Spawns (L-Form, nie zu einem U schließen).
4. Weiter hinten / zurückgestellt: Raum-Codes (ganz am Ende), Waffe inspizieren, Loadout-Skins.

## Offene Fragen an den Nutzer (noch unbeantwortet)

- Welcher Schuss-Sound fühlt sich falsch an?
- Scope-Ruckeln: besser mit "Scope-Unschärfe" aus bzw. "Bildschärfe" niedriger?
- Welche Details genau gewünscht (siehe oben, Punkt 2)? Passt die Karte Nexus im Spiel (Größe, Turm, Wege)?

## Wichtige Eigenheiten (Details in `CLAUDE.md`)

- Tests: `npm test` oder einzeln `node tests/<name>.mjs`; zwei Testskripte nie gleichzeitig (Ports 5199/8099). Freie Test-Gassen auf Nexus: Bahn z = 10
  (x -18..21), Bahn x = -14; Dummies bei (-14, 0.8, -6) und (14, 0.8, 6). Kurzformen für Gadget-Tests: `__dusk.throwSlot('move')`.
- Commit-Messages deutsch mit `Getestet:`, Fußzeilen `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` und `Claude-Session: ...`.
  Antworten an den Nutzer deutsch. Keine Bots im Spiel. Kleine, einzeln testbare Schritte; Design-Fragen erst vorschlagen.
- `PROTOCOL_VERSION` steht auf 22 (Gadget-`velocity` ist optional, kein Bruch).

## Nebenprojekt: Racing Lab (eigenes Repository `MikaVKL/racing-lab`)

Einfaches 3D-Rennspiel (Three.js/Vite/TS, ohne Server), zwei Strecken, Geisterauto, Drift. Verbesserungsideen (noch nichts gebaut, Sitzung hatte dort nur Lesezugriff):
Drift-Boost (Mini-Turbo), Leitplanken/stärkere Offroad-Bremse, Touch-Steuerung (iPad), mehr Strecken/Autos, Sektorzeiten, Online-Rangliste oder -Rennen.
