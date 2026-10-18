import * as THREE from 'three'
import { Palette } from './palette'
import { createCrateTexture, createPanelTexture, worldBox, CRATE_TILE, PANEL_TILE } from './surfaceTextures'
import { addWallLamps, addLabel } from './decorations'
import { ARENA_HALF, SPAWN_POINTS } from './shared/arenaLayout'

// Baut die Arena aus reiner Geometrie (keine Texturen). "solids" sind alle
// Objekte mit Kollision, jeweils mit fertiger Bounding Box.

// Höhe der Kollisionsbox voller Wände (Meter)
const WALL_COLLISION_TOP = 100

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


// Karte "Nexus": quadratische Arena (56 m) für die Gadgets. Zentralturm mit flachem Dach (nur per Haken oder Sprungpad
// erreichbar), Laufsteg-Ring auf 2,8 m mit zwei Rampen, vier Brücken zum Turm, vier Eck-Bunker mit Dach.
// Alles punktsymmetrisch (180° um die Mitte).
const WALL_HEIGHT = 6
const WALL_THICKNESS = 1
const UPPER_TOP = 2.8 // Laufsteg-Ebene (wie Rampen-Höhe der alten Karte)
const SLAB = 0.3
const UPPER_BOTTOM = UPPER_TOP - SLAB // Unterkante 2,5 m: stehend passt man darunter
const CATWALK_DEPTH = 3
const INNER = ARENA_HALF - WALL_THICKNESS / 2 // Innenseite der Außenwände
const CATWALK_EDGE = INNER - CATWALK_DEPTH // Innenkante des Laufsteg-Rings
const RAILING_HEIGHT = 1
const RAILING_THICKNESS = 0.2
const TOWER_HALF = 6
const TOWER_WALL_TOP = 5.5
const TOWER_TOP = 6
const DOOR_WIDTH = 3
const DOOR_HEIGHT = 2.4
const LEDGE_HALF = 9 // Simsring um den Turm (3 m breit) auf Laufsteg-Höhe
const BRIDGE_WIDTH = 2.5
const BUNKER_CENTER = 16
const BUNKER_SIZE = 7.5
const BUNKER_WALL = 0.8
const BUNKER_WALL_TOP = 3.7
const BUNKER_TOP = 4
const RAMP_LENGTH = 10 // Steigung ~0,28 wie bisher

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
  const shootableExtras: THREE.Object3D[] = []

  // --- Boden und Raster ---
  const groundMaterial = new THREE.MeshStandardMaterial({ color: Palette.ground, roughness: 0.9, metalness: 0.05 })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2 + 1, ARENA_HALF * 2 + 1), groundMaterial)
  ground.rotation.x = -Math.PI / 2 // liegend statt stehend ausrichten
  group.add(ground)

  const grid = new THREE.GridHelper(ARENA_HALF * 2, 28, Palette.accentNeon, 0x2a3a4a)
  ;(grid.material as THREE.Material).transparent = true
  ;(grid.material as THREE.Material).opacity = 0.15
  grid.position.y = 0.01 // knapp über dem Boden, gegen Z-Fighting
  group.add(grid)

  const wallMaterial = new THREE.MeshStandardMaterial({ color: Palette.wall, map: createPanelTexture(), roughness: 0.8, metalness: 0.1 })
  const boxMaterial = new THREE.MeshStandardMaterial({ color: Palette.crate, map: createCrateTexture(), roughness: 0.6, metalness: 0.15 })

  // Quader mit Kollision (Wandfarbe = Struktur, sonst Kiste); Kanten leuchten
  function block(x: number, z: number, width: number, depth: number, bottom: number, top: number, kind?: 'wall' | 'cover', material = wallMaterial) {
    const mesh = new THREE.Mesh(worldBox(width, top - bottom, depth, material === boxMaterial ? CRATE_TILE : PANEL_TILE), material)
    mesh.position.set(x, (bottom + top) / 2, z)
    addEdgeOutline(mesh)
    group.add(mesh)
    solids.push({ mesh, box: new THREE.Box3().setFromObject(mesh), kind })
    return mesh
  }

  const crate = (x: number, z: number, width: number, depth: number, height: number, base = 0) =>
    block(x, z, width, depth, base, base + height, 'cover', boxMaterial)

  // Wand entlang einer Achse; mit Tür: zwei Pfosten und ein Sturz darüber
  function wallRun(x: number, z: number, length: number, thickness: number, alongX: boolean, top: number, doorWidth?: number) {
    const w = (len: number) => (alongX ? len : thickness)
    const d = (len: number) => (alongX ? thickness : len)
    if (!doorWidth) {
      block(x, z, w(length), d(length), 0, top, 'wall')
      return
    }
    const segment = (length - doorWidth) / 2
    const offset = doorWidth / 2 + segment / 2
    block(x + (alongX ? -offset : 0), z + (alongX ? 0 : -offset), w(segment), d(segment), 0, top, 'wall')
    block(x + (alongX ? offset : 0), z + (alongX ? 0 : offset), w(segment), d(segment), 0, top, 'wall')
    block(x, z, w(doorWidth), d(doorWidth), DOOR_HEIGHT, top, 'wall')
  }

  // --- Außenwände (6 m, mit Neon-Streifen oben) ---
  const wallLength = ARENA_HALF * 2 + WALL_THICKNESS
  const outerWalls: Array<[number, number, number, number]> = [
    [0, -ARENA_HALF, wallLength, WALL_THICKNESS],
    [0, ARENA_HALF, wallLength, WALL_THICKNESS],
    [-ARENA_HALF, 0, WALL_THICKNESS, ARENA_HALF * 2 - WALL_THICKNESS],
    [ARENA_HALF, 0, WALL_THICKNESS, ARENA_HALF * 2 - WALL_THICKNESS],
  ]
  const stripeMaterial = new THREE.MeshStandardMaterial({ color: Palette.accentNeon, emissive: Palette.accentNeon, emissiveIntensity: 1.2 })
  for (const [x, z, w, d] of outerWalls) {
    block(x, z, w, d, 0, WALL_HEIGHT, 'wall')
    const stripe = new THREE.Mesh(worldBox(w * 0.98, 0.1, d * 0.98 + (d === WALL_THICKNESS ? 0.1 : 0)), stripeMaterial)
    stripe.position.set(x, WALL_HEIGHT - 0.1, z)
    group.add(stripe)
  }

  // --- Zentralturm: hohl, vier Türen, flaches Dach (6 m). Dach = Struktur, nicht "Wand": nur Wände über 5,9 m
  // bekommen die unsichtbare Verlängerung, auf dem Dach muss man stehen können. ---
  const towerEdge = TOWER_HALF - WALL_THICKNESS / 2
  wallRun(0, -towerEdge, TOWER_HALF * 2, WALL_THICKNESS, true, TOWER_WALL_TOP, DOOR_WIDTH)
  wallRun(0, towerEdge, TOWER_HALF * 2, WALL_THICKNESS, true, TOWER_WALL_TOP, DOOR_WIDTH)
  wallRun(-towerEdge, 0, TOWER_HALF * 2 - WALL_THICKNESS * 2, WALL_THICKNESS, false, TOWER_WALL_TOP, DOOR_WIDTH)
  wallRun(towerEdge, 0, TOWER_HALF * 2 - WALL_THICKNESS * 2, WALL_THICKNESS, false, TOWER_WALL_TOP, DOOR_WIDTH)
  block(0, 0, TOWER_HALF * 2, TOWER_HALF * 2, TOWER_WALL_TOP, TOWER_TOP)
  crate(0, 0, 2, 2, 2.4) // Mittelblock: nimmt die Sicht von Tür zu Tür
  // Deckung auf dem Dach (niedrig: der Besitzer überblickt sonst alles)
  for (const [x, z] of [[-3.2, -3.2], [3.2, 3.2]]) crate(x, z, 2, 2, 1.2, TOWER_TOP)
  for (const [x, z] of [[3.2, -3.2], [-3.2, 3.2]]) crate(x, z, 1.2, 2.4, 1.2, TOWER_TOP)

  // --- Simsring um den Turm (Laufsteg-Höhe, 3 m breit, Platz für ein Sprungpad), Brücken zum Laufsteg-Ring ---
  const ledgeWidth = LEDGE_HALF - TOWER_HALF
  const ledgeMid = (LEDGE_HALF + TOWER_HALF) / 2
  block(0, -ledgeMid, LEDGE_HALF * 2, ledgeWidth, UPPER_BOTTOM, UPPER_TOP)
  block(0, ledgeMid, LEDGE_HALF * 2, ledgeWidth, UPPER_BOTTOM, UPPER_TOP)
  block(-ledgeMid, 0, ledgeWidth, TOWER_HALF * 2, UPPER_BOTTOM, UPPER_TOP)
  block(ledgeMid, 0, ledgeWidth, TOWER_HALF * 2, UPPER_BOTTOM, UPPER_TOP)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(sx * (LEDGE_HALF - 0.2), sz * (LEDGE_HALF - 0.2), 0.4, 0.4, 0, UPPER_BOTTOM)

  const railing = (x: number, z: number, width: number, depth: number, base = UPPER_TOP) => block(x, z, width, depth, base, base + RAILING_HEIGHT)
  // Geländer außen am Sims, mit 3 m Lücke an jeder Brücke
  const gap = DOOR_WIDTH / 2
  for (const s of [-1, 1]) {
    const edge = s * (LEDGE_HALF - RAILING_THICKNESS / 2)
    const seg = (LEDGE_HALF * 2 - 2 * gap) / 2
    const c = gap + seg / 2
    railing(-c, edge, seg, RAILING_THICKNESS)
    railing(c, edge, seg, RAILING_THICKNESS)
    railing(edge, -c, RAILING_THICKNESS, seg)
    railing(edge, c, RAILING_THICKNESS, seg)
  }

  // Brücken vom Sims zum Laufsteg-Ring (vier, auf den Achsen), Geländer beidseitig mit 4 m Lücke in der Mitte
  const bridgeLength = CATWALK_EDGE - LEDGE_HALF
  const bridgeMid = (CATWALK_EDGE + LEDGE_HALF) / 2
  for (const s of [-1, 1]) {
    block(s * bridgeMid, 0, bridgeLength, BRIDGE_WIDTH, UPPER_BOTTOM, UPPER_TOP)
    block(0, s * bridgeMid, BRIDGE_WIDTH, bridgeLength, UPPER_BOTTOM, UPPER_TOP)
    block(s * bridgeMid, 0, 0.5, 0.5, 0, UPPER_BOTTOM) // Stütze in der Mitte
    block(0, s * bridgeMid, 0.5, 0.5, 0, UPPER_BOTTOM)
    const railLen = (bridgeLength - 4) / 2
    const railMid = LEDGE_HALF + railLen / 2
    const railMid2 = CATWALK_EDGE - railLen / 2
    for (const side of [-1, 1]) {
      const off = side * (BRIDGE_WIDTH / 2 - RAILING_THICKNESS / 2)
      for (const m of [railMid, railMid2]) {
        railing(s * m, off, railLen, RAILING_THICKNESS)
        railing(off, s * m, RAILING_THICKNESS, railLen)
      }
    }
  }

  // --- Laufsteg-Ring an den Außenwänden ---
  const stripLength = INNER * 2
  const stripMid = INNER - CATWALK_DEPTH / 2
  block(0, -stripMid, stripLength, CATWALK_DEPTH, UPPER_BOTTOM, UPPER_TOP)
  block(0, stripMid, stripLength, CATWALK_DEPTH, UPPER_BOTTOM, UPPER_TOP)
  block(-stripMid, 0, CATWALK_DEPTH, CATWALK_EDGE * 2, UPPER_BOTTOM, UPPER_TOP)
  block(stripMid, 0, CATWALK_DEPTH, CATWALK_EDGE * 2, UPPER_BOTTOM, UPPER_TOP)
  // Stützen unter dem Ring (ohne Rampen- und Brückenbereiche)
  for (const p of [-16, -8, 8, 16]) {
    block(p, -CATWALK_EDGE - 0.1, 0.4, 0.4, 0, UPPER_BOTTOM)
    block(p, CATWALK_EDGE + 0.1, 0.4, 0.4, 0, UPPER_BOTTOM)
  }
  for (const p of [-8, 8]) {
    block(-CATWALK_EDGE - 0.1, p, 0.4, 0.4, 0, UPPER_BOTTOM)
    block(CATWALK_EDGE + 0.1, p, 0.4, 0.4, 0, UPPER_BOTTOM)
  }
  block(-CATWALK_EDGE - 0.1, 16, 0.4, 0.4, 0, UPPER_BOTTOM)
  block(CATWALK_EDGE + 0.1, -16, 0.4, 0.4, 0, UPPER_BOTTOM)

  // Geländer an der Innenkante; Lücken an Brücken und Rampen-Enden
  const gapB = BRIDGE_WIDTH / 2 + 0.25
  const edgeRail = (from: number, to: number, line: number, alongX: boolean) => {
    const length = to - from
    if (length <= 0) return
    const mid = (from + to) / 2
    if (alongX) railing(mid, line, length, RAILING_THICKNESS)
    else railing(line, mid, RAILING_THICKNESS, length)
  }
  const lineLow = -CATWALK_EDGE - RAILING_THICKNESS / 2 // Geländer liegt im Streifen, an dessen Innenkante
  const lineHigh = CATWALK_EDGE + RAILING_THICKNESS / 2
  edgeRail(-CATWALK_EDGE + 3, -gapB, lineLow, true) // Nord: links der Rampe NW (x -24,5..-21,5) bleibt frei
  edgeRail(gapB, CATWALK_EDGE, lineLow, true)
  edgeRail(-CATWALK_EDGE, -gapB, lineHigh, true) // Süd
  edgeRail(gapB, CATWALK_EDGE - 3, lineHigh, true) // rechts frei: Rampe SE
  edgeRail(-CATWALK_EDGE, -gapB, lineLow, false) // West
  edgeRail(gapB, CATWALK_EDGE, lineLow, false)
  edgeRail(-CATWALK_EDGE, -gapB, lineHigh, false) // Ost
  edgeRail(gapB, CATWALK_EDGE, lineHigh, false)

  // --- Rampen auf den Ring: NW läuft am Nordsteg entlang nach Norden, SE (punktgespiegelt) nach Süden ---
  function buildRamp(centerX: number, minZ: number, maxZ: number, ascending: boolean, curbSide: -1 | 1): Ramp {
    const width = CATWALK_DEPTH
    const ramp: Ramp = {
      minX: centerX - width / 2,
      maxX: centerX + width / 2,
      minZ,
      maxZ,
      axis: 'z',
      ascending,
      bottomHeight: 0,
      topHeight: UPPER_TOP,
    }
    const mesh = new THREE.Mesh(createWedgeGeometry(maxZ - minZ, width, UPPER_TOP), wallMaterial)
    mesh.rotation.y = ascending ? -Math.PI / 2 : Math.PI / 2
    mesh.position.set(centerX, 0, ascending ? minZ : maxZ)
    addEdgeOutline(mesh)
    group.add(mesh)
    shootableExtras.push(mesh)
    // Seitenborde: Rampe nur von vorne betretbar (seitlich würde man schlagartig auf Rampenhöhe gehoben). Auf der
    // Ring-Seite stützt die Wand zugleich den Laufsteg (bis zur Unterkante), auf der freien Seite ist sie rampenhoch.
    block(centerX + curbSide * (width / 2 + 0.1), (minZ + maxZ) / 2, 0.2, maxZ - minZ, 0, UPPER_TOP)
    block(centerX - curbSide * (width / 2 + 0.1), (minZ + maxZ) / 2, 0.2, maxZ - minZ, 0, UPPER_TOP)
    return ramp
  }
  const rampNorthWest = buildRamp(-(CATWALK_EDGE - CATWALK_DEPTH / 2), -CATWALK_EDGE, -CATWALK_EDGE + RAMP_LENGTH, false, 1)
  const rampSouthEast = buildRamp(CATWALK_EDGE - CATWALK_DEPTH / 2, CATWALK_EDGE - RAMP_LENGTH, CATWALK_EDGE, true, -1)

  // --- Eck-Bunker: hohl, zwei Türen zur Mitte, Dach auf 4 m (Sprungpad-/Haken-Ziel), Deckung innen ---
  function buildBunker(cx: number, cz: number) {
    const half = BUNKER_SIZE / 2
    const edge = half - BUNKER_WALL / 2
    const doorX = cx > 0 ? -1 : 1 // Tür auf der Seite zur Mitte
    const doorZ = cz > 0 ? -1 : 1
    const inner = BUNKER_SIZE - BUNKER_WALL * 2
    const door = 2.6
    // Wände parallel zur X-Achse (Nord/Süd): die zur Mitte hat eine Tür
    for (const s of [-1, 1]) {
      const hasDoor = s === doorZ
      wallRunBunker(cx, cz + s * edge, BUNKER_SIZE, true, hasDoor ? door : undefined)
      wallRunBunker(cx + s * edge, cz, inner, false, s === doorX ? door : undefined)
    }
    block(cx, cz, BUNKER_SIZE, BUNKER_SIZE, BUNKER_WALL_TOP, BUNKER_TOP)
    crate(cx - doorX * 1.9, cz - doorZ * 1.9, 1.6, 1.6, 1.4) // Deckung im Inneren, hinten
  }
  function wallRunBunker(x: number, z: number, length: number, alongX: boolean, doorWidth?: number) {
    wallRun(x, z, length, BUNKER_WALL, alongX, BUNKER_WALL_TOP, doorWidth)
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) buildBunker(sx * BUNKER_CENTER, sz * BUNKER_CENTER)

  // --- Deckungs-Kisten (punktsymmetrisch in Paaren) ---
  const pairs: Array<[number, number, number, number, number]> = [
    [-9, -12, 2.5, 2.5, 2.4],
    [12, -5, 3, 1.5, 1.4],
    [5, -13, 1.5, 3, 1.4],
    [21.5, -3.5, 2.4, 1.2, 2.4], // vor den Spawns an den Seiten
    [3.5, -21.5, 1.2, 2.4, 2.4],
    [-16, 6, 2, 2, 1.4],
  ]
  for (const [x, z, w, d, h] of pairs) {
    crate(x, z, w, d, h)
    crate(-x, -z, w, d, h)
  }

  // --- Neon-Säulen (6 m, Kollisionskörper, Anker für den Haken); Ringe nur Optik ---
  const pillarMaterial = new THREE.MeshStandardMaterial({ color: Palette.pillar, roughness: 0.9, metalness: 0.05 })
  const pillarRingMaterial = new THREE.MeshStandardMaterial({ color: Palette.accentNeon, emissive: Palette.accentNeon, emissiveIntensity: 1.2 })
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
  for (const [x, z] of [[22, 10], [10, -22]]) {
    buildPillar(x, z)
    buildPillar(-x, -z)
  }

  // --- Deko (reine Optik): Wandlampen an den Innenseiten ---
  const inset = WALL_THICKNESS / 2
  const v = (x: number, z: number) => new THREE.Vector3(x, 0, z)
  const lampSpan = ARENA_HALF - 4
  addWallLamps(group, [
    { from: v(-lampSpan, -ARENA_HALF + inset), to: v(lampSpan, -ARENA_HALF + inset), count: 7, normal: v(0, 1) },
    { from: v(-lampSpan, ARENA_HALF - inset), to: v(lampSpan, ARENA_HALF - inset), count: 7, normal: v(0, -1) },
    { from: v(-ARENA_HALF + inset, -lampSpan), to: v(-ARENA_HALF + inset, lampSpan), count: 7, normal: v(1, 0) },
    { from: v(ARENA_HALF - inset, -lampSpan), to: v(ARENA_HALF - inset, lampSpan), count: 7, normal: v(-1, 0) },
  ])
  // Schilder an den Rampen
  addLabel(group, 'A', new THREE.Vector3(-CATWALK_EDGE + 1.5, 1.4, -CATWALK_EDGE + RAMP_LENGTH), v(0, 1))
  addLabel(group, 'B', new THREE.Vector3(CATWALK_EDGE - 1.5, 1.4, CATWALK_EDGE - RAMP_LENGTH), v(0, -1))

  // Unsichtbare Mauern: volle Wände (6 m) blockieren für die Kollision nach oben unbegrenzt. Wer per Sprungpad
  // über 6 m kommt, fliegt so nie über eine Außenwand und landet nicht auf einer Wandkrone. Nur die Kollisionsbox,
  // Optik und Schüsse bleiben bei 6 m. Es gibt bewusst keine unsichtbare Decke. Turmwände (5,5 m) und das Dach
  // bleiben bewusst darunter, auf dem Dach steht man.
  for (const solid of solids) {
    if (solid.kind === 'wall' && solid.box.max.y >= 5.9) solid.box.max.y = WALL_COLLISION_TOP
  }

  const spawnPoints = SPAWN_POINTS.map((p) => new THREE.Vector3(p.x, p.y, p.z))

  return {
    group,
    solids,
    spawnPoints,
    ramps: [rampNorthWest, rampSouthEast],
    shootables: [ground, ...shootableExtras, ...solids.map((s) => s.mesh)],
  }
}
