// Arena-Maße und Spawn-Punkte, die auch der Server kennen muss (Spawn-
// Auswahl, Plausibilitätsprüfung von Positionen). Der eigentliche Aufbau
// der Arena mit allen Kisten/Wänden bleibt in arena.ts.

export const MAIN_ROOM_WIDTH = 64 // X-Ausdehnung
export const MAIN_ROOM_DEPTH = 42 // Z-Ausdehnung
export const SIDE_ROOM_WIDTH = 20 // X-Ausdehnung (wie weit er nach außen ragt)
export const SIDE_ROOM_DEPTH = 24 // Z-Ausdehnung (= Breite der Öffnung zum Hauptraum)

// Hauptraum ist um x=0 zentriert, der Flankenraum hängt östlich dran
export const ARENA_BOUNDS = {
  minX: -MAIN_ROOM_WIDTH / 2,
  maxX: MAIN_ROOM_WIDTH / 2 + SIDE_ROOM_WIDTH,
  minZ: -MAIN_ROOM_DEPTH / 2,
  maxZ: MAIN_ROOM_DEPTH / 2,
}

export interface SpawnPoint {
  x: number
  y: number
  z: number
}

// Fünf Punkte, mit Abstand zu Wänden/Kisten und zueinander verteilt -
// vier in den Ecken des Hauptraums, einer tief im (kleineren) Flankenraum,
// damit dieser auch als Spawn-Option genutzt wird. So spawnen Spieler im
// Multiplayer nicht direkt voreinander (Auswahl siehe server/index.ts).
// y = 1.7 ≈ Augenhöhe eines Menschen.
export const SPAWN_POINTS: SpawnPoint[] = [
  { x: -28, y: 1.7, z: -18 },
  { x: -28, y: 1.7, z: 18 },
  { x: 0, y: 1.7, z: -18 },
  { x: 0, y: 1.7, z: 18 },
  { x: ARENA_BOUNDS.maxX - 5, y: 1.7, z: 8 },
]
