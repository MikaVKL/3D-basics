import * as THREE from 'three'
import { Palette } from './palette'
import { createCrateTexture, createPanelTexture, worldBox, CRATE_TILE, PANEL_TILE } from './surfaceTextures'
import { addWallLamps, addLabel } from './decorations'
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
  // Für die Minimap: Außen-/Trennwand, Deckungskiste; ohne Angabe = Struktur
  // (Plattform, Steg, Säule ...) - neue Teile erscheinen so von selbst
  kind?: 'wall' | 'cover'
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

  // Texturkoordinaten in Feldern (wie worldBox): Boden/Schräge aus x/z,
  // Rückseite aus z/y, Seitendreiecke aus x/y
  const uvs: number[] = []
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]]
    const vertex = i / 3
    if (vertex < 6 || (vertex >= 12 && vertex < 18)) uvs.push(x / PANEL_TILE, z / PANEL_TILE)
    else if (vertex < 12) uvs.push(z / PANEL_TILE, y / PANEL_TILE)
    else uvs.push(x / PANEL_TILE, y / PANEL_TILE)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
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

  // Nordost-Halle: nördlich des Flankenraums (Bereich zwischen Hauptraum-Ostwand
  // und Flankenraum-Ostwand), über eine Öffnung in dessen Nordwand erreichbar
  const HALL_MIN_Z = -MAIN_HALF_D
  const HALL_MAX_Z = -SIDE_HALF_D
  const HALL_DOOR_X: [number, number] = [38, 46] // Öffnung in der Flankenraum-Nordwand
  const hallGround = new THREE.Mesh(new THREE.PlaneGeometry(SIDE_ROOM_WIDTH, HALL_MAX_Z - HALL_MIN_Z), groundMaterial)
  hallGround.rotation.x = -Math.PI / 2
  hallGround.position.set(MAIN_HALF_W + SIDE_ROOM_WIDTH / 2, 0, (HALL_MIN_Z + HALL_MAX_Z) / 2)
  group.add(hallGround)

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

  const hallGrid = new THREE.GridHelper(SIDE_ROOM_WIDTH, 8, Palette.accentNeon, 0x2a3a4a)
  hallGrid.scale.z = (HALL_MAX_Z - HALL_MIN_Z) / SIDE_ROOM_WIDTH
  ;(hallGrid.material as THREE.Material).transparent = true
  ;(hallGrid.material as THREE.Material).opacity = 0.15
  hallGrid.position.set(MAIN_HALF_W + SIDE_ROOM_WIDTH / 2, 0.01, (HALL_MIN_Z + HALL_MAX_Z) / 2)
  group.add(hallGrid)

  // --- Umgebende Wände ---
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: Palette.wall,
    map: createPanelTexture(),
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
  // Tunnel unter dem Nordsteg geht durch die Trennwand in die West-Zone (vorher
  // Sackgasse): Öffnung z -20,5..-17,5, Höhe wie die Stegunterkante
  const DIVIDER_TUNNEL_Z_MIN = -MAIN_HALF_D + WALL_THICKNESS / 2
  const DIVIDER_TUNNEL_Z_MAX = -17.5
  const TUNNEL_HEIGHT = 2.5
  const dividerSouthDepth = DIVIDER_SOLID_SOUTH_Z_MAX - DIVIDER_TUNNEL_Z_MAX

  const WEST_PLATFORM_CENTER_X = -23
  const WEST_PLATFORM_CENTER_Z = 14
  const WEST_PLATFORM_SIZE = 5
  const WEST_PLATFORM_HEIGHT = 2.8 // = obere Ebene: der Durchgang führt über die Verbindung zum Südsteg
  const DOORWAY_Z_MIN = WEST_PLATFORM_CENTER_Z - WEST_PLATFORM_SIZE / 2
  const DOORWAY_Z_MAX = WEST_PLATFORM_CENTER_Z + WEST_PLATFORM_SIZE / 2
  const DOORWAY_HEIGHT = 2.2 // Kopffreiheit im Durchgang
  const DOORWAY_TOP = WEST_PLATFORM_HEIGHT + DOORWAY_HEIGHT

  const dividerNorthLowerDepth = DOORWAY_Z_MIN - DIVIDER_GAP_Z_MAX
  const dividerNorthUpperDepth = MAIN_HALF_D - DOORWAY_Z_MAX

  const wallDefs: Array<{ w: number; d: number; x: number; z: number; bottom?: number }> = [
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
    // Ostwand nördlich der Öffnung: Durchgang für den Regal-Steg (z -20,5..-17,5, siehe unten)
    { w: WALL_THICKNESS, d: 5.5, x: MAIN_HALF_W, z: -SIDE_HALF_D - 5.5 / 2 },
    { w: WALL_THICKNESS, d: 0.5, x: MAIN_HALF_W, z: -MAIN_HALF_D + 0.25 },
    // Flankenraum
    { w: SIDE_ROOM_WIDTH, d: WALL_THICKNESS, x: sideRoomCenterX, z: SIDE_HALF_D },
    // Nordwand des Flankenraums mit Öffnung zur Halle
    { w: HALL_DOOR_X[0] - sideRoomMinX, d: WALL_THICKNESS, x: (sideRoomMinX + HALL_DOOR_X[0]) / 2, z: -SIDE_HALF_D },
    { w: sideRoomMaxX - HALL_DOOR_X[1], d: WALL_THICKNESS, x: (HALL_DOOR_X[1] + sideRoomMaxX) / 2, z: -SIDE_HALF_D },
    { w: WALL_THICKNESS, d: SIDE_ROOM_DEPTH, x: sideRoomMaxX, z: 0 },
    // Halle: Nord- und Ostwand (West = Hauptraum-Ostwand)
    { w: SIDE_ROOM_WIDTH, d: WALL_THICKNESS, x: sideRoomCenterX, z: HALL_MIN_Z },
    { w: WALL_THICKNESS, d: HALL_MAX_Z - HALL_MIN_Z + WALL_THICKNESS / 2, x: sideRoomMaxX, z: (HALL_MIN_Z + HALL_MAX_Z) / 2 - WALL_THICKNESS / 4 },
    // Trennwand: Süd-Abschnitt, Nord-Abschnitte vor und nach dem erhöhten Durchgang
    { w: WALL_THICKNESS, d: dividerSouthDepth, x: DIVIDER_X, z: DIVIDER_TUNNEL_Z_MAX + dividerSouthDepth / 2 },
    // Sturz über dem Tunnel-Durchgang
    {
      w: WALL_THICKNESS,
      d: DIVIDER_TUNNEL_Z_MAX - DIVIDER_TUNNEL_Z_MIN,
      x: DIVIDER_X,
      z: (DIVIDER_TUNNEL_Z_MIN + DIVIDER_TUNNEL_Z_MAX) / 2,
      bottom: TUNNEL_HEIGHT,
    },
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
    const wallBottom = def.bottom ?? 0
    const wallGeometry = worldBox(def.w, WALL_HEIGHT - wallBottom, def.d)
    const wall = new THREE.Mesh(wallGeometry, wallMaterial)
    wall.position.set(def.x, wallBottom + (WALL_HEIGHT - wallBottom) / 2, def.z)
    addEdgeOutline(wall)
    group.add(wall)
    solids.push({ mesh: wall, box: new THREE.Box3().setFromObject(wall), kind: 'wall' })

    // Leuchtender Neon-Streifen oben (emissive, ohne echte Lichtquelle)
    const stripeGeometry = worldBox(
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
    worldBox(WALL_THICKNESS, WEST_PLATFORM_HEIGHT, DOORWAY_Z_MAX - DOORWAY_Z_MIN),
    wallMaterial
  )
  doorwaySillMesh.position.set(DIVIDER_X, WEST_PLATFORM_HEIGHT / 2, WEST_PLATFORM_CENTER_Z)
  addEdgeOutline(doorwaySillMesh)
  group.add(doorwaySillMesh)
  solids.push({ mesh: doorwaySillMesh, box: new THREE.Box3().setFromObject(doorwaySillMesh), kind: 'wall' })

  const doorwayLintelHeight = WALL_HEIGHT - DOORWAY_TOP
  const doorwayLintelMesh = new THREE.Mesh(
    worldBox(WALL_THICKNESS, doorwayLintelHeight, DOORWAY_Z_MAX - DOORWAY_Z_MIN),
    wallMaterial
  )
  doorwayLintelMesh.position.set(DIVIDER_X, DOORWAY_TOP + doorwayLintelHeight / 2, WEST_PLATFORM_CENTER_Z)
  addEdgeOutline(doorwayLintelMesh)
  group.add(doorwayLintelMesh)
  solids.push({ mesh: doorwayLintelMesh, box: new THREE.Box3().setFromObject(doorwayLintelMesh), kind: 'wall' })

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
      const mesh = new THREE.Mesh(worldBox(width, height, THICKNESS), wallMaterial)
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
      worldBox(armLength, height, thickness),
      boxMaterial
    )
    armAlongX.position.set(
      cornerX + (armXDir * armLength) / 2,
      height / 2,
      cornerZ + (armZDir * thickness) / 2
    )
    addEdgeOutline(armAlongX)
    group.add(armAlongX)
    solids.push({ mesh: armAlongX, box: new THREE.Box3().setFromObject(armAlongX), kind: 'cover' })

    const armAlongZ = new THREE.Mesh(
      worldBox(thickness, height, armLength),
      boxMaterial
    )
    armAlongZ.position.set(
      cornerX + (armXDir * thickness) / 2,
      height / 2,
      cornerZ + (armZDir * armLength) / 2
    )
    addEdgeOutline(armAlongZ)
    group.add(armAlongZ)
    solids.push({ mesh: armAlongZ, box: new THREE.Box3().setFromObject(armAlongZ), kind: 'cover' })
  }

  // --- Deckungs-Kisten ---
  const boxMaterial = new THREE.MeshStandardMaterial({
    color: Palette.crate,
    map: createCrateTexture(),
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
    [24, -14, 1.5, 4, 1.4], // nicht unter den Nord-Laufsteg (dort kein Platz zum Stehen)
    [24, 9, 2.6, 2.6, 2.8], // vorher (22, 16): dort liegt jetzt die Südost-Rampe
    // West-Zone
    [-28, -9, 4.5, 1.8, 2.4],
    [-27, 8, 3, 3, 2.8],
    [-24, -16, 3, 2, 2.4],
    [19, -8, 2, 2, 1.4], // neben statt unter der Nord-Brücke
    // Deckung vor den mittleren Spawns (0, ±18): dort wurde man im Bot-Test
    // oft direkt nach dem Spawn getroffen (50-62 % statt 3-9 %).
    // Front 6 m plus ein Seitenteil auf der Seite, von der geschossen wird
    // (Bot-Test: Nord-Spawn von Osten, Süd-Spawn von Westen); die andere Seite
    // bleibt offen, sonst war man eingesperrt (Nutzer). Nord-Ost-Seitenteil
    // reicht bis an die Fensterwand (x 5), sonst bliebe ein 0,5-m-Spalt.
    [0, -14, 6, 1, 2.4],
    [4.25, -16, 1.5, 3, 2.4],
    [0, 14, 6, 1, 2.4],
    [-3.5, 16, 1, 3, 2.4],
    // Nordost-Halle (Nordwand-Streifen z < -17,5 bleibt für den Regal-Steg frei)
    [42, -15, 3, 1.2, 2.4],
    [49.5, -15.5, 2, 2.5, 2.4], // deckt den Halle-Spawn (49,5 / -19,2) nach Süden
    [35, -14.5, 2, 2, 1.4],
    // Flankenraum
    [sideRoomMinX + 6, -5, 2.4, 2.4, 2.4],
    [sideRoomMinX + 13, 7, 2, 4.5, 2.8],
    [44, -8, 2.2, 2.2, 1.4],
  ]

  for (const [x, z, width, depth, height] of coverPositions) {
    const boxGeometry = worldBox(width, height, depth, CRATE_TILE)
    const box = new THREE.Mesh(boxGeometry, boxMaterial)
    box.position.set(x, height / 2, z)
    addEdgeOutline(box)
    group.add(box)
    solids.push({ mesh: box, box: new THREE.Box3().setFromObject(box), kind: 'cover' })
  }

  // --- Neon-Säulen (Kollisionskörper, 6 m hoch, brechen lange Sichtlinien):
  // dunkler Kern, leuchtende Ringe wie die Streifen oben an den Wänden. Die
  // Ringe sind reine Optik (nicht in solids/shootables).
  const pillarMaterial = new THREE.MeshStandardMaterial({ color: Palette.pillar, roughness: 0.9, metalness: 0.05 })
  const pillarRingMaterial = new THREE.MeshStandardMaterial({
    color: Palette.accentNeon,
    emissive: Palette.accentNeon,
    emissiveIntensity: 1.2,
  })
  const PILLAR_SIZE = 1.2
  const pillarRingGeometry = worldBox(PILLAR_SIZE + 0.08, 0.14, PILLAR_SIZE + 0.08)

  function buildPillar(x: number, z: number) {
    const pillar = new THREE.Mesh(worldBox(PILLAR_SIZE, WALL_HEIGHT, PILLAR_SIZE), pillarMaterial)
    pillar.position.set(x, WALL_HEIGHT / 2, z)
    addEdgeOutline(pillar)
    group.add(pillar)
    solids.push({ mesh: pillar, box: new THREE.Box3().setFromObject(pillar) })
    for (const y of [0.8, 3, WALL_HEIGHT - 0.4]) {
      const ring = new THREE.Mesh(pillarRingGeometry, pillarRingMaterial)
      ring.position.set(x, y, z)
      group.add(ring)
    }
  }

  buildPillar(11, -10)
  buildPillar(-10, -4)
  buildPillar(41, 1)

  // 1.4m: zuverlässig erkletterbar (1.6m lag genau an der Sprunghöhe)
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
    // lateralOffset: Rampe quer verschieben; omitCurbSide: Bord weglassen, wo eine Wand steht;
    // hollowThickness: Plattform nur als Deckplatte dieser Dicke (darunter begehbar)
    options: { lateralOffset?: number; omitCurbSide?: -1 | 1; hollowThickness?: number } = {}
  ): Ramp {
    const lateralOffset = options.lateralOffset ?? 0
    const rampCenterX = rampAxis === 'z' ? centerX + lateralOffset : centerX
    const rampCenterZ = rampAxis === 'x' ? centerZ + lateralOffset : centerZ
    const platformThickness = options.hollowThickness ?? platformHeight
    const platformGeometry = worldBox(platformSize, platformThickness, platformSize)
    const platform = new THREE.Mesh(platformGeometry, wallMaterial)
    platform.position.set(centerX, platformHeight - platformThickness / 2, centerZ)
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

    // Ist die Plattform unten hohl, wäre der Raum unter der Rampe (der Keil
    // ist keine Kollisionsfläche) vom Durchgang aus begehbar: Rampenende im
    // Keil verschließen. Etwas niedriger als die Rampe an dieser Stelle, damit
    // man oben nicht daran hängen bleibt und nichts herausragt.
    if (options.hollowThickness !== undefined) {
      const sealThickness = 0.1
      const sealHeight = platformHeight - 0.1
      const highEnd = rampAscending ? rampMax : rampMin
      const sealCenter = highEnd + (rampAscending ? -1 : 1) * (sealThickness / 2)
      const sealGeometry = rampAxis === 'x' ? worldBox(sealThickness, sealHeight, rampWidth) : worldBox(rampWidth, sealHeight, sealThickness)
      const seal = new THREE.Mesh(sealGeometry, wallMaterial)
      if (rampAxis === 'x') seal.position.set(sealCenter, sealHeight / 2, rampCenterZ)
      else seal.position.set(rampCenterX, sealHeight / 2, sealCenter)
      group.add(seal)
      solids.push({ mesh: seal, box: new THREE.Box3().setFromObject(seal) })
    }

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
          ? worldBox(curbLength, curbHeight, curbThickness)
          : worldBox(curbThickness, curbHeight, curbLength)
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

  const PLATFORM_A_X = 15
  const PLATFORM_A_SIZE = 6
  const UPPER_TOP = 2.8 // obere Ebene = Höhe von Plattform A
  const rampToMainPlatform = buildPlatformWithRamp(PLATFORM_A_X, 0, PLATFORM_A_SIZE, UPPER_TOP, 10, 4, 'x', true)

  // --- Obere Ebene: Laufsteg an der Wand, Brücke von Plattform A dorthin ---
  // Unterkante 2,5 m: stehend passt man darunter (Kopf 2,0 m), im Sprung
  // stößt man an (Deckenkollision). Hoch kommt man nur über Rampe A.
  const UPPER_THICKNESS = 0.3
  const CATWALK_DEPTH = 3
  const BRIDGE_WIDTH = 2.5
  const RAILING_HEIGHT = 1
  const RAILING_THICKNESS = 0.2
  const upperBottom = UPPER_TOP - UPPER_THICKNESS

  function addBlock(x: number, z: number, width: number, depth: number, bottom: number, top: number) {
    const mesh = new THREE.Mesh(worldBox(width, top - bottom, depth), wallMaterial)
    mesh.position.set(x, (bottom + top) / 2, z)
    addEdgeOutline(mesh)
    group.add(mesh)
    solids.push({ mesh, box: new THREE.Box3().setFromObject(mesh) })
  }

  const westEnd = DIVIDER_X + WALL_THICKNESS / 2
  const eastEnd = MAIN_HALF_W - WALL_THICKNESS / 2
  const CORNER_PLATFORM_SIZE = 3
  const CORNER_RAMP_LENGTH = 10 // Steigung wie Rampe A

  // side: -1 = Nordwand, 1 = Südwand. Eck-Aufgang in der West- bzw. Ostecke:
  // Plattform bündig an Steg und Wand, Rampe läuft am Steg entlang. Die
  // Südwest-Ecke bleibt frei - dort mündet der erhöhte Durchgang (2,4 m).
  // openUnderCorner: unter der Eck-Plattform ist ein Durchgang (L-Tunnel), siehe unten
  function buildUpperSide(
    side: -1 | 1,
    cornerEnd: 'west' | 'east',
    dropGap: [number, number],
    extraGaps: [number, number][] = [],
    openUnderCorner = false
  ) {
    const wallFace = side * (MAIN_HALF_D - WALL_THICKNESS / 2)
    const edge = wallFace - side * CATWALK_DEPTH
    // Laufsteg über die ganze Hauptraum-Breite (Trennwand bis Ostwand)
    addBlock((westEnd + eastEnd) / 2, (wallFace + edge) / 2, eastEnd - westEnd, CATWALK_DEPTH, upperBottom, UPPER_TOP)

    // Brücke von der Plattformkante bis zur Stegkante
    const platformEdge = side * (PLATFORM_A_SIZE / 2)
    addBlock(PLATFORM_A_X, (platformEdge + edge) / 2, BRIDGE_WIDTH, Math.abs(edge - platformEdge), upperBottom, UPPER_TOP)

    const cornerDir = cornerEnd === 'west' ? 1 : -1
    const cornerX = (cornerEnd === 'west' ? westEnd : eastEnd) + (cornerDir * CORNER_PLATFORM_SIZE) / 2
    const cornerRamp = buildPlatformWithRamp(
      cornerX,
      edge - (side * CORNER_PLATFORM_SIZE) / 2,
      CORNER_PLATFORM_SIZE,
      UPPER_TOP,
      CORNER_RAMP_LENGTH,
      CORNER_PLATFORM_SIZE,
      'x',
      cornerEnd === 'east',
      { omitCurbSide: side, hollowThickness: openUnderCorner ? UPPER_THICKNESS : undefined }
    )
    // Statt Bord auf der Stegseite: Wand unter der Stegkante bis zur
    // Unterkante, sonst käme man von unter dem Steg seitlich auf die Rampe.
    // Sie reicht nur über die Rampe, nicht über die Plattform: ist diese unten
    // hohl (openUnderCorner), geht der Gang unter dem Steg dort in den Raum
    // unter der Plattform über (L-Tunnel) und mündet auf der Hauptraum-Seite
    addBlock(
      (cornerRamp.minX + cornerRamp.maxX) / 2,
      edge + side * (RAILING_THICKNESS / 2),
      cornerRamp.maxX - cornerRamp.minX,
      RAILING_THICKNESS,
      0,
      upperBottom
    )
    const cornerGap: [number, number] = [cornerX - CORNER_PLATFORM_SIZE / 2, cornerX + CORNER_PLATFORM_SIZE / 2]

    // Geländer an der Stegkante (Deckung), Lücken: Brücke, Eck-Plattform, Absprung
    const railZ = edge + side * (RAILING_THICKNESS / 2)
    const gaps: [number, number][] = [
      [PLATFORM_A_X - BRIDGE_WIDTH / 2, PLATFORM_A_X + BRIDGE_WIDTH / 2],
      cornerGap,
      dropGap,
      ...extraGaps,
    ].sort((a, b) => a[0] - b[0]) as [number, number][]
    let from = westEnd
    for (const [gapStart, gapEnd] of [...gaps, [eastEnd, eastEnd]]) {
      if (gapStart > from) addBlock((from + gapStart) / 2, railZ, gapStart - from, RAILING_THICKNESS, UPPER_TOP, UPPER_TOP + RAILING_HEIGHT)
      from = gapEnd
    }

    // Stützen unter der Stegkante (Abstand zu den Spawns bei x = 0: dort geht es seitlich raus)
    for (const x of [-12, -7, 8, 24]) {
      if (x > cornerRamp.minX - 0.2 && x < cornerRamp.maxX + 0.2) continue // dort trägt die Wand
      addBlock(x, edge + side * 0.2, 0.4, 0.4, 0, upperBottom)
    }
    addBlock(PLATFORM_A_X - BRIDGE_WIDTH / 2 + 0.2, (platformEdge + edge) / 2, 0.4, 0.4, 0, upperBottom)
    addBlock(PLATFORM_A_X + BRIDGE_WIDTH / 2 - 0.2, (platformEdge + edge) / 2, 0.4, 0.4, 0, upperBottom)
    return cornerRamp
  }
  // --- Nordost-Halle: Regal-Steg auf 2,8 m an der Nordwand, Verlängerung des
  // Nordstegs durch die Ostwand (Öffnung bis zur Oberkante, darunter Sockel;
  // ohne Sturz, sonst stößt man im Sprung mitten in der Tür an)
  const SHELF_Z_MIN = -MAIN_HALF_D + WALL_THICKNESS / 2
  const SHELF_Z_MAX = SHELF_Z_MIN + CATWALK_DEPTH
  const SHELF_MAX_X = sideRoomMaxX - WALL_THICKNESS / 2
  const shelfMinX = MAIN_HALF_W + WALL_THICKNESS / 2
  const shelfDoorZ = (SHELF_Z_MIN + SHELF_Z_MAX) / 2
  addBlock(MAIN_HALF_W, shelfDoorZ, WALL_THICKNESS, CATWALK_DEPTH, 0, UPPER_TOP)
  addBlock((shelfMinX + SHELF_MAX_X) / 2, shelfDoorZ, SHELF_MAX_X - shelfMinX, CATWALK_DEPTH, upperBottom, UPPER_TOP)
  {
    const railZ = SHELF_Z_MAX - RAILING_THICKNESS / 2
    const dropGap: [number, number] = [47, 49]
    addBlock((shelfMinX + dropGap[0]) / 2, railZ, dropGap[0] - shelfMinX, RAILING_THICKNESS, UPPER_TOP, UPPER_TOP + RAILING_HEIGHT)
    addBlock((dropGap[1] + SHELF_MAX_X) / 2, railZ, SHELF_MAX_X - dropGap[1], RAILING_THICKNESS, UPPER_TOP, UPPER_TOP + RAILING_HEIGHT)
    for (const x of [36, 43, 51]) addBlock(x, SHELF_Z_MAX - 0.2, 0.4, 0.4, 0, upperBottom)
  }

  const rampNorthWest = buildUpperSide(-1, 'west', [26, 28])
  // Südsteg: Lücke im Geländer für die Verbindung vom Fenster (siehe unten)
  const WINDOW_LINK_X: [number, number] = [westEnd, westEnd + 2.5]
  const rampSouthEast = buildUpperSide(1, 'east', [-16, -14], [WINDOW_LINK_X], true)

  // Verbindung vom Fenster in der Trennwand (West-Plattform, 2,8 m) zum
  // Südsteg: 2,5 m breit, Geländer an der Ostseite, Nordende offen (Absprung)
  const linkDepth = 17.5 - DOORWAY_Z_MIN
  addBlock((WINDOW_LINK_X[0] + WINDOW_LINK_X[1]) / 2, DOORWAY_Z_MIN + linkDepth / 2, 2.5, linkDepth, upperBottom, UPPER_TOP)
  addBlock(WINDOW_LINK_X[1] - RAILING_THICKNESS / 2, DOORWAY_Z_MIN + linkDepth / 2, RAILING_THICKNESS, linkDepth, UPPER_TOP, UPPER_TOP + RAILING_HEIGHT)
  addBlock(WINDOW_LINK_X[1] - 0.2, DOORWAY_Z_MIN + 0.2, 0.4, 0.4, 0, upperBottom)

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
    9.4, // Steigung ~0,3 wie die anderen Rampen
    WEST_RAMP_WIDTH,
    'z',
    true,
    {
      lateralOffset: westPlatformEastEdge - WEST_RAMP_WIDTH / 2 - WEST_PLATFORM_CENTER_X,
      omitCurbSide: 1,
    }
  )

  // --- Deko (reine Optik): Wandlampen an den Innenseiten, Rampen-Schilder ---
  const inner = WALL_THICKNESS / 2
  const v = (x: number, z: number) => new THREE.Vector3(x, 0, z)
  addWallLamps(group, [
    { from: v(-26, -MAIN_HALF_D + inner), to: v(26, -MAIN_HALF_D + inner), count: 7, normal: v(0, 1) },
    { from: v(-26, MAIN_HALF_D - inner), to: v(26, MAIN_HALF_D - inner), count: 7, normal: v(0, -1) },
    { from: v(-MAIN_HALF_W + inner, -14), to: v(-MAIN_HALF_W + inner, 14), count: 3, normal: v(1, 0) },
    { from: v(sideRoomMaxX - inner, -8), to: v(sideRoomMaxX - inner, 8), count: 3, normal: v(-1, 0) },
  ])
  // Rampe A: Plattform bei (15, 0), Schild auf Süd- und Nordseite
  addLabel(group, 'A', new THREE.Vector3(15, 1.4, 3), v(0, 1))
  addLabel(group, 'A', new THREE.Vector3(15, 1.4, -3), v(0, -1))
  // Rampe B: West-Plattform, Schild auf der Westseite
  addLabel(group, 'B', new THREE.Vector3(WEST_PLATFORM_CENTER_X - WEST_PLATFORM_SIZE / 2, 1.2, WEST_PLATFORM_CENTER_Z), v(-1, 0), 1.1)

  const spawnPoints = SPAWN_POINTS.map((p) => new THREE.Vector3(p.x, p.y, p.z))

  return {
    group,
    solids,
    spawnPoints,
    ramps: [rampToMainPlatform, rampToWestPlatform, rampNorthWest, rampSouthEast],
    shootables: [mainGround, sideGround, hallGround, ...shootableExtras, ...solids.map((s) => s.mesh)],
  }
}
