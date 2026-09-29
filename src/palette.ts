// Farbpalette: kühle Grundtöne, warme Akzente bzw. Neon für Gameplay-Relevantes

export const Palette = {
  sky: 0x1a1f2e,
  // Abendhimmel-Verlauf (sky.ts): über den Wänden sichtbar
  skyHorizon: 0x3a2b46,
  skyTop: 0x0b0f1c,

  ground: 0x25384a,

  wall: 0x2f4356,

  // Warnfarbe/Akzente (nicht mehr die Kisten: zu nah an Team Rot)
  accentWarm: 0xff6b3d,

  // Deckungs-Kisten: Sandbraun, weit weg von Team Rot und Blau
  crate: 0xc9975a,

  // Betonpfeiler: bewusst weder rot noch blau (Teamfarben)
  pillar: 0x5c6f82,

  // Leuchtkanten
  accentNeon: 0x33e6cc,

  // wie der Himmel (weicher Horizont)
  fog: 0x1a1f2e,

  ambientLight: 0x3a4a5e,

  sunLight: 0xaebfd9,

  // heller als "wall", sonst verschwindet die Waffe im dunklen Bild
  weaponBody: 0x6b7a8c,
} as const
