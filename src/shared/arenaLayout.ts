// Maße und Spawn-Punkte, die auch der Server braucht (Aufbau: arena.ts)

export const MAIN_ROOM_WIDTH = 64 // X
export const MAIN_ROOM_DEPTH = 42 // Z
export const SIDE_ROOM_WIDTH = 20 // X
export const SIDE_ROOM_DEPTH = 24 // Z (= Öffnung zum Hauptraum)

// Hauptraum um x=0 zentriert, Flankenraum östlich
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

// y = Augenhöhe
export const SPAWN_POINTS: SpawnPoint[] = [
  { x: -28, y: 1.7, z: -18 },
  { x: -28, y: 1.7, z: 18 },
  { x: 0, y: 1.7, z: -18 },
  { x: 0, y: 1.7, z: 18 },
  { x: ARENA_BOUNDS.maxX - 5, y: 1.7, z: 8 },
]
