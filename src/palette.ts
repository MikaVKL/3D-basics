// Farbpalette: kühle Grundtöne, warme Akzente bzw. Neon für Gameplay-Relevantes

export const Palette = {
  sky: 0x1a1f2e,

  ground: 0x25384a,

  wall: 0x2f4356,

  // Deckungs-Kisten
  accentWarm: 0xff6b3d,

  // Leuchtkanten
  accentNeon: 0x33e6cc,

  // wie der Himmel (weicher Horizont)
  fog: 0x1a1f2e,

  ambientLight: 0x3a4a5e,

  sunLight: 0xaebfd9,

  // heller als "wall", sonst verschwindet die Waffe im dunklen Bild
  weaponBody: 0x6b7a8c,
} as const
