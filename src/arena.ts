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
  // Mehrere Spawn-Punkte statt nur einem: im Singleplayer wird einfach
  // einer davon zufällig gewählt, aber die Liste ist schon jetzt so
  // angelegt, dass später jeder Mitspieler (2-4 im Multiplayer) einen
  // eigenen, weit genug entfernten Punkt bekommen könnte, ohne dass sich
  // mehrere Spieler direkt aufeinander spawnen.
  spawnPoints: THREE.Vector3[]
  // Objekte, auf die geschossen werden kann (für den Raycast der Waffe).
  // Bewusst eine explizite Liste statt "einfach die ganze Gruppe" - sonst
  // würde auch das dünne, dekorative Boden-Raster (GridHelper) versehentlich
  // Treffer registrieren.
  shootables: THREE.Object3D[]
}

// Die Arena ist bewusst NICHT quadratisch/symmetrisch: ein großer
// "Hauptraum" plus ein seitlich angesetzter, schmalerer "Flankenraum" (durch
// eine Öffnung in der Ost-Wand verbunden). Das gibt zwei unterschiedlich
// große Kampfzonen statt vier gespiegelten Ecken - interessanter zum Spielen
// und näher am Krunker.io-Stil als eine reine Box.
const MAIN_ROOM_WIDTH = 44 // X-Ausdehnung
const MAIN_ROOM_DEPTH = 30 // Z-Ausdehnung
const MAIN_HALF_W = MAIN_ROOM_WIDTH / 2
const MAIN_HALF_D = MAIN_ROOM_DEPTH / 2

const SIDE_ROOM_WIDTH = 12 // X-Ausdehnung (wie weit er nach außen ragt)
const SIDE_ROOM_DEPTH = 16 // Z-Ausdehnung (= Breite der Öffnung zum Hauptraum)
const SIDE_HALF_D = SIDE_ROOM_DEPTH / 2

const WALL_HEIGHT = 6
const WALL_THICKNESS = 1

export function buildArena(): ArenaResult {
  const group = new THREE.Group()
  const solids: Solid[] = []

  // --- Boden: zwei Flächen, eine pro Raum (der Flankenraum ist schmaler) ---
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: Palette.ground,
    roughness: 0.9,
    metalness: 0.05,
  })

  const mainGround = new THREE.Mesh(
    new THREE.PlaneGeometry(MAIN_ROOM_WIDTH, MAIN_ROOM_DEPTH),
    groundMaterial
  )
  mainGround.rotation.x = -Math.PI / 2 // liegend statt stehend ausrichten
  group.add(mainGround)

  const sideGround = new THREE.Mesh(
    new THREE.PlaneGeometry(SIDE_ROOM_WIDTH, SIDE_ROOM_DEPTH),
    groundMaterial
  )
  sideGround.rotation.x = -Math.PI / 2
  sideGround.position.set(MAIN_HALF_W + SIDE_ROOM_WIDTH / 2, 0, 0)
  group.add(sideGround)

  // --- Leichtes Raster auf beiden Böden als Orientierungshilfe ---
  // (dezente Linien, kein Texturbild - nur Geometrie). GridHelper ist immer
  // quadratisch, daher wird per scale auf das jeweilige Rechteck gestreckt.
  const mainGrid = new THREE.GridHelper(MAIN_ROOM_WIDTH, 22, Palette.accentNeon, 0x2a3a4a)
  mainGrid.scale.z = MAIN_ROOM_DEPTH / MAIN_ROOM_WIDTH
  ;(mainGrid.material as THREE.Material).transparent = true
  ;(mainGrid.material as THREE.Material).opacity = 0.15
  mainGrid.position.y = 0.01 // knapp über dem Boden, gegen Z-Fighting
  group.add(mainGrid)

  const sideGrid = new THREE.GridHelper(SIDE_ROOM_DEPTH, 8, Palette.accentNeon, 0x2a3a4a)
  sideGrid.scale.x = SIDE_ROOM_WIDTH / SIDE_ROOM_DEPTH
  ;(sideGrid.material as THREE.Material).transparent = true
  ;(sideGrid.material as THREE.Material).opacity = 0.15
  sideGrid.position.set(MAIN_HALF_W + SIDE_ROOM_WIDTH / 2, 0.01, 0)
  group.add(sideGrid)

  // --- Umgebende Wände ---
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: Palette.wall,
    roughness: 0.8,
    metalness: 0.1,
  })

  const sideRoomMinX = MAIN_HALF_W
  const sideRoomMaxX = MAIN_HALF_W + SIDE_ROOM_WIDTH
  const sideRoomCenterX = (sideRoomMinX + sideRoomMaxX) / 2

  const wallDefs = [
    // [breite, tiefe, x, z] - Hauptraum (Süd/Nord/West komplett, Ost mit
    // Lücke in der Mitte für den Durchgang zum Flankenraum)
    { w: MAIN_ROOM_WIDTH, d: WALL_THICKNESS, x: 0, z: -MAIN_HALF_D },
    { w: MAIN_ROOM_WIDTH, d: WALL_THICKNESS, x: 0, z: MAIN_HALF_D },
    { w: WALL_THICKNESS, d: MAIN_ROOM_DEPTH, x: -MAIN_HALF_W, z: 0 },
    {
      w: WALL_THICKNESS,
      d: MAIN_HALF_D - SIDE_HALF_D,
      x: MAIN_HALF_W,
      z: (MAIN_HALF_D + SIDE_HALF_D) / 2,
    },
    {
      w: WALL_THICKNESS,
      d: MAIN_HALF_D - SIDE_HALF_D,
      x: MAIN_HALF_W,
      z: -(MAIN_HALF_D + SIDE_HALF_D) / 2,
    },
    // Flankenraum (Nord/Süd/Ost - West ist die offene Verbindung zum Hauptraum)
    { w: SIDE_ROOM_WIDTH, d: WALL_THICKNESS, x: sideRoomCenterX, z: SIDE_HALF_D },
    { w: SIDE_ROOM_WIDTH, d: WALL_THICKNESS, x: sideRoomCenterX, z: -SIDE_HALF_D },
    { w: WALL_THICKNESS, d: SIDE_ROOM_DEPTH, x: sideRoomMaxX, z: 0 },
  ]

  for (const def of wallDefs) {
    const wallGeometry = new THREE.BoxGeometry(def.w, WALL_HEIGHT, def.d)
    const wall = new THREE.Mesh(wallGeometry, wallMaterial)
    wall.position.set(def.x, WALL_HEIGHT / 2, def.z)
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

  // --- Deckungs-Kisten (warme Akzentfarbe) ---
  const boxMaterial = new THREE.MeshStandardMaterial({
    color: Palette.accentWarm,
    roughness: 0.6,
    metalness: 0.15,
  })

  // Bewusst UNGLEICHMÄSSIG verteilt (anders große Kisten, kein gespiegeltes
  // Muster) statt der bisherigen vier symmetrischen Ecken - passend zur
  // asymmetrischen Raumform. Höhe bleibt bei max. 1.4m, damit man mit dem
  // aktuellen Sprung (~1.6m) noch draufspringen kann.
  const coverPositions: Array<[number, number, number, number]> = [
    // [x, z, breite, höhe] - Hauptraum
    [-14, -8, 3, 1.4],
    [-12, 7, 2.2, 1.4],
    [3, -9, 2.6, 1.4],
    [4, 9, 3.4, 1.4],
    [-2, 0, 4, 1.4],
    // Flankenraum - kleiner Raum, daher nur eine Kiste nahe dem Eingang
    [24, -4, 2.2, 1.4],
  ]

  for (const [x, z, size, height] of coverPositions) {
    const boxGeometry = new THREE.BoxGeometry(size, height, size)
    const box = new THREE.Mesh(boxGeometry, boxMaterial)
    box.position.set(x, height / 2, z)
    group.add(box)
    solids.push({ mesh: box, box: new THREE.Box3().setFromObject(box) })
  }

  // Fünf Punkte, mit Abstand zu Wänden/Kisten und zueinander verteilt -
  // vier in den Ecken des Hauptraums, einer tief im (kleineren) Flankenraum,
  // damit dieser auch als Spawn-Option genutzt wird. So würden sich 2-4
  // Spieler im Multiplayer nicht direkt ins Gesicht spawnen.
  // 1.7 ≈ Augenhöhe eines Menschen.
  const spawnPoints = [
    new THREE.Vector3(-18, 1.7, -12),
    new THREE.Vector3(-18, 1.7, 12),
    new THREE.Vector3(0, 1.7, -12),
    new THREE.Vector3(0, 1.7, 12),
    new THREE.Vector3(sideRoomMaxX - 4, 1.7, 4),
  ]

  return {
    group,
    solids,
    spawnPoints,
    shootables: [mainGround, sideGround, ...solids.map((s) => s.mesh)],
  }
}
