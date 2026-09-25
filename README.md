# Dusk Arena – Ego-Shooter-Prototyp

Ein browserbasierter 3D-Ego-Shooter-Prototyp im Stil von Krunker.io, gebaut mit
[Three.js](https://threejs.org/) + [Vite](https://vitejs.dev/) + TypeScript.

## Visueller Stil: "Dusk Arena + Neon"

Statt Texturbildern (JPG/PNG) nutzt das Projekt bewusst nur farbige Materialien,
Licht und Schatten für die Optik:

- **Kühle Grundfarben** (Petrol/Blaugrau) für Boden, Wände und Himmel –
  ruhige, dämmerungsartige Stimmung.
- **Warme Akzentfarbe** (Orange) für Deckungen/Kisten – zieht das Auge auf
  gameplay-relevante Objekte.
- **Dezente Neon-Kanten** (Cyan, leuchtend/emissive) an den Wänden – ein
  Hauch Cyberpunk-Atmosphäre, ohne die Lesbarkeit im Kampf zu stören.

Alle Farben sind zentral in [`src/palette.ts`](src/palette.ts) definiert.

## Projektstruktur

```
src/
  palette.ts        Zentrale Farbpalette (alle Spielfarben an einem Ort)
  arena.ts           Baut die Spiel-Arena (Boden, Wände, Deckungen)
  player.ts          Bewegung/Physik/Kollision - unabhängig von der Eingabequelle
  lookControl.ts      Kamera-Drehung (Yaw/Pitch) - wird von Maus UND Touch genutzt
  input/
    DesktopInput.ts   Maus + Tastatur (Pointer Lock)
    TouchInput.ts     Touch-Steuerung (virtueller Joystick + Wisch-Look)
  main.ts             Einstiegspunkt: Szene, Licht, Game Loop, wählt die Eingabe
  style.css           UI (Fadenkreuz, Overlay, Touch-Joystick/Button)
```

**Warum diese Aufteilung?** `player.ts` (Bewegung/Kollision) und `lookControl.ts`
(Kamera-Drehung) wissen nichts davon, WOHER die Eingabe kommt. `DesktopInput`
und `TouchInput` füttern beide nur `player.setMoveInput(x, z)`, `player.jump()`
und `lookControl.rotate(deltaX, deltaY)`. Dadurch ist Touch-Support kein
Wegwerf-Hack für die Entwicklung, sondern eine gleichwertige, dauerhafte
zweite Eingabeart.

## Entwicklung starten

```bash
npm install
npm run dev
```

Dann im Browser die angezeigte URL (z.B. http://localhost:5173) öffnen.

Die Steuerung wird automatisch anhand des Geräts gewählt (per
`window.matchMedia('(pointer: coarse)')` - erkennt Touch-Geräte wie Tablets
zuverlässiger als reines Feature-Sniffing):

**Desktop/Laptop (Maus + Tastatur):**
- `W A S D`: Bewegen
- Maus: Umschauen (Klick auf den Startbildschirm aktiviert die Maussteuerung)
- `Leertaste`: Springen
- `ESC`: Maussteuerung freigeben (Menü)

**Tablet/Handy (Touch):**
- Linke Bildschirmhälfte: virtueller Joystick zum Bewegen (erscheint dort, wo man hintippt)
- Rechte Bildschirmhälfte: Wisch-Geste zum Umschauen
- Button unten rechts: Springen

## Multiplayer

Bis zu 8 Spieler in einem gemeinsamen Raum, Team Rot gegen Blau.

```
server/index.ts          Spielserver (Node.js + ws), läuft direkt als TypeScript
src/shared/              Code, den Client UND Server nutzen:
  protocol.ts              Nachrichtenformat (bei Änderungen PROTOCOL_VERSION erhöhen)
  gameRules.ts             Schaden/Schild/Respawn-Regeln
  arenaLayout.ts           Arena-Maße + Spawn-Punkte
src/network.ts           Verbindung zum Server (mit automatischem Neuverbinden)
src/remotePlayers.ts     Andere Spieler: Hüllen + Interpolation
src/killFeed.ts          Kill-Anzeige oben rechts
```

**Aufgabenteilung:** Jeder Client bewegt sich selbst (keine Eingabeverzögerung)
und schickt 20x/s seine Position. Der Server prüft Plausibilität und verteilt
20x/s einen Snapshot aller Spieler; fremde Spieler werden 100 ms verzögert
zwischen zwei Snapshots interpoliert. Treffer meldet der Schütze ("was ich
gesehen habe, zählt"), der Server prüft sie (Team, beide lebendig,
Feuerrate, Distanz) und entscheidet allein über Leben, Schild, Tod, Respawn
und Punktestand.

### Lokal testen

```bash
npm run dev:server   # Spielserver auf Port 8080 (startet bei Änderungen neu)
npm run dev          # zweites Terminal: Client
```

Den Client in zwei Browser-Tabs öffnen - im Dev-Modus verbindet er sich
automatisch mit `ws://<gleicher Rechner>:8080`, auch von Tablets im WLAN.
Ohne laufenden Server spielt man ganz normal Singleplayer gegen die
Ziel-Dummies. Mit `?server=ws://...` in der URL lässt sich jeder Build auf
einen beliebigen Server zeigen.

### Multiplayer-Server hosten (kostenlos, Render.com)

GitHub Pages kann nur statische Dateien ausliefern, der Spielserver braucht
ein eigenes Zuhause. Einmalige Einrichtung:

1. Auf [render.com](https://render.com) mit dem GitHub-Konto anmelden
   (kostenlos, keine Kreditkarte nötig).
2. **New → Blueprint** wählen, dieses Repository auswählen und als Branch
   `claude/modest-keller-5dphta` angeben (auf `main` gibt es den Server noch
   nicht). Render liest `render.yaml` und legt den Dienst
   `dusk-arena-server` im kostenlosen Tarif an. Jeder Push auf den Branch
   deployt den Server automatisch neu.
3. Nach dem ersten Deploy die angezeigte Adresse kopieren, z.B.
   `https://dusk-arena-server.onrender.com`.
4. Auf GitHub: **Settings → Secrets and variables → Actions → Variables →
   New repository variable**, Name `SERVER_URL`, Wert dieselbe Adresse mit
   `wss://` statt `https://` (z.B. `wss://dusk-arena-server.onrender.com`).
5. Das Pages-Deployment neu anstoßen (Actions → "Deploy to GitHub Pages" →
   Run workflow) - ab dann verbindet sich die Live-Seite mit dem Server.

Der kostenlose Tarif schläft nach ca. 15 Minuten ohne Spieler ein. Der erste
Spieler danach sieht bis zu ~1 Minute "Server wird geweckt…" und spielt
solange Singleplayer, dann verbindet sich das Spiel von selbst.

`ALLOWED_ORIGINS` (in `render.yaml`) legt fest, von welchen Webseiten aus
man sich verbinden darf - aktuell nur `https://mikavkl.github.io`.

## Geplant

- Spielernamen, Ping-Anzeige
- strengere Bewegungsprüfung auf dem Server
- Optik: Spielermodelle, Assets, Effekte
