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

  // Innere Trennwand: teilt den Hauptraum in zwei Zonen statt einer
  // durchgehend offenen Halle. Zwei durchgehende Abschnitte entlang Z, mit
  // einem begehbaren Durchgang dazwischen (kein Fenster mehr hier drin -
  // das Fenster ist jetzt ein freistehendes Objekt weiter unten, das
  // funktioniert als Deckungselement besser als eine Lücke in der Außenwand).
  const DIVIDER_X = -20
  const DIVIDER_SOLID_SOUTH_Z_MAX = -11
  const DIVIDER_GAP_Z_MAX = -3 // Durchgang: von SOLID_SOUTH_Z_MAX bis hier
  const dividerSouthDepth = DIVIDER_SOLID_SOUTH_Z_MAX - -MAIN_HALF_D
  const dividerNorthDepth = MAIN_HALF_D - DIVIDER_GAP_Z_MAX

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
    { w: WALL_THICKNESS, d: dividerNorthDepth, x: DIVIDER_X, z: DIVIDER_GAP_Z_MAX + dividerNorthDepth / 2 },
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

  // --- Freistehende Wand mit Fenster (Deckung) ---
  // Eine dünne, freistehende Wand mitten im Raum (nicht an eine Außen-/
  // Trennwand angebunden), mit einem echten Fenster-Ausschnitt: Sockel
  // (unten) + Sturz (oben) UND zwei seitliche Pfosten, die den Rahmen
  // schließen - sieht dadurch wirklich wie ein Fenster in einer Wand aus,
  // statt wie ein offener Rahmen ohne Seiten. Nur die Lücke zwischen Sockel
  // und Sturz lässt Sicht/Schuss durch, der Rest blockt komplett.
  function buildWindowWall(centerX: number, centerZ: number, totalWidth: number, windowWidth: number) {
    const THICKNESS = 0.4
    const SILL_HEIGHT = 1.1 // bis hier blockt der Sockel (verhindert Durchlaufen)
    const OPENING_HEIGHT = 1.2 // Sicht-/Schuss-Lücke
    const WALL_TOP = SILL_HEIGHT + OPENING_HEIGHT + 1.1 // Sturz-Oberkante = Gesamthöhe der Wand
    const sidePostWidth = (totalWidth - windowWidth) / 2

    function addPiece(offsetX: number, width: number, bottomY: number, topY: number) {
      const height = topY - bottomY
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, THICKNESS), wallMaterial)
      mesh.position.set(centerX + offsetX, bottomY + height / 2, centerZ)
      group.add(mesh)
      solids.push({ mesh, box: new THREE.Box3().setFromObject(mesh) })
    }

    // Linker und rechter Pfosten: volle Höhe, schließen den Rahmen seitlich.
    addPiece(-(windowWidth + sidePostWidth) / 2, sidePostWidth, 0, WALL_TOP)
    addPiece((windowWidth + sidePostWidth) / 2, sidePostWidth, 0, WALL_TOP)

    // Sockel (unten) + Sturz (oben) über der Fenster-Breite, mit Lücke dazwischen.
    addPiece(0, windowWidth, 0, SILL_HEIGHT)
    addPiece(0, windowWidth, SILL_HEIGHT + OPENING_HEIGHT, WALL_TOP)
  }

  buildWindowWall(9, -15, 8, 3.5)

  // --- L-förmige Deckung ---
  // Zwei Kisten-Arme im rechten Winkel statt einer einzelnen Box - bietet
  // Deckung aus zwei Richtungen gleichzeitig und eine Ecke zum Anlehnen/
  // Umschleichen, statt nur einer geraden Kante.
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
    group.add(armAlongZ)
    solids.push({ mesh: armAlongZ, box: new THREE.Box3().setFromObject(armAlongZ) })
  }

  // --- Deckungs-Kisten (warme Akzentfarbe) ---
  const boxMaterial = new THREE.MeshStandardMaterial({
    color: Palette.accentWarm,
    roughness: 0.6,
    metalness: 0.15,
  })

  // Bewusst UNGLEICHMÄSSIG verteilt (anders große Kisten, kein gespiegeltes
  // Muster) statt symmetrischer Ecken - und bewusst nicht alle quadratisch:
  // lange schmale Barrieren und breite niedrige Wände decken mehr/andere
  // Laufwege ab als lauter gleich große Würfel. Drei Höhen-Kategorien:
  // - 1.4m: bei 1.7m Augenhöhe schaut man im Stehen ~30cm heraus - volle
  //   Deckung nur im Ducken (siehe player.ts), im Stehen kann man draufspringen
  //   (~1.6m Sprunghöhe) und von dort weiterkämpfen. Bewusst nur etwa die
  //   Hälfte der Kisten, damit Ducken auch wirklich einen Unterschied macht.
  // - 1.9m: knapp über Augenhöhe - volle Deckung auch im Stehen, aber (wie
  //   1.4m) noch keine komplette Sichtblockade aus der Distanz.
  // - 2.2m: deutlich höher - blockt die Sicht komplett, kein Draufspringen
  //   möglich. Echte "Wand"-Deckung statt nur Sichtschutz.
  const coverPositions: Array<[number, number, number, number, number]> = [
    // [x, z, breite (X), tiefe (Z), höhe] - Hauptraum (östliche/zentrale Zone)
    [-14, -8, 3, 3, 1.9],
    [-12, 7, 4, 1.5, 1.4], // lang und schmal
    [3, -9, 2.6, 2.6, 1.9],
    [4, 9, 5, 2, 1.4], // breite niedrige Wand
    [-2, 0, 4, 4, 1.9],
    [24, -16, 1.5, 4, 1.4], // schmal und tief
    [22, 16, 2.6, 2.6, 2.2],
    // Hauptraum, westliche Zone (jenseits der Trennwand, Richtung Spawns)
    [-28, -9, 4.5, 1.8, 1.9], // lang und schmal
    [-27, 8, 3, 3, 2.2],
    [-24, -16, 3, 2, 1.9], // zusätzliche Deckung, mehr Gesamtdichte
    [15, -8, 2, 2, 1.4], // zusätzliche Deckung nahe der Haupt-Plattform
    // Flankenraum
    [sideRoomMinX + 6, -5, 2.4, 2.4, 1.9],
    [sideRoomMinX + 13, 7, 2, 4.5, 2.2], // schmal und tief
    [44, -8, 2.2, 2.2, 1.4], // zusätzliche Deckung
  ]

  for (const [x, z, width, depth, height] of coverPositions) {
    const boxGeometry = new THREE.BoxGeometry(width, height, depth)
    const box = new THREE.Mesh(boxGeometry, boxMaterial)
    box.position.set(x, height / 2, z)
    group.add(box)
    solids.push({ mesh: box, box: new THREE.Box3().setFromObject(box) })
  }

  buildLCover(-6, -16, 4, 0.8, 1.6, 1, 1)
  buildLCover(sideRoomMinX + 2, -7, 4, 0.8, 1.6, 1, -1)

  // --- Erhöhte Plattformen + Rampen (echte Höhenstufen, größer als jede
  // Deckungskiste) - geben "King of the Hill"-Punkte mit Überblick. Kühle
  // Struktur-Farbe (wie die Wände), nicht die warme Deckungs-Farbe, damit
  // man Struktur/Deckung optisch unterscheidet.
  //
  // Bewusst als Funktion: die Rampe muss immer recht lang sein (flache
  // Steigung von platformHeight über rampLength) - ist sie zu steil,
  // "berührt" die Spieler-Kollisionsbox (Radius PLAYER_RADIUS) die
  // senkrechte Plattform-Seitenwand schon, bevor die Rampe an dieser Stelle
  // hoch genug ist, und der Spieler bleibt exakt am Übergang stecken (in
  // Tests reproduziert und so behoben) - dieselbe Regel gilt für jede
  // weitere Plattform, daher hier einmal zentral statt pro Kopie neu bedacht.
  function buildPlatformWithRamp(
    centerX: number,
    centerZ: number,
    platformSize: number,
    platformHeight: number,
    rampLength: number,
    rampWidth: number,
    rampAxis: 'x' | 'z',
    rampAscending: boolean
  ): Ramp {
    const platformGeometry = new THREE.BoxGeometry(platformSize, platformHeight, platformSize)
    const platform = new THREE.Mesh(platformGeometry, wallMaterial)
    platform.position.set(centerX, platformHeight / 2, centerZ)
    group.add(platform)
    solids.push({ mesh: platform, box: new THREE.Box3().setFromObject(platform) })

    const platformHalf = platformSize / 2
    // Rampen-Kante an der Plattform sowie Rampen-Start, je nach Achse und
    // Anstiegsrichtung - die Rampe reicht immer exakt bis an die
    // Plattform-Kante heran, damit der Übergang nahtlos ist (kein Sprung).
    const edgeAtPlatform = rampAscending
      ? (rampAxis === 'x' ? centerX : centerZ) - platformHalf
      : (rampAxis === 'x' ? centerX : centerZ) + platformHalf
    const rampStart = rampAscending ? edgeAtPlatform - rampLength : edgeAtPlatform + rampLength
    const rampMin = Math.min(edgeAtPlatform, rampStart)
    const rampMax = Math.max(edgeAtPlatform, rampStart)

    const ramp: Ramp = {
      minX: rampAxis === 'x' ? rampMin : centerX - rampWidth / 2,
      maxX: rampAxis === 'x' ? rampMax : centerX + rampWidth / 2,
      minZ: rampAxis === 'z' ? rampMin : centerZ - rampWidth / 2,
      maxZ: rampAxis === 'z' ? rampMax : centerZ + rampWidth / 2,
      axis: rampAxis,
      ascending: rampAscending,
      bottomHeight: 0,
      topHeight: platformHeight,
    }

    // Sichtbares Rampen-Mesh: ein dreiseitiges Prisma (Keilform), damit die
    // Schräge auch wirklich schräg AUSSIEHT statt wie eine liegende Box.
    // Die Wedge-Geometrie steigt lokal entlang +X an - für eine Z-Achsen-
    // Rampe wird das Mesh um 90° gedreht.
    const rampMesh = new THREE.Mesh(
      createWedgeGeometry(rampLength, rampWidth, platformHeight),
      wallMaterial
    )
    if (rampAxis === 'x') {
      rampMesh.position.set(rampAscending ? rampMin : rampMax, 0, centerZ)
      if (!rampAscending) rampMesh.rotation.y = Math.PI
    } else {
      rampMesh.rotation.y = rampAscending ? -Math.PI / 2 : Math.PI / 2
      rampMesh.position.set(centerX, 0, rampAscending ? rampMin : rampMax)
    }
    group.add(rampMesh)
    shootableExtras.push(rampMesh)

    return ramp
  }

  const shootableExtras: THREE.Object3D[] = []

  const rampToMainPlatform = buildPlatformWithRamp(15, 0, 6, 2.8, 10, 4, 'x', true)

  // Zweite Plattform am Rand der West-Zone (siehe Wunsch nach mehr
  // Rampen/Höhenstufen "am Rand"): etwas kleiner, Rampe steigt entlang Z an.
  const rampToWestPlatform = buildPlatformWithRamp(-23.5, 14, 5, 2.4, 8, 3, 'z', true)

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
    ramps: [rampToMainPlatform, rampToWestPlatform],
    shootables: [mainGround, sideGround, ...shootableExtras, ...solids.map((s) => s.mesh)],
  }
}
