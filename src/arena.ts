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
  //
  // Zusätzlich ein ERHÖHTER Einweg-Durchgang auf Höhe der West-Plattform
  // (siehe WEST_PLATFORM_* weiter unten - Werte hier schon vorab benötigt,
  // damit die Wand direkt mit der passenden Öffnung gebaut werden kann):
  // von der Plattform aus läuft man auf Plattformhöhe direkt durch die Wand
  // in den Hauptraum - von der Hauptraum-Seite aus (Bodenhöhe) ist die
  // Öffnung dagegen zu hoch, um hindurchzulaufen, man müsste erst wieder die
  // Rampe nehmen. Bewusst so gebaut, dass Plattform-Kante und Wand direkt
  // aneinander anliegen (kein Spalt) - ein winziger Spalt zwischen einer zu
  // hohen Struktur und einer Wand ist eine Softlock-Falle, in die man
  // fallen und nicht mehr herauskommen kann (genau das war hier der Fall).
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
    // Innere Trennwand (Süd-Abschnitt + Nord-Abschnitt VOR und NACH dem
    // erhöhten Durchgang, siehe oben - der Durchgang selbst kommt gleich
    // danach mit eigener, nicht-voller Höhe)
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

  // --- Erhöhter Einweg-Durchgang in der Trennwand (siehe Konstanten oben) ---
  // Unterhalb: blockt auf Bodenhöhe (Hauptraum-Seite kommt hier nicht durch).
  // Oberhalb: Sturz, damit die Wand über dem Durchgang nicht einfach offen bleibt.
  // Dazwischen (WEST_PLATFORM_HEIGHT bis DOORWAY_TOP) ist die eigentliche
  // Öffnung - exakt auf Plattformhöhe, siehe WEST_PLATFORM_HEIGHT unten.
  const doorwaySillMesh = new THREE.Mesh(
    new THREE.BoxGeometry(WALL_THICKNESS, WEST_PLATFORM_HEIGHT, DOORWAY_Z_MAX - DOORWAY_Z_MIN),
    wallMaterial
  )
  doorwaySillMesh.position.set(DIVIDER_X, WEST_PLATFORM_HEIGHT / 2, WEST_PLATFORM_CENTER_Z)
  group.add(doorwaySillMesh)
  solids.push({ mesh: doorwaySillMesh, box: new THREE.Box3().setFromObject(doorwaySillMesh) })

  const doorwayLintelHeight = WALL_HEIGHT - DOORWAY_TOP
  const doorwayLintelMesh = new THREE.Mesh(
    new THREE.BoxGeometry(WALL_THICKNESS, doorwayLintelHeight, DOORWAY_Z_MAX - DOORWAY_Z_MIN),
    wallMaterial
  )
  doorwayLintelMesh.position.set(DIVIDER_X, DOORWAY_TOP + doorwayLintelHeight / 2, WEST_PLATFORM_CENTER_Z)
  group.add(doorwayLintelMesh)
  solids.push({ mesh: doorwayLintelMesh, box: new THREE.Box3().setFromObject(doorwayLintelMesh) })

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
  // - 2.4m: deutlich über Augenhöhe - volle Deckung auch im Stehen, kein
  //   Draufspringen möglich (~1.6m Sprunghöhe reicht nicht annähernd).
  // - 2.8m: nochmal klar höher - damit auch auf den ersten Blick eindeutig
  //   ist "das ist eine Wand, kein Klettern", nicht nur knapp über der
  //   Sprunghöhe (frühere 1.9m/2.2m-Stufen wirkten dafür zu ähnlich zur
  //   kletterbaren 1.4m-Kategorie und sorgten für Verwechslung).
  const coverPositions: Array<[number, number, number, number, number]> = [
    // [x, z, breite (X), tiefe (Z), höhe] - Hauptraum (östliche/zentrale Zone)
    [-14, -8, 3, 3, 2.4],
    [-12, 7, 4, 1.5, 1.4], // lang und schmal
    [3, -9, 2.6, 2.6, 2.4],
    [4, 9, 5, 2, 1.4], // breite niedrige Wand
    [-2, 0, 4, 4, 2.4],
    [24, -16, 1.5, 4, 1.4], // schmal und tief
    [22, 16, 2.6, 2.6, 2.8],
    // Hauptraum, westliche Zone (jenseits der Trennwand, Richtung Spawns)
    [-28, -9, 4.5, 1.8, 2.4], // lang und schmal
    [-27, 8, 3, 3, 2.8],
    [-24, -16, 3, 2, 2.4], // zusätzliche Deckung, mehr Gesamtdichte
    [15, -8, 2, 2, 1.4], // zusätzliche Deckung nahe der Haupt-Plattform
    // Flankenraum
    [sideRoomMinX + 6, -5, 2.4, 2.4, 2.4],
    [sideRoomMinX + 13, 7, 2, 4.5, 2.8], // schmal und tief
    [44, -8, 2.2, 2.2, 1.4], // zusätzliche Deckung
  ]

  for (const [x, z, width, depth, height] of coverPositions) {
    const boxGeometry = new THREE.BoxGeometry(width, height, depth)
    const box = new THREE.Mesh(boxGeometry, boxMaterial)
    box.position.set(x, height / 2, z)
    group.add(box)
    solids.push({ mesh: box, box: new THREE.Box3().setFromObject(box) })
  }

  // Höhe bewusst auf 1.4m gesenkt (war 1.6m, genau an der Sprunghöhen-
  // Grenze von ~1.604m - dadurch war das Draufspringen unzuverlässig).
  // Jetzt dieselbe zuverlässig kletterbare Höhe wie die 1.4m-Kisten.
  buildLCover(-6, -16, 4, 0.8, 1.4, 1, 1)
  buildLCover(sideRoomMinX + 2, -7, 4, 0.8, 1.4, 1, -1)
  buildLCover(9, 16, 3, 0.7, 1.4, 1, -1)
  buildLCover(50, 2, 3, 0.7, 1.4, -1, -1)

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

    // Randborde an beiden Längsseiten der Rampe: verhindern, dass man
    // SEITLICH in die Rampe hineinläuft. Ohne sie liefert groundHeightAt an
    // der Seitenkante einen Sprung von 0 auf die (teils schon beträchtliche)
    // Rampenhöhe, sobald der Kollisionspunkt die Rampen-Grundfläche von der
    // Seite aus betritt - man "bugt" dann schlagartig nach oben, statt die
    // Schräge hochzulaufen. Die Borde zwingen dazu, nur von vorne (unten)
    // einzusteigen.
    //
    // Zwei Details, die beim ersten Versuch zu einem neuen Stecken-Bug
    // geführt haben (in Tests reproduziert):
    // 1) Die Borde lagen GENAU auf der Rampen-Randlinie (halb innerhalb,
    //    halb außerhalb) - an exakt dieser Stelle lieferte das
    //    Rampen-Höhenfeld UND die Bord-Kollision gleichzeitig einen
    //    Treffer, was zu einem Klemm-Zustand führen konnte. Jetzt liegen
    //    die Borde komplett AUSSERHALB der Rampenbreite (nur die Innenkante
    //    berührt die Randlinie) - die volle Rampenbreite bleibt frei begehbar.
    // 2) Die Borde waren höher als die Plattform-Wand selbst, wodurch an der
    //    Stelle, wo Bord und Plattform aufeinandertreffen, eine Stufe
    //    entstand (kleine Überhang-Falle). Jetzt exakt plattformhoch - das
    //    reicht längst aus, um ein Überspringen von ebenem Boden aus (nur
    //    ~1.6m Sprunghöhe) zu verhindern, und der Übergang zur
    //    Plattform-Wand ist dadurch bündig, ohne Stufe.
    const curbHeight = platformHeight
    const curbThickness = 0.2
    const curbMid = (rampMin + rampMax) / 2
    const curbLength = rampMax - rampMin
    for (const side of [-1, 1] as const) {
      const curbGeometry =
        rampAxis === 'x'
          ? new THREE.BoxGeometry(curbLength, curbHeight, curbThickness)
          : new THREE.BoxGeometry(curbThickness, curbHeight, curbLength)
      const curb = new THREE.Mesh(curbGeometry, wallMaterial)
      const outwardOffset = rampWidth / 2 + curbThickness / 2
      if (rampAxis === 'x') {
        curb.position.set(curbMid, curbHeight / 2, centerZ + side * outwardOffset)
      } else {
        curb.position.set(centerX + side * outwardOffset, curbHeight / 2, curbMid)
      }
      group.add(curb)
      solids.push({ mesh: curb, box: new THREE.Box3().setFromObject(curb) })
    }

    return ramp
  }

  const shootableExtras: THREE.Object3D[] = []

  const rampToMainPlatform = buildPlatformWithRamp(15, 0, 6, 2.8, 10, 4, 'x', true)

  // Zweite Plattform am Rand der West-Zone (siehe Wunsch nach mehr
  // Rampen/Höhenstufen "am Rand"): etwas kleiner, Rampe steigt entlang Z an.
  // Liegt direkt an der Trennwand an (kein Spalt, siehe Kommentar oben bei
  // DIVIDER_X) und mündet oben exakt in den erhöhten Durchgang.
  const rampToWestPlatform = buildPlatformWithRamp(
    WEST_PLATFORM_CENTER_X,
    WEST_PLATFORM_CENTER_Z,
    WEST_PLATFORM_SIZE,
    WEST_PLATFORM_HEIGHT,
    8,
    3,
    'z',
    true
  )

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
