// Zentrale Farbpalette für den "Dusk Arena + Neon"-Stil.
//
// Idee dahinter: Boden/Himmel/Wände bekommen kühle, ruhige Farben (Petrol/Blaugrau).
// Alles, was für das Gameplay wichtig ist (Deckungen, Kanten, Lichtquellen), bekommt
// eine warme Akzentfarbe ODER einen dezenten Neon-Glow. Dadurch fällt das Auge
// automatisch auf die relevanten Objekte, statt dass alles gleich aussieht.
//
// Alle Farben sind Hex-Werte, die Three.js direkt versteht (new THREE.Color(...)).

export const Palette = {
  // Himmel / Hintergrund: dunkles, leicht violettes Blau -> Dämmerungsstimmung
  sky: 0x1a1f2e,

  // Boden: kühles Blaugrau (Petrol), etwas heller als der Himmel für Kontrast
  ground: 0x25384a,

  // Wände / Deckungen: gedämpftes Blaugrau, etwas dunkler als der Boden
  wall: 0x2f4356,

  // Haupt-Akzentfarbe (warm): für Kisten, Deckungen, Kanten - das "wichtige" Orange
  accentWarm: 0xff6b3d,

  // Zweite Akzentfarbe (kühles Neon-Cyan): für Lichtkanten / Emissive-Highlights
  accentNeon: 0x33e6cc,

  // Nebel-Farbe: gleich wie der Himmel, damit der Übergang zum Horizont weich ist
  fog: 0x1a1f2e,

  // Ambient-Licht (Grundhelligkeit im Schatten): sehr gedämpftes Blau
  ambientLight: 0x3a4a5e,

  // Hauptlichtquelle (simuliert Mond-/Abendlicht): kühles, leicht bläuliches Weiß
  sunLight: 0xaebfd9,

  // Waffen-/Ausrüstungs-Grau: bewusst deutlich heller als "wall", sonst geht
  // das Waffen-Modell im dunklen Hintergrund optisch fast unter.
  weaponBody: 0x6b7a8c,
} as const
