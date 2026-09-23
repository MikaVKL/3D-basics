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

## Aktueller Stand (Etappe 1)

- Ego-Perspektive, steuerbar per Maus+Tastatur ODER Touch (automatische Erkennung)
- Bewegung inkl. Schwerkraft und Sprung
- Kollision mit Wänden und Deckungs-Kisten (per Bisektion bis knapp ans Hindernis heran, kein "Stecken bleiben")
- Arena mit durchdachtem, texturfreiem Farbschema und Schattenwurf

## Geplant (spätere Etappen)

- Waffen/Schießen, Gegner bzw. Ziele
- Multiplayer (Node.js + WebSockets/Socket.io) – bewusst noch nicht Teil dieser Phase
