// Maße und Spawn-Punkte der Karte "Nexus", die auch der Server braucht (Aufbau: arena.ts)

// Quadratische Arena um (0, 0); die Außenwände stehen auf ±ARENA_HALF
export const ARENA_HALF = 28

export const ARENA_BOUNDS = {
  minX: -ARENA_HALF,
  maxX: ARENA_HALF,
  minZ: -ARENA_HALF,
  maxZ: ARENA_HALF,
}

export interface SpawnPoint {
  x: number
  y: number
  z: number
}

// y = Augenhöhe. Punktsymmetrisch: je zwei Spawns pro Seite, zwischen Laufsteg-Rampen und Eck-Bunkern
export const SPAWN_POINTS: SpawnPoint[] = [
  { x: -21.5, y: 1.7, z: -7 },
  { x: -21.5, y: 1.7, z: 7 },
  { x: 21.5, y: 1.7, z: -7 },
  { x: 21.5, y: 1.7, z: 7 },
  { x: -7, y: 1.7, z: -21.5 },
  { x: 7, y: 1.7, z: -21.5 },
  { x: -7, y: 1.7, z: 21.5 },
  { x: 7, y: 1.7, z: 21.5 },
]
