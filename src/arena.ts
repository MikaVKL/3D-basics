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

// Eine begehbare Schräge (z.B. Rampe zu einer erhöhten Plattform): anders als
// ein Solid blockiert sie NICHT seitlich, sondern gibt dem Spieler pro
// Position eine interpolierte Stand-Höhe zwischen bottomHeight und
// topHeight - siehe player.ts (groundHeightAt). "axis" ist die Richtung des
// Anstiegs; "ascending" gibt an, ob die Höhe mit steigender oder fallender
// Koordinate zunimmt.
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
  // Mehrere Spawn-Punkte statt nur einem: im Singleplayer wird einfach
  // einer davon zufällig gewählt, aber die Liste ist schon jetzt so
  // angelegt, dass später jeder Mitspieler (2-4 im Multiplayer) einen
  // eigenen, weit genug entfernten Punkt bekommen könnte, ohne dass sich
  // mehrere Spieler direkt aufeinander spawnen.
  spawnPoints: THREE.Vector3[]
  // Begehbare Schrägen (siehe Ramp oben) - separat von "solids", weil sie
  // nicht seitlich blockieren, sondern nur die Stand-Höhe beeinflussen.
  ramps: Ramp[]
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
// Nochmal deutlich vergrößert (52x36 -> 64x42) und mit mehr innerer Struktur
// versehen (Trennwand mit Durchgang + Fenster, mehr/höhere Deckung) - eine
// reine leere Halle wird auf Dauer langweilig, gerade bei mehreren Spielern.
const MAIN_ROOM_WIDTH = 64 // X-Ausdehnung
const MAIN_ROOM_DEPTH = 42 // Z-Ausdehnung
const MAIN_HALF_W = MAIN_ROOM_WIDTH / 2
const MAIN_HALF_D = MAIN_ROOM_DEPTH / 2

const SIDE_ROOM_WIDTH = 20 // X-Ausdehnung (wie weit er nach außen ragt)
const SIDE_ROOM_DEPTH = 24 // Z-Ausdehnung (= Breite der Öffnung zum Hauptraum)
const SIDE_HALF_D = SIDE_ROOM_DEPTH / 2

const WALL_HEIGHT = 6
const WALL_THICKNESS = 1

// Baut ein dreiseitiges Prisma (Keilform) für die Rampen-Optik: die
// Grundfläche liegt bei y=0, die Schräge steigt entlang +X von y=0 auf
// y=height an, über die volle Breite (Z-Richtung) hinweg. Bewusst mit
// duplizierten Vertices pro Fläche (kein Index-Buffer) gebaut, damit
// computeVertexNormals() pro Fläche eine eigene, flache Normale erzeugt -
// gibt den "Low-Poly"-Look mit klaren Kanten statt weicher Rundungen.
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

  // Innere Trennwand (siehe unten für das Fenster dazwischen): teilt den
  // Hauptraum in zwei Zonen statt einer durchgehend offenen Halle. Zwei
  // durchgehende Abschnitte entlang Z, mit einer Lücke in der Mitte für
  // Durchgang (begehbar) + Fenster (nur Sicht/Schuss, siehe unten).
  const DIVIDER_X = -20
  const DIVIDER_SOLID_SOUTH_Z_MAX = -11
  const DIVIDER_GAP_Z_MAX = -3 // Durchgang: von SOLID_SOUTH_Z_MAX bis hier
  const WINDOW_Z_MAX = 3 // Fenster: von DIVIDER_GAP_Z_MAX bis hier
  const dividerSouthDepth = DIVIDER_SOLID_SOUTH_Z_MAX - -MAIN_HALF_D
  const dividerNorthDepth = MAIN_HALF_D - WINDOW_Z_MAX

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
    // Innere Trennwand (Süd- und Nord-Abschnitt, siehe oben)
    { w: WALL_THICKNESS, d: dividerSouthDepth, x: DIVIDER_X, z: -MAIN_HALF_D + dividerSouthDepth / 2 },
    { w: WALL_THICKNESS, d: dividerNorthDepth, x: DIVIDER_X, z: WINDOW_Z_MAX + dividerNorthDepth / 2 },
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

  // --- Fenster in der inneren Trennwand (Sockel + Sturz, siehe oben) ---
  // Zwischen den beiden Trennwand-Abschnitten liegt die Lücke von
  // DIVIDER_SOLID_SOUTH_Z_MAX bis MAIN_HALF_D-dividerNorthDepth (=WINDOW_Z_MAX);
  // darin liegt zuerst der begehbare Durchgang (bis DIVIDER_GAP_Z_MAX), dann
  // das Fenster: Sockel (unten) + Sturz (oben) als zwei getrennte Solids mit
  // Lücke dazwischen - man kann durchsehen und durchschießen, aber NICHT
  // durchlaufen (anders als der Durchgang direkt daneben).
  const WINDOW_SILL_HEIGHT = 1.1 // bis hier blockt der Sockel (verhindert Durchlaufen)
  const WINDOW_OPENING_TOP = 2.6 // ab hier blockt der Sturz wieder
  const windowDepth = WINDOW_Z_MAX - DIVIDER_GAP_Z_MAX

  const windowSill = new THREE.Mesh(
    new THREE.BoxGeometry(WALL_THICKNESS, WINDOW_SILL_HEIGHT, windowDepth),
    wallMaterial
  )
  windowSill.position.set(DIVIDER_X, WINDOW_SILL_HEIGHT / 2, DIVIDER_GAP_Z_MAX + windowDepth / 2)
  group.add(windowSill)
  solids.push({ mesh: windowSill, box: new THREE.Box3().setFromObject(windowSill) })

  const windowLintelHeight = WALL_HEIGHT - WINDOW_OPENING_TOP
  const windowLintel = new THREE.Mesh(
    new THREE.BoxGeometry(WALL_THICKNESS, windowLintelHeight, windowDepth),
    wallMaterial
  )
  windowLintel.position.set(
    DIVIDER_X,
    WINDOW_OPENING_TOP + windowLintelHeight / 2,
    DIVIDER_GAP_Z_MAX + windowDepth / 2
  )
  group.add(windowLintel)
  solids.push({ mesh: windowLintel, box: new THREE.Box3().setFromObject(windowLintel) })

  // --- Deckungs-Kisten (warme Akzentfarbe) ---
  const boxMaterial = new THREE.MeshStandardMaterial({
    color: Palette.accentWarm,
    roughness: 0.6,
    metalness: 0.15,
  })

  // Bewusst UNGLEICHMÄSSIG verteilt (anders große Kisten, kein gespiegeltes
  // Muster) statt symmetrischer Ecken. Zwei Höhen-Kategorien:
  // - 1.4m: klassische Deckung, man kann draufspringen (~1.6m Sprunghöhe)
  //   und von dort weiterkämpfen - man sieht/wird gesehen, wenn man nah dran ist.
  // - 2.2m: höher als Augenhöhe (1.7m) - blockt die Sicht komplett, kein
  //   Draufspringen möglich. Echte "Wand"-Deckung statt nur Sichtschutz.
  const coverPositions: Array<[number, number, number, number]> = [
    // [x, z, breite, höhe] - Hauptraum (östliche/zentrale Zone)
    [-14, -8, 3, 1.4],
    [-12, 7, 2.2, 1.4],
    [3, -9, 2.6, 1.4],
    [4, 9, 3.4, 1.4],
    [-2, 0, 4, 1.4],
    [24, -16, 2.6, 1.4],
    [22, 16, 2.6, 2.2],
    // Hauptraum, westliche Zone (jenseits der Trennwand, Richtung Spawns)
    [-28, -9, 2.6, 1.4],
    [-27, 8, 3, 2.2],
    // Flankenraum
    [sideRoomMinX + 6, -5, 2.4, 1.4],
    [sideRoomMinX + 13, 7, 2.6, 2.2],
  ]

  for (const [x, z, size, height] of coverPositions) {
    const boxGeometry = new THREE.BoxGeometry(size, height, size)
    const box = new THREE.Mesh(boxGeometry, boxMaterial)
    box.position.set(x, height / 2, z)
    group.add(box)
    solids.push({ mesh: box, box: new THREE.Box3().setFromObject(box) })
  }

  // --- Erhöhte Plattform + Rampe (echte Höhenstufe, größer als jede
  // Deckungskiste) - gibt bei 2-4 Spielern einen "King of the Hill"-Punkt
  // mit Überblick. Kühle Struktur-Farbe (wie die Wände), nicht die warme
  // Deckungs-Farbe, damit man Struktur/Deckung optisch unterscheidet.
  const PLATFORM_HEIGHT = 2.8
  const PLATFORM_SIZE = 6
  const PLATFORM_CENTER_X = 15
  const PLATFORM_CENTER_Z = 0
  // Bewusst recht lang (flache Steigung von PLATFORM_HEIGHT über RAMP_LENGTH):
  // ist die Rampe zu steil, "berührt" die Spieler-Kollisionsbox (die einen
  // Radius von PLAYER_RADIUS hat) die senkrechte Plattform-Seitenwand schon,
  // bevor die Rampe an dieser Stelle hoch genug ist - der Spieler bleibt dann
  // exakt am Übergang stecken (in Tests reproduziert und so behoben).
  const RAMP_LENGTH = 10
  const RAMP_WIDTH = 4

  const platformGeometry = new THREE.BoxGeometry(PLATFORM_SIZE, PLATFORM_HEIGHT, PLATFORM_SIZE)
  const platform = new THREE.Mesh(platformGeometry, wallMaterial)
  platform.position.set(PLATFORM_CENTER_X, PLATFORM_HEIGHT / 2, PLATFORM_CENTER_Z)
  group.add(platform)
  solids.push({ mesh: platform, box: new THREE.Box3().setFromObject(platform) })

  const platformMinX = PLATFORM_CENTER_X - PLATFORM_SIZE / 2
  const rampMinX = platformMinX - RAMP_LENGTH

  // Die Rampe steigt von 0 auf PLATFORM_HEIGHT an, exakt bis an die
  // Plattform-Kante heran - so geht der Übergang nahtlos, ohne Sprung.
  const ramp: Ramp = {
    minX: rampMinX,
    maxX: platformMinX,
    minZ: PLATFORM_CENTER_Z - RAMP_WIDTH / 2,
    maxZ: PLATFORM_CENTER_Z + RAMP_WIDTH / 2,
    axis: 'x',
    ascending: true,
    bottomHeight: 0,
    topHeight: PLATFORM_HEIGHT,
  }

  // Sichtbares Rampen-Mesh: ein dreiseitiges Prisma (Keilform), damit die
  // Schräge auch wirklich schräg AUSSIEHT statt wie eine liegende Box.
  const rampMesh = new THREE.Mesh(
    createWedgeGeometry(RAMP_LENGTH, RAMP_WIDTH, PLATFORM_HEIGHT),
    wallMaterial
  )
  rampMesh.position.set(rampMinX, 0, PLATFORM_CENTER_Z)
  group.add(rampMesh)

  // Fünf Punkte, mit Abstand zu Wänden/Kisten und zueinander verteilt -
  // vier in den Ecken des Hauptraums, einer tief im (kleineren) Flankenraum,
  // damit dieser auch als Spawn-Option genutzt wird. So würden sich 2-4
  // Spieler im Multiplayer nicht direkt ins Gesicht spawnen.
  // 1.7 ≈ Augenhöhe eines Menschen.
  const spawnPoints = [
    new THREE.Vector3(-28, 1.7, -18),
    new THREE.Vector3(-28, 1.7, 18),
    new THREE.Vector3(0, 1.7, -18),
    new THREE.Vector3(0, 1.7, 18),
    new THREE.Vector3(sideRoomMaxX - 5, 1.7, 8),
  ]

  return {
    group,
    solids,
    spawnPoints,
    ramps: [ramp],
    shootables: [mainGround, sideGround, rampMesh, ...solids.map((s) => s.mesh)],
  }
}
