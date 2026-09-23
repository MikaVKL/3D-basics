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
  palette.ts   Zentrale Farbpalette (alle Spielfarben an einem Ort)
  arena.ts     Baut die Spiel-Arena (Boden, Wände, Deckungen)
  player.ts    Kamera-Steuerung, Bewegung, Schwerkraft, Kollision
  main.ts      Einstiegspunkt: Szene, Licht, Game Loop
  style.css    UI (Fadenkreuz, Startbildschirm-Overlay)
```

## Entwicklung starten

```bash
npm install
npm run dev
```

Dann im Browser die angezeigte URL (z.B. http://localhost:5173) öffnen und auf
den Startbildschirm klicken, um die Maussteuerung zu aktivieren.

**Steuerung:**
- `W A S D`: Bewegen
- Maus: Umschauen
- `Leertaste`: Springen
- `ESC`: Maussteuerung freigeben (Menü)

## Aktueller Stand (Etappe 1)

- Ego-Perspektive mit Maussteuerung (Pointer Lock)
- WASD-Bewegung inkl. Schwerkraft und Sprung
- Einfache Kollision mit Wänden und Deckungs-Kisten
- Arena mit durchdachtem, texturfreiem Farbschema und Schattenwurf

## Geplant (spätere Etappen)

- Waffen/Schießen, Gegner bzw. Ziele
- Multiplayer (Node.js + WebSockets/Socket.io) – bewusst noch nicht Teil dieser Phase
