import * as THREE from 'three'
import { Palette } from './palette'
import {
  MAIN_ROOM_WIDTH,
  MAIN_ROOM_DEPTH,
  SIDE_ROOM_WIDTH,
  SIDE_ROOM_DEPTH,
  SPAWN_POINTS,
} from './shared/arenaLayout'

// Baut die Arena aus reiner Geometrie (keine Texturen). "solids" sind alle
// Objekte mit Kollision, jeweils mit fertiger Bounding Box.

export interface Solid {
  mesh: THREE.Object3D
  box: THREE.Box3
}

// Begehbare Schräge: blockiert nicht, sondern liefert eine Stand-Höhe
// (siehe player.ts). "ascending": Höhe steigt mit der Koordinate entlang "axis".
export interface Ramp {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  axis: 'x' | 'z'
  ascending: boolean
  bottomHeight: number
  topHeight: number
}

export function rampHeightAt(ramp: Ramp, x: number, z: number): number | null {
  if (x < ramp.minX || x > ramp.maxX || z < ramp.minZ || z > ramp.maxZ) return null

  const range = ramp.axis === 'x' ? ramp.maxX - ramp.minX : ramp.maxZ - ramp.minZ
  const coordinate = ramp.axis === 'x' ? x : z
  const start = ramp.axis === 'x' ? ramp.minX : ramp.minZ

  let t = (coordinate - start) / range
  if (!ramp.ascending) t = 1 - t

  return ramp.bottomHeight + t * (ramp.topHeight - ramp.bottomHeight)
}

export interface ArenaResult {
  group: THREE.Group
  solids: Solid[]
  spawnPoints: THREE.Vector3[]
  ramps: Ramp[]
  // Explizite Liste für den Waffen-Raycast - sonst würde auch das
  // Boden-Raster Treffer abfangen
  shootables: THREE.Object3D[]
}

// Bewusst asymmetrisch: Hauptraum plus schmalerer Flankenraum im Osten.
const MAIN_HALF_W = MAIN_ROOM_WIDTH / 2
const MAIN_HALF_D = MAIN_ROOM_DEPTH / 2

const SIDE_HALF_D = SIDE_ROOM_DEPTH / 2

const WALL_HEIGHT = 6
const WALL_THICKNESS = 1

// Keil für die Rampen-Optik, steigt entlang +X von 0 auf height. Vertices pro
// Fläche dupliziert, damit jede Fläche eine flache Normale bekommt (Low-Poly-Look).
function createWedgeGeometry(length: number, width: number, height: number): THREE.BufferGeometry {
  const halfWidth = width / 2

  const low0 = [0, 0, -halfWidth]
  const low1 = [0, 0, halfWidth]
  const bottomFar0 = [length, 0, -halfWidth]
  const bottomFar1 = [length, 0, halfWidth]
  const topFar0 = [length, height, -halfWidth]
  const topFar1 = [length, height, halfWidth]

  const quad = (a: number[], b: number[], c: number[], d: number[]) => [
    ...a, ...b, ...c,
    ...a, ...c, ...d,
  ]
  const triangle = (a: number[], b: number[], c: number[]) => [...a, ...b, ...c]

  const positions = [
    ...quad(low0, bottomFar0, bottomFar1, low1), // Boden (Normale nach unten)
    ...quad(bottomFar0, topFar0, topFar1, bottomFar1), // senkrechte Rückseite
    ...quad(low0, low1, topFar1, topFar0), // die Schräge selbst (Normale schräg nach oben)
    ...triangle(low0, topFar0, bottomFar0), // Seitendreieck links
    ...triangle(low1, bottomFar1, topFar1), // Seitendreieck rechts
  ]

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

// Leuchtende Kanten, damit Formen im Dämmerlicht erkennbar bleiben
function addEdgeOutline(mesh: THREE.Mesh, color: number = Palette.accentNeon) {
  const edges = new THREE.EdgesGeometry(mesh.geometry)
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })
  )
  mesh.add(line)
}

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

  // --- Raster auf den Böden (GridHelper ist quadratisch -> per scale gestreckt) ---
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

  // Innere Trennwand (West-Zone | Hauptraum) mit ebenerdigem Durchgang und
  // einem erhöhten Einweg-Durchgang auf Höhe der West-Plattform (vom Boden
  // aus zu hoch). Plattform und Wand liegen ohne Spalt aneinander -
  // Spalte sind Stecken-Fallen.
  const DIVIDER_X = -20
  const DIVIDER_SOLID_SOUTH_Z_MAX = -11
  const DIVIDER_GAP_Z_MAX = -3 // Durchgang: von SOLID_SOUTH_Z_MAX bis hier
  const dividerSouthDepth = DIVIDER_SOLID_SOUTH_Z_MAX - -MAIN_HALF_D

  const WEST_PLATFORM_CENTER_X = -23
  const WEST_PLATFORM_CENTER_Z = 14
  const WEST_PLATFORM_SIZE = 5
  const WEST_PLATFORM_HEIGHT = 2.4
  const DOORWAY_Z_MIN = WEST_PLATFORM_CENTER_Z - WEST_PLATFORM_SIZE / 2
  const DOORWAY_Z_MAX = WEST_PLATFORM_CENTER_Z + WEST_PLATFORM_SIZE / 2
  const DOORWAY_HEIGHT = 2.2 // Kopffreiheit im Durchgang
  const DOORWAY_TOP = WEST_PLATFORM_HEIGHT + DOORWAY_HEIGHT

  const dividerNorthLowerDepth = DOORWAY_Z_MIN - DIVIDER_GAP_Z_MAX
  const dividerNorthUpperDepth = MAIN_HALF_D - DOORWAY_Z_MAX

  const wallDefs = [
    // Hauptraum (Ost-Wand mit Öffnung zum Flankenraum)
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
    // Flankenraum
    { w: SIDE_ROOM_WIDTH, d: WALL_THICKNESS, x: sideRoomCenterX, z: SIDE_HALF_D },
    { w: SIDE_ROOM_WIDTH, d: WALL_THICKNESS, x: sideRoomCenterX, z: -SIDE_HALF_D },
    { w: WALL_THICKNESS, d: SIDE_ROOM_DEPTH, x: sideRoomMaxX, z: 0 },
    // Trennwand: Süd-Abschnitt, Nord-Abschnitte vor und nach dem erhöhten Durchgang
    { w: WALL_THICKNESS, d: dividerSouthDepth, x: DIVIDER_X, z: -MAIN_HALF_D + dividerSouthDepth / 2 },
    {
      w: WALL_THICKNESS,
      d: dividerNorthLowerDepth,
      x: DIVIDER_X,
      z: DIVIDER_GAP_Z_MAX + dividerNorthLowerDepth / 2,
    },
    {
      w: WALL_THICKNESS,
      d: dividerNorthUpperDepth,
      x: DIVIDER_X,
      z: DOORWAY_Z_MAX + dividerNorthUpperDepth / 2,
    },
  ]

  for (const def of wallDefs) {
    const wallGeometry = new THREE.BoxGeometry(def.w, WALL_HEIGHT, def.d)
    const wall = new THREE.Mesh(wallGeometry, wallMaterial)
    wall.position.set(def.x, WALL_HEIGHT / 2, def.z)
    addEdgeOutline(wall)
    group.add(wall)
    solids.push({ mesh: wall, box: new THREE.Box3().setFromObject(wall) })

    // Leuchtender Neon-Streifen oben (emissive, ohne echte Lichtquelle)
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

  // --- Erhöhter Durchgang: Sockel bis Plattformhöhe, darüber die Öffnung, dann Sturz ---
  const doorwaySillMesh = new THREE.Mesh(
    new THREE.BoxGeometry(WALL_THICKNESS, WEST_PLATFORM_HEIGHT, DOORWAY_Z_MAX - DOORWAY_Z_MIN),
    wallMaterial
  )
  doorwaySillMesh.position.set(DIVIDER_X, WEST_PLATFORM_HEIGHT / 2, WEST_PLATFORM_CENTER_Z)
  addEdgeOutline(doorwaySillMesh)
  group.add(doorwaySillMesh)
  solids.push({ mesh: doorwaySillMesh, box: new THREE.Box3().setFromObject(doorwaySillMesh) })

  const doorwayLintelHeight = WALL_HEIGHT - DOORWAY_TOP
  const doorwayLintelMesh = new THREE.Mesh(
    new THREE.BoxGeometry(WALL_THICKNESS, doorwayLintelHeight, DOORWAY_Z_MAX - DOORWAY_Z_MIN),
    wallMaterial
  )
  doorwayLintelMesh.position.set(DIVIDER_X, DOORWAY_TOP + doorwayLintelHeight / 2, WEST_PLATFORM_CENTER_Z)
  addEdgeOutline(doorwayLintelMesh)
  group.add(doorwayLintelMesh)
  solids.push({ mesh: doorwayLintelMesh, box: new THREE.Box3().setFromObject(doorwayLintelMesh) })

  // --- Freistehende Wand mit Fenster (Pfosten, Sockel, Sturz) ---
  function buildWindowWall(centerX: number, centerZ: number, totalWidth: number, windowWidth: number) {
    const THICKNESS = 0.4
    const SILL_HEIGHT = 1.1
    // Per Duck-Sprung durchkletterbar (gewollt): etwas höher als der geduckte
    // Körper (1.3m), stehend (2.0m) passt man nicht durch
    const OPENING_HEIGHT = 1.4
    const WALL_TOP = SILL_HEIGHT + OPENING_HEIGHT + 1.1 // Sturz-Oberkante = Gesamthöhe der Wand
    const sidePostWidth = (totalWidth - windowWidth) / 2

    function addPiece(offsetX: number, width: number, bottomY: number, topY: number) {
      const height = topY - bottomY
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, THICKNESS), wallMaterial)
      mesh.position.set(centerX + offsetX, bottomY + height / 2, centerZ)
      addEdgeOutline(mesh)
      group.add(mesh)
      solids.push({ mesh, box: new THREE.Box3().setFromObject(mesh) })
    }

    addPiece(-(windowWidth + sidePostWidth) / 2, sidePostWidth, 0, WALL_TOP)
    addPiece((windowWidth + sidePostWidth) / 2, sidePostWidth, 0, WALL_TOP)

    addPiece(0, windowWidth, 0, SILL_HEIGHT)
    addPiece(0, windowWidth, SILL_HEIGHT + OPENING_HEIGHT, WALL_TOP)
  }

  buildWindowWall(9, -15, 8, 3.5)

  // --- L-förmige Deckung (Deckung aus zwei Richtungen) ---
  function buildLCover(
    cornerX: number,
    cornerZ: number,
    armLength: number,
    thickness: number,
    height: number,
    armXDir: 1 | -1,
    armZDir: 1 | -1
  ) {
    const armAlongX = new THREE.Mesh(
      new THREE.BoxGeometry(armLength, height, thickness),
      boxMaterial
    )
    armAlongX.position.set(
      cornerX + (armXDir * armLength) / 2,
      height / 2,
      cornerZ + (armZDir * thickness) / 2
    )
    addEdgeOutline(armAlongX)
    group.add(armAlongX)
    solids.push({ mesh: armAlongX, box: new THREE.Box3().setFromObject(armAlongX) })

    const armAlongZ = new THREE.Mesh(
      new THREE.BoxGeometry(thickness, height, armLength),
      boxMaterial
    )
    armAlongZ.position.set(
      cornerX + (armXDir * thickness) / 2,
      height / 2,
      cornerZ + (armZDir * armLength) / 2
    )
    addEdgeOutline(armAlongZ)
    group.add(armAlongZ)
    solids.push({ mesh: armAlongZ, box: new THREE.Box3().setFromObject(armAlongZ) })
  }

  // --- Deckungs-Kisten (warme Akzentfarbe) ---
  const boxMaterial = new THREE.MeshStandardMaterial({
    color: Palette.accentWarm,
    roughness: 0.6,
    metalness: 0.15,
  })

  // Höhen: 1.4m = Deckung nur im Ducken, erkletterbar (Sprunghöhe ~1.6m);
  // 2.4m = volle Deckung; 2.8m = sichtbar "Wand, nicht kletterbar".
  const coverPositions: Array<[number, number, number, number, number]> = [
    // [x, z, breite (X), tiefe (Z), höhe] - Hauptraum
    [-14, -8, 3, 3, 2.4],
    [-12, 7, 4, 1.5, 1.4],
    [3, -9, 2.6, 2.6, 2.4],
    [4, 9, 5, 2, 1.4],
    [-2, 0, 4, 4, 2.4],
    [24, -16, 1.5, 4, 1.4],
    [22, 16, 2.6, 2.6, 2.8],
    // West-Zone
    [-28, -9, 4.5, 1.8, 2.4],
    [-27, 8, 3, 3, 2.8],
    [-24, -16, 3, 2, 2.4],
    [15, -8, 2, 2, 1.4],
    // Flankenraum
    [sideRoomMinX + 6, -5, 2.4, 2.4, 2.4],
    [sideRoomMinX + 13, 7, 2, 4.5, 2.8],
    [44, -8, 2.2, 2.2, 1.4],
  ]

  for (const [x, z, width, depth, height] of coverPositions) {
    const boxGeometry = new THREE.BoxGeometry(width, height, depth)
    const box = new THREE.Mesh(boxGeometry, boxMaterial)
    box.position.set(x, height / 2, z)
    addEdgeOutline(box)
    group.add(box)
    solids.push({ mesh: box, box: new THREE.Box3().setFromObject(box) })
  }

  // 1.4m: zuverlässig erkletterbar (1.6m lag genau an der Sprunghöhe)
  buildLCover(-6, -16, 4, 0.8, 1.4, 1, 1)
  buildLCover(sideRoomMinX + 2, -7, 4, 0.8, 1.4, 1, -1)
  buildLCover(9, 16, 3, 0.7, 1.4, 1, -1)
  buildLCover(50, 2, 3, 0.7, 1.4, -1, -1)

  // --- Erhöhte Plattformen mit Rampe (Wandfarbe = Struktur, nicht Deckung) ---
  // Rampen flach halten (Steigung ~0.3): bei steiler Rampe stößt die
  // Kollisionsbox schon an die Plattformkante, bevor die Rampe hoch genug ist.
  function buildPlatformWithRamp(
    centerX: number,
    centerZ: number,
    platformSize: number,
    platformHeight: number,
    rampLength: number,
    rampWidth: number,
    rampAxis: 'x' | 'z',
    rampAscending: boolean,
    // lateralOffset: Rampe quer verschieben; omitCurbSide: Bord weglassen, wo eine Wand steht
    options: { lateralOffset?: number; omitCurbSide?: -1 | 1 } = {}
  ): Ramp {
    const lateralOffset = options.lateralOffset ?? 0
    const rampCenterX = rampAxis === 'z' ? centerX + lateralOffset : centerX
    const rampCenterZ = rampAxis === 'x' ? centerZ + lateralOffset : centerZ
    const platformGeometry = new THREE.BoxGeometry(platformSize, platformHeight, platformSize)
    const platform = new THREE.Mesh(platformGeometry, wallMaterial)
    platform.position.set(centerX, platformHeight / 2, centerZ)
    addEdgeOutline(platform)
    group.add(platform)
    solids.push({ mesh: platform, box: new THREE.Box3().setFromObject(platform) })

    const platformHalf = platformSize / 2
    // Rampe endet exakt an der Plattformkante (nahtloser Übergang)
    const edgeAtPlatform = rampAscending
      ? (rampAxis === 'x' ? centerX : centerZ) - platformHalf
      : (rampAxis === 'x' ? centerX : centerZ) + platformHalf
    const rampStart = rampAscending ? edgeAtPlatform - rampLength : edgeAtPlatform + rampLength
    const rampMin = Math.min(edgeAtPlatform, rampStart)
    const rampMax = Math.max(edgeAtPlatform, rampStart)

    const ramp: Ramp = {
      minX: rampAxis === 'x' ? rampMin : rampCenterX - rampWidth / 2,
      maxX: rampAxis === 'x' ? rampMax : rampCenterX + rampWidth / 2,
      minZ: rampAxis === 'z' ? rampMin : rampCenterZ - rampWidth / 2,
      maxZ: rampAxis === 'z' ? rampMax : rampCenterZ + rampWidth / 2,
      axis: rampAxis,
      ascending: rampAscending,
      bottomHeight: 0,
      topHeight: platformHeight,
    }

    // Keil steigt lokal entlang +X - für Z-Rampen um 90° gedreht
    const rampMesh = new THREE.Mesh(
      createWedgeGeometry(rampLength, rampWidth, platformHeight),
      wallMaterial
    )
    if (rampAxis === 'x') {
      rampMesh.position.set(rampAscending ? rampMin : rampMax, 0, rampCenterZ)
      if (!rampAscending) rampMesh.rotation.y = Math.PI
    } else {
      rampMesh.rotation.y = rampAscending ? -Math.PI / 2 : Math.PI / 2
      rampMesh.position.set(rampCenterX, 0, rampAscending ? rampMin : rampMax)
    }
    addEdgeOutline(rampMesh)
    group.add(rampMesh)
    shootableExtras.push(rampMesh)

    // Seitenborde: Rampe nur von vorne betretbar (seitlich würde man
    // schlagartig auf Rampenhöhe gehoben). Komplett außerhalb der
    // Rampenbreite und exakt plattformhoch - sonst entstehen Klemmstellen.
    const curbHeight = platformHeight
    const curbThickness = 0.2
    const curbMid = (rampMin + rampMax) / 2
    const curbLength = rampMax - rampMin
    for (const side of [-1, 1] as const) {
      if (side === options.omitCurbSide) continue
      const curbGeometry =
        rampAxis === 'x'
          ? new THREE.BoxGeometry(curbLength, curbHeight, curbThickness)
          : new THREE.BoxGeometry(curbThickness, curbHeight, curbLength)
      const curb = new THREE.Mesh(curbGeometry, wallMaterial)
      const outwardOffset = rampWidth / 2 + curbThickness / 2
      if (rampAxis === 'x') {
        curb.position.set(curbMid, curbHeight / 2, rampCenterZ + side * outwardOffset)
      } else {
        curb.position.set(rampCenterX + side * outwardOffset, curbHeight / 2, curbMid)
      }
      addEdgeOutline(curb)
      group.add(curb)
      solids.push({ mesh: curb, box: new THREE.Box3().setFromObject(curb) })
    }

    return ramp
  }

  const shootableExtras: THREE.Object3D[] = []

  const rampToMainPlatform = buildPlatformWithRamp(15, 0, 6, 2.8, 10, 4, 'x', true)

  // West-Plattform (Rampe B): Plattform und Rampe liegen bündig an der
  // Trennwand (kein körperbreiter Spalt), die Wand ersetzt dort das Bord.
  // Oben mündet sie in den erhöhten Durchgang.
  const WEST_RAMP_WIDTH = 3
  const westPlatformEastEdge = WEST_PLATFORM_CENTER_X + WEST_PLATFORM_SIZE / 2
  const rampToWestPlatform = buildPlatformWithRamp(
    WEST_PLATFORM_CENTER_X,
    WEST_PLATFORM_CENTER_Z,
    WEST_PLATFORM_SIZE,
    WEST_PLATFORM_HEIGHT,
    8,
    WEST_RAMP_WIDTH,
    'z',
    true,
    {
      lateralOffset: westPlatformEastEdge - WEST_RAMP_WIDTH / 2 - WEST_PLATFORM_CENTER_X,
      omitCurbSide: 1,
    }
  )

  const spawnPoints = SPAWN_POINTS.map((p) => new THREE.Vector3(p.x, p.y, p.z))

  return {
    group,
    solids,
    spawnPoints,
    ramps: [rampToMainPlatform, rampToWestPlatform],
    shootables: [mainGround, sideGround, ...shootableExtras, ...solids.map((s) => s.mesh)],
  }
}
