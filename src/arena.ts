import * as THREE from 'three'
import { Palette } from './palette'

// Diese Datei baut die komplette Spiel-Arena: Boden, Wände und ein paar
// Deckungs-Objekte in der Mitte. Alles ist reine Geometrie mit farbigen
// Materialien - keine Texturdateien nötig.
//
// "solids" sammelt alle Objekte, mit denen der Spieler kollidieren soll
// (also nicht durchlaufen darf). Damit die Kollisionsprüfung in main.ts
// einfach bleibt, speichern wir für jedes Solid eine simple Bounding Box.

export interface Solid {
  mesh: THREE.Object3D
  box: THREE.Box3
}

export interface ArenaResult {
  group: THREE.Group
  solids: Solid[]
  spawnPoint: THREE.Vector3
}

const ARENA_SIZE = 40 // Kantenlänge der quadratischen Arena
const WALL_HEIGHT = 6
const WALL_THICKNESS = 1

export function buildArena(): ArenaResult {
  const group = new THREE.Group()
  const solids: Solid[] = []

  // --- Boden ---
  const groundGeometry = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE)
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: Palette.ground,
    roughness: 0.9,
    metalness: 0.05,
  })
  const ground = new THREE.Mesh(groundGeometry, groundMaterial)
  ground.rotation.x = -Math.PI / 2 // liegend statt stehend ausrichten
  ground.receiveShadow = true
  group.add(ground)

  // --- Ein leichtes Raster auf dem Boden als visuelle Orientierungshilfe ---
  // (dezente Linien, kein Texturbild - nur Geometrie)
  const grid = new THREE.GridHelper(ARENA_SIZE, 20, Palette.accentNeon, 0x2a3a4a)
  ;(grid.material as THREE.Material).transparent = true
  ;(grid.material as THREE.Material).opacity = 0.15
  grid.position.y = 0.01 // knapp über dem Boden, gegen Z-Fighting
  group.add(grid)

  // --- Umgebende Wände (4 Stück, bilden ein Quadrat) ---
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: Palette.wall,
    roughness: 0.8,
    metalness: 0.1,
  })

  const half = ARENA_SIZE / 2
  const wallDefs = [
    // [breite, tiefe, x, z]
    { w: ARENA_SIZE, d: WALL_THICKNESS, x: 0, z: -half },
    { w: ARENA_SIZE, d: WALL_THICKNESS, x: 0, z: half },
    { w: WALL_THICKNESS, d: ARENA_SIZE, x: -half, z: 0 },
    { w: WALL_THICKNESS, d: ARENA_SIZE, x: half, z: 0 },
  ]

  for (const def of wallDefs) {
    const wallGeometry = new THREE.BoxGeometry(def.w, WALL_HEIGHT, def.d)
    const wall = new THREE.Mesh(wallGeometry, wallMaterial)
    wall.position.set(def.x, WALL_HEIGHT / 2, def.z)
    wall.castShadow = true
    wall.receiveShadow = true
    group.add(wall)
    solids.push({ mesh: wall, box: new THREE.Box3().setFromObject(wall) })

    // Dezenter Neon-Streifen oben an jeder Wand - Emissive-Material leuchtet
    // ohne dass eine echte Lichtquelle gebraucht wird. Das ist der "Cyberpunk-Touch".
    const stripeGeometry = new THREE.BoxGeometry(
      def.w * 0.98,
      0.1,
      def.d * 0.98 + (def.d === WALL_THICKNESS ? 0.1 : 0)
    )
    const stripeMaterial = new THREE.MeshStandardMaterial({
      color: Palette.accentNeon,
      emissive: Palette.accentNeon,
      emissiveIntensity: 1.2,
    })
    const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial)
    stripe.position.set(def.x, WALL_HEIGHT - 0.1, def.z)
    group.add(stripe)
  }

  // --- Deckungs-Kisten in der Mitte der Arena (warme Akzentfarbe) ---
  const boxMaterial = new THREE.MeshStandardMaterial({
    color: Palette.accentWarm,
    roughness: 0.6,
    metalness: 0.15,
  })

  const coverPositions: Array<[number, number, number, number]> = [
    // [x, z, breite, höhe]
    [-6, -4, 2.5, 1.5],
    [6, -4, 2.5, 1.5],
    [-6, 4, 2.5, 1.5],
    [6, 4, 2.5, 1.5],
    [0, 0, 3, 2.2],
  ]

  for (const [x, z, size, height] of coverPositions) {
    const boxGeometry = new THREE.BoxGeometry(size, height, size)
    const box = new THREE.Mesh(boxGeometry, boxMaterial)
    box.position.set(x, height / 2, z)
    box.castShadow = true
    box.receiveShadow = true
    group.add(box)
    solids.push({ mesh: box, box: new THREE.Box3().setFromObject(box) })
  }

  return {
    group,
    solids,
    spawnPoint: new THREE.Vector3(0, 1.7, 12), // 1.7 ≈ Augenhöhe eines Menschen
  }
}
