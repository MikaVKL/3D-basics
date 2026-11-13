import * as THREE from 'three'
import { createConcreteTexture, createCorrugatedTexture, createFloorTexture, createMetalTexture, createWoodTexture, floorOverlay, worldBox, CRATE_TILE, PANEL_TILE } from './surfaceTextures'
import { addEdgeOutline, bakeStaticParts, createWedgeGeometry, type ArenaResult, type Ramp, type Solid } from './arena'

// Karte "Skyline" (Testgerüst, nur über ?map=skyline und nur offline): drei Hochhäuser ohne Boden dazwischen
// (Nebel), Hallen unter den Dächern, Skybridges, Stege, hängende Container, Masten. Alles punktsymmetrisch
// (180° um die Mitte): was für Haus A gebaut wird, entsteht gespiegelt für Haus B.
// Maße siehe Entwurf (Skizze v2); Fenster, Treppenhaus-Feinheiten und Optik folgen.

const FLOOR = 12 // Hallenboden
const HALL_TOP = 17.7 // Unterkante der Dachplatte über den Hallen A/B
const ROOF = 18 // Dach A/B
const ROOF_C = 20 // Dach der Mitte
const WINDOW_SILL = 1 // Brüstung der Fenster (m über dem Boden)
const WINDOW_TOP = 2.2 // Fensterunterkante 1, Oberkante 2,2 m: 2 m breit, 1,2 m hoch (geduckt auf der Brüstung ist der Kopf 1,3 m hoch: man kriecht nicht hindurch)
const BELOW = -60 // Gebäudekörper reichen bis tief in den Nebel

export const SKYLINE_FALL_Y = -20 // darunter: Absturz

// Tageslicht statt Lasertag-Dämmerung (Nutzerwunsch): Sonne, blauer Himmel, heller Dunst, helle Oberflächen.
// Mehrere Vorlagen zum Vergleichen (Nutzer: "sieht nach Baustelle aus"), Wahl über ?look=<name>, Standard "hafen" (Nutzerwahl).
interface SkylineLook {
  clean: boolean // true = lackierte Paneele ohne Schrauben/Schlieren
  background: number
  sky: { horizon: number; middle: number; top: number }
  fog: number
  ambient: number
  skyLight: number
  groundLight: number
  sun: number
  wall: number
  floor: number
  crate: number
  metal: number
  container: number
  edge: number
}

const DAY = { ambient: 0xffffff, skyLight: 0xd3e8ff, groundLight: 0xf0e6d4, sun: 0xfff1d6 }
const BLUE_SKY = { background: 0xbcd8f2, sky: { horizon: 0xe3f0fb, middle: 0xa4cdf2, top: 0x5b97dc }, fog: 0xd2e5f6 }

export const SKYLINE_LOOKS: Record<string, SkylineLook> = {
  // bisher: grauer Beton, helles Holz, rostrote Container
  beton: { clean: false, ...BLUE_SKY, ...DAY, wall: 0xc4cbd3, floor: 0xb9c0c7, crate: 0xdcae6c, metal: 0xaebdcc, container: 0xc4573a, edge: 0x6f8197 },
  // A: weißes Hightech-Gebäude, türkise Kanten und Kisten, helle Böden
  weiss: { clean: true, ...BLUE_SKY, ...DAY, wall: 0xf2f5f8, floor: 0xcfd9e2, crate: 0x2fb5b0, metal: 0x9db2c6, container: 0x1f8f9c, edge: 0x2aa6b0 },
  // B: warmer Sandstein, Terrakotta-Böden, dunkles Holz, blaue Akzente (Mittelmeer-Sonne)
  sand: {
    clean: true,
    background: 0xc9dff0, sky: { horizon: 0xf6ead6, middle: 0xb4d4ee, top: 0x6aa3e0 }, fog: 0xeadfcb,
    ambient: 0xfff6e8, skyLight: 0xe3efff, groundLight: 0xf4d9b4, sun: 0xffe2b0,
    wall: 0xecd9b9, floor: 0xcf8559, crate: 0x8a5a36, metal: 0x4f6f94, container: 0x2f6aa8, edge: 0xa9825a,
  },
  // C: Hafen - dunkler Stahl-Anthrazit, helle Böden, gelbe Warnkisten, orange Container
  hafen: {
    clean: true,
    background: 0xb7d2ea, sky: { horizon: 0xdbe9f5, middle: 0x9ac4ec, top: 0x4f8ed6 }, fog: 0xc8dced,
    ...DAY,
    wall: 0x6c7a8a, floor: 0xd2d6da, crate: 0xf0b92b, metal: 0x3d4652, container: 0xe0672c, edge: 0x2f3a46,
  },
  // D: Pastell-Lowpoly - Mint-Wände, Korallen-Böden, kräftige Kisten (heiter, kein Industrie-Eindruck)
  pastell: {
    clean: true,
    background: 0xc7e3f5, sky: { horizon: 0xeaf6fb, middle: 0xb0dbf4, top: 0x6fb0e8 }, fog: 0xdcedf5,
    ...DAY,
    wall: 0xbfe6d6, floor: 0xf2c7b4, crate: 0xff8f6b, metal: 0x7aa3c8, container: 0x7b6fd0, edge: 0x5fa38c,
  },
}

function chooseLook(): SkylineLook {
  try {
    const name = new URLSearchParams(window.location.search).get('look') ?? 'hafen'
    return SKYLINE_LOOKS[name] ?? SKYLINE_LOOKS.beton
  } catch {
    return SKYLINE_LOOKS.beton
  }
}

export const SKYLINE_LOOK = chooseLook()

// Augenhöhe 1,7 über dem Hallenboden; je zwei Spawns pro Seite in der eigenen Halle
// weit auseinander (vorher 3-4 m Abstand): Westwand Nord/Süd, Mitte Nord, Ostseite vor der Skybridge-Tür
const HALL_SPAWNS: Array<[number, number]> = [
  [-27.5, -6.5],
  [-27.5, 1.5],
  [-21, -6.5],
  [-17.5, -1],
]

export function buildSkylineArena(): ArenaResult {
  const group = new THREE.Group()
  const solids: Solid[] = []
  const ramps: Ramp[] = []
  const shootableExtras: THREE.Object3D[] = []

  const wallMaterial = new THREE.MeshStandardMaterial({ color: SKYLINE_LOOK.wall, map: createConcreteTexture(SKYLINE_LOOK.clean), roughness: 0.95, metalness: 0.0 })
  const crateMaterial = new THREE.MeshStandardMaterial({ color: SKYLINE_LOOK.crate, map: createWoodTexture(), roughness: 0.8, metalness: 0.0 })
  const floorMaterial = new THREE.MeshStandardMaterial({ color: SKYLINE_LOOK.floor, map: createFloorTexture(SKYLINE_LOOK.clean), roughness: 0.85, metalness: 0.0 })
  const metalMaterial = new THREE.MeshStandardMaterial({ color: SKYLINE_LOOK.metal, map: createMetalTexture(), roughness: 0.6, metalness: 0.0 })
  const containerMaterial = new THREE.MeshStandardMaterial({ color: SKYLINE_LOOK.container, map: createCorrugatedTexture(), roughness: 0.7, metalness: 0.0 })

  // Quader von-bis; sym = zusätzlich um 180° um die Mitte gespiegelt (Haus B bzw. zweite Hälfte der Mitte)
  function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, options: { sym?: boolean; cover?: boolean; look?: 'metal' | 'container'; visual?: boolean } = {}) {
    const { sym = true, cover = false, look, visual = false } = options
    const place = (ax0: number, ax1: number, az0: number, az1: number) => {
      const material = cover ? crateMaterial : look === 'metal' ? metalMaterial : look === 'container' ? containerMaterial : wallMaterial
      const tile = cover ? CRATE_TILE : look === 'metal' ? 2 : look === 'container' ? 2.4 : PANEL_TILE
      const mesh = new THREE.Mesh(worldBox(ax1 - ax0, y1 - y0, az1 - az0, tile), material)
      mesh.position.set((ax0 + ax1) / 2, (y0 + y1) / 2, (az0 + az1) / 2)
      addEdgeOutline(mesh, SKYLINE_LOOK.edge)
      group.add(mesh)
      if (!visual) solids.push({ mesh, box: new THREE.Box3().setFromObject(mesh), kind: cover ? 'cover' : undefined })
    }
    place(x0, x1, z0, z1)
    if (sym) place(-x1, -x0, -z1, -z0)
  }


  // Schräge Strebe von a nach b (Stahl, reine Optik ohne Kollision), gespiegelt um die Mitte wie box()
  function strut(a: [number, number, number], b: [number, number, number], thickness = 0.3, sym = true) {
    const place = (p: THREE.Vector3, q: THREE.Vector3) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, p.distanceTo(q)), metalMaterial)
      mesh.position.copy(p).add(q).multiplyScalar(0.5)
      mesh.lookAt(q)
      addEdgeOutline(mesh, SKYLINE_LOOK.edge)
      group.add(mesh)
    }
    const pa = new THREE.Vector3(...a)
    const pb = new THREE.Vector3(...b)
    place(pa, pb)
    if (sym) place(new THREE.Vector3(-a[0], a[1], -a[2]), new THREE.Vector3(-b[0], b[1], -b[2]))
  }

  // Boden-Auflage mit Fliesenmuster: reine Optik 3 cm über der Oberkante (nicht in solids/shootables)
  function floor(x0: number, x1: number, y: number, z0: number, z1: number, sym = true) {
    const place = (ax0: number, ax1: number, az0: number, az1: number) => {
      const mesh = new THREE.Mesh(floorOverlay(ax1 - ax0, az1 - az0), floorMaterial)
      mesh.position.set((ax0 + ax1) / 2, y + 0.03, (az0 + az1) / 2)
      group.add(mesh)
    }
    place(x0, x1, z0, z1)
    if (sym) place(-x1, -x0, -z1, -z0)
  }

  // Wand mit Fenstern: durchgehende Teile zwischen den Fenstern, unter jedem Fenster die Brüstung (1 m), darüber der Sturz.
  // run = Achse, entlang der die Wand läuft; windows = [von, bis] in dieser Achse (Fensterhöhe 1 bis 2,2 m über dem Boden y0).
  // Schüsse gehen durch die Öffnung, Spieler nicht: Brüstung 1 m (Sprung darauf geht), aber die Öffnung ist nur 1,2 m hoch.
  function windowedWall(run: 'x' | 'z', a0: number, a1: number, y0: number, y1: number, t0: number, t1: number, windows: Array<[number, number]>, sym = true) {
    const sorted = [...windows].sort((p, q) => p[0] - q[0])
    const piece = (from: number, to: number, lo: number, hi: number) => {
      if (to - from < 1e-6 || hi - lo < 1e-6) return
      if (run === 'x') box(from, to, lo, hi, t0, t1, { sym })
      else box(t0, t1, lo, hi, from, to, { sym })
    }
    let cursor = a0
    for (const [from, to] of sorted) {
      piece(cursor, from, y0, y1)
      piece(from, to, y0, y0 + WINDOW_SILL)
      piece(from, to, y0 + WINDOW_TOP, y1)
      cursor = to
    }
    piece(cursor, a1, y0, y1)
  }

  // Schräge (Steg, Rampe) mit Sicht-Keil; gespiegelt für sym
  function ramp(minX: number, maxX: number, minZ: number, maxZ: number, axis: 'x' | 'z', ascending: boolean, bottom: number, top: number, sym = true) {
    const place = (rMinX: number, rMaxX: number, rMinZ: number, rMaxZ: number, rAscending: boolean) => {
      ramps.push({ minX: rMinX, maxX: rMaxX, minZ: rMinZ, maxZ: rMaxZ, axis, ascending: rAscending, bottomHeight: bottom, topHeight: top })
      const length = axis === 'x' ? rMaxX - rMinX : rMaxZ - rMinZ
      const width = axis === 'x' ? rMaxZ - rMinZ : rMaxX - rMinX
      const mesh = new THREE.Mesh(createWedgeGeometry(length, width, top - bottom), wallMaterial)
      if (axis === 'x') {
        mesh.rotation.y = rAscending ? 0 : Math.PI
        mesh.position.set(rAscending ? rMinX : rMaxX, bottom, (rMinZ + rMaxZ) / 2)
      } else {
        mesh.rotation.y = rAscending ? -Math.PI / 2 : Math.PI / 2
        mesh.position.set((rMinX + rMaxX) / 2, bottom, rAscending ? rMinZ : rMaxZ)
      }
      addEdgeOutline(mesh, SKYLINE_LOOK.edge)
      group.add(mesh)
      shootableExtras.push(mesh)
    }
    place(minX, maxX, minZ, maxZ, ascending)
    if (sym) place(-maxX, -minX, -maxZ, -minZ, axis === 'x' ? !ascending : !ascending)
  }

  // --- Haus A (und gespiegelt Haus B) ---
  box(-30, -14, BELOW, FLOOR, -9, 9) // Körper bis in den Nebel, Oberseite = Hallenboden
  // Hallenwände (0,8 m); Ostwand mit Tür (3 m breit) zur Skybridge
  box(-30, -29.2, FLOOR, HALL_TOP, -9, 9)
  windowedWall('x', -30, -18, FLOOR, HALL_TOP, -9, -8.2, [[-28.5, -26.5], [-24, -22]]) // Nordwand mit Tür (x -18 .. -15) auf die Außenterrasse, Fenster 1/2
  box(-15, -14, FLOOR, HALL_TOP, -9, -8.2)
  box(-18, -15, 15, HALL_TOP, -9, -8.2)
  windowedWall('x', -30, -14, FLOOR, HALL_TOP, 8.2, 9, [[-29, -27]]) // Südwand, Fenster 3 (am Rampenfuß)
  windowedWall('z', -9, -1.5, FLOOR, HALL_TOP, -14.8, -14, [[-7.7, -5.7], [-4.2, -2.2]]) // Ostwand, Fenster 4/5 (zur Lücke)
  box(-14.8, -14, FLOOR, HALL_TOP, 1.5, 9)
  box(-14.8, -14, 15, HALL_TOP, -1.5, 1.5) // Sturz über der Skybridge-Tür
  // Dachplatte mit Loch über der Rampe (Kopffreiheit)
  box(-30, -21.2, HALL_TOP, ROOF, -9, 9)
  box(-15.7, -14, HALL_TOP, ROOF, -9, 9)
  box(-21.2, -15.7, HALL_TOP, ROOF, -9, 4.1)
  box(-21.2, -15.7, HALL_TOP, ROOF, 8.2, 9)
  // Rampe Halle -> Dach (6 m auf 12,5 m) mit Bord zur Halle, damit man nur von vorne hinaufgeht
  // Rampenfuß 3 m von der Westwand entfernt (vorher 1 m: beim Abbiegen viel zu eng), 3,5 m breit
  ramp(-26, -15.7, 4.5, 8, 'x', true, FLOOR, ROOF)
  box(-26, -15.7, FLOOR, ROOF, 4.3, 4.5)
  box(-15.7, -14.8, FLOOR, HALL_TOP, 4.3, 8.2) // Streifen hinter dem oberen Rampenende zu: sonst läuft man seitlich unter die Rampe
  // Skybridge (Glasgang später): Boden, Wände, Decke
  box(-14, -6, FLOOR - 1, FLOOR, -1.9, 1.9)
  // Glasgang: je drei Scheiben-Öffnungen (2 m) pro Seite, Scheiben selbst folgen (Schüsse gehen vorerst durch)
  windowedWall('x', -14, -6, FLOOR, 15, -1.9, -1.5, [[-13.5, -11.5], [-11, -9], [-8.5, -6.5]])
  windowedWall('x', -14, -6, FLOOR, 15, 1.5, 1.9, [[-13.5, -11.5], [-11, -9], [-8.5, -6.5]])
  box(-14, -6, 15, 15.3, -1.9, 1.9)
  // Deckung in der Skybridge (versetzt links/rechts, 1,9 m Gasse bleiben)
  box(-12.2, -10.8, FLOOR, FLOOR + 1.2, -1.5, -0.4, { cover: true })
  box(-9.2, -7.8, FLOOR, FLOOR + 1.2, 0.4, 1.5, { cover: true })
  // Außenterrasse (offen, Reling): aus der Nordwand von Halle A hinaus, an der Außenseite entlang, durch die Nordwand
  // der Mitte wieder hinein. Gespiegelt: Südseite C -> B (auf der Rampenseite der Halle ist die Wand frei).
  box(-18.2, -1.5, FLOOR - 1, FLOOR, -11.5, -9) // Boden, 2,5 m breit
  box(-6, -1.5, FLOOR - 1, FLOOR, -9, -8) // Stück vor der Tür der Mitte
  box(-18.2, -1.5, FLOOR, FLOOR + 1.1, -11.7, -11.5, { look: 'metal' }) // Reling Außenkante (1,1 m, man kann drüberspringen)
  box(-14, -6, FLOOR, FLOOR + 1.1, -9.2, -9, { look: 'metal' }) // Reling zur Lücke hin
  box(-18.4, -18.2, FLOOR, FLOOR + 1.1, -11.7, -9, { look: 'metal' }) // Reling Westende
  // Pflanzkübel (Kisten 1,1 m) auf der Terrasse, versetzt an Außen- und Innenseite, 1,4 m Gasse
  box(-14.6, -13.2, FLOOR, FLOOR + 1.1, -11.5, -10.4, { cover: true })
  box(-9.5, -8.1, FLOOR, FLOOR + 1.1, -10.1, -9, { cover: true })
  box(-5, -3.6, FLOOR, FLOOR + 1.1, -11.5, -10.4, { cover: true })
  box(-6.2, -6, FLOOR, FLOOR + 1.1, -9, -8, { look: 'metal' })
  box(-1.7, -1.5, FLOOR, FLOOR + 1.1, -11.7, -8, { look: 'metal' }) // Reling Ostende
  floor(-29.2, -14.8, FLOOR, -8.2, 8.2) // Hallenboden
  floor(-14, -6, FLOOR, -1.5, 1.5) // Skybridge
  floor(-18.2, -1.5, FLOOR, -11.5, -9) // Terrasse
  floor(-6, -1.5, FLOOR, -9, -8)
  floor(-30, -21.2, ROOF, -9, 9) // Dach A/B
  floor(-21.2, -15.7, ROOF, -9, 4.1)
  floor(-21.2, -15.7, ROOF, 8.2, 9)
  floor(-15.7, -14, ROOF, -9, 9)
  // Säulen und Deckung in der Halle
  for (const [x, z] of [[-23, -4], [-23, 4], [-19, -4], [-19, 4]]) box(x - 0.6, x + 0.6, FLOOR, HALL_TOP, z - 0.6, z + 0.6)
  box(-22.5, -19.5, FLOOR, FLOOR + 1.2, -0.3, 0.9, { cover: true })
  // Westhälfte war leer: je eine Kiste zwischen den Spawns an der Westwand und vor dem Rampenfuß
  box(-28.7, -27.3, FLOOR, FLOOR + 1.2, -3.6, -2.2, { cover: true })
  box(-27, -25.5, FLOOR, FLOOR + 1.2, 1.6, 2.8, { cover: true })

  // --- Dach A/B: Deckung, Sichtschutzwand ---
  box(-24.3, -21.7, ROOF, ROOF + 1.4, -4.7, -3.3, { cover: true })
  box(-22.7, -21.3, ROOF, ROOF + 1.4, -3.5, -2.1, { cover: true })
  box(-20.3, -17.7, ROOF, ROOF + 1.4, 2.3, 3.7, { cover: true })
  box(-19.2, -16.8, ROOF, ROOF + 1.8, -7.4, -5, { cover: true })
  box(-26.3, -24.7, ROOF, ROOF + 1.4, -1.8, -0.2, { cover: true })
  box(-22.5, -22.1, ROOF, ROOF + 2.4, -2, 3) // Wand: bricht die Längsachse des Dachs

  // --- Kran mit hängendem Container (Zwischenplattform) und Mast ---
  box(-15.6, -14.8, ROOF, 24.4, 3.8, 4.6, { look: 'metal' }) // Kranturm auf dem Dachrand
  box(-15.6, -8.4, 24, 24.4, 4, 4.4, { look: 'metal' }) // Ausleger
  box(-9.3, -9.1, 16, 24, 4.1, 4.3, { look: 'metal' }) // Seil
  box(-13, -7, 13.6, 16, 2.8, 5.5, { look: 'container' }) // Container (Oberseite 16 m)
  box(-16.3, -15.7, ROOF, ROOF + 8, -8.1, -7.5, { look: 'metal' }) // Funkmasten
  box(-28.3, -27.7, ROOF, ROOF + 8, -8.1, -7.5, { look: 'metal' })

  // --- Mitte (Dach C, Halle, Atrium) ---
  box(-6, 6, BELOW, FLOOR, -8, 8, { sym: false })
  box(-6, -5.2, FLOOR, ROOF_C - 0.3, -8, -1.5) // Westwand mit Tür; gespiegelt: Ostwand
  windowedWall('z', 1.5, 8, FLOOR, ROOF_C - 0.3, -6, -5.2, [[3.2, 5.2]]) // Fenster 11 (gespiegelt: 12 in der Ostwand)
  box(-6, -5.2, 15, ROOF_C - 0.3, -1.5, 1.5)
  box(-6, -4.8, FLOOR, ROOF_C - 0.3, -8, -7.2) // Nordwand mit Tür (x -4,8 .. -1,8) zur Terrasse, gespiegelt: Südwand
  windowedWall('x', -1.8, 6, FLOOR, ROOF_C - 0.3, -8, -7.2, [[1.5, 3.5]]) // Fenster 13 (gespiegelt: 14 in der Südwand)
  box(-4.8, -1.8, 15, ROOF_C - 0.3, -8, -7.2)
  // Deckung auf dem Hallenboden der Mitte (1,2 m, je gespiegelt): neben dem Atrium, mit >= 1 m Abstand zu Säulen und Wänden
  box(-2, -0.6, FLOOR, FLOOR + 1.2, -6.2, -4.8, { cover: true })
  box(-4.8, -3.4, FLOOR, FLOOR + 1.2, 2.6, 4, { cover: true })
  box(-6, 6, ROOF_C - 0.3, ROOF_C, -8, -3) // Dachplatte mit Atrium-Loch 6 x 6 m
  box(-6, -3, ROOF_C - 0.3, ROOF_C, -3, 3)
  for (const [x, z] of [[-3.9, -5.6], [3.9, -5.6]]) box(x - 0.6, x + 0.6, FLOOR, ROOF_C - 0.3, z - 0.6, z + 0.6, { sym: false })
  floor(-6, 6, FLOOR, -7.2, 7.2, false) // Hallenboden der Mitte
  floor(-6, 6, ROOF_C, -8, -3) // Dach C (Atrium-Loch bleibt frei)
  floor(-6, -3, ROOF_C, -3, 3)
  // Dach C: Deckung, Mast
  box(-5.1, -2.5, ROOF_C, ROOF_C + 1.4, -6.3, -4.9, { cover: true })
  box(-4.8, -3.2, ROOF_C, ROOF_C + 1.4, 4, 5.6, { cover: true })
  box(-1.2, 1.2, ROOF_C, ROOF_C + 2.4, -6.9, -4.5) // Wasserturm (Block)
  box(-5.3, -4.7, ROOF_C, ROOF_C + 8, -7.3, -6.7, { look: 'metal' })
  // Stege A -> C (Rampe 18 -> 20 m), gespiegelt C -> B
  ramp(-14, -6, -6.25, -3.75, 'x', true, ROOF, ROOF_C)
  // Werbetafeln (Haken-Anker), schweben vor den Dächern
  box(-4, 4, 19, 23, -11.5, -10.5)

  // --- Stützen und Auflager (reine Optik, keine Kollision): Nutzer "Verbindungen nicht verankert" ---
  // Skybridge: zwei Träger unter dem Boden, V-Streben gegen die Hallenwände (x = -14 und -6)
  for (const z of [-1.5, 1.5]) {
    box(-14, -6, 10.3, 11, z - 0.2, z + 0.2, { look: 'metal', visual: true })
    strut([-14, 8.6, z], [-10, 10.4, z])
    strut([-6, 8.6, z], [-10, 10.4, z])
  }
  // Terrassen: Randträger, Konsolen an der Hallenwand (z = -9) bzw. Wand der Mitte (z = -8), Gitterträger über der Lücke
  box(-18.2, -1.5, 10.3, 11, -11.5, -11.1, { look: 'metal', visual: true })
  box(-14, -6, 9.6, 11, -11.3, -10.9, { look: 'metal', visual: true })
  box(-14, -6, 9.6, 11, -9.6, -9.2, { look: 'metal', visual: true })
  for (const x of [-17.2, -15.2]) strut([x, 8.6, -9], [x, 10.4, -11.3])
  for (const x of [-4.6, -2.6]) strut([x, 8.6, -8], [x, 10.4, -11.3])
  strut([-14, 8.6, -9.4], [-12, 10.3, -11.3])
  strut([-6, 8.6, -8.4], [-8, 10.3, -11.3])
  // Steg A -> C (18 -> 20 m): Träger unter dem Keil, V-Streben gegen die Wände von Halle A und der Mitte
  for (const z of [-5.9, -4.1]) box(-14, -6, 17.2, 18, z - 0.2, z + 0.2, { look: 'metal', visual: true })
  strut([-14, 14.9, -5], [-10, 17.2, -5])
  strut([-6, 14.9, -5], [-10, 17.2, -5])
  // Kran: Fußplatte, Knotenblech zwischen Turm und Ausleger, zweites Seil am Container
  box(-16.3, -14.1, ROOF, ROOF + 0.3, 3.3, 5.1, { look: 'metal', visual: true })
  strut([-15.2, 21.4, 4.2], [-11.8, 24, 4.2])
  strut([-15.2, 21.4, 4.2], [-15.2, 24, 4.2], 0.2)
  box(-12.1, -11.9, 16, 24, 4.1, 4.3, { look: 'metal', visual: true })
  // Masten: Fußplatten
  box(-16.8, -15.2, ROOF, ROOF + 0.3, -8.6, -7, { look: 'metal', visual: true })
  box(-28.8, -27.2, ROOF, ROOF + 0.3, -8.6, -7, { look: 'metal', visual: true })
  box(-5.8, -4.2, ROOF_C, ROOF_C + 0.3, -7.8, -6.2, { look: 'metal', visual: true })
  // Werbetafel: zwei Ausleger zurück zum Dach der Mitte
  for (const x of [-2.7, 2.3]) box(x, x + 0.4, 19.3, 19.7, -10.5, -8, { look: 'metal', visual: true })

  group.updateMatrixWorld(true)
  bakeStaticParts(group, new Set())

  const spawnPoints: THREE.Vector3[] = []
  for (const [x, z] of HALL_SPAWNS) spawnPoints.push(new THREE.Vector3(x, FLOOR + 1.7, z))
  for (const [x, z] of HALL_SPAWNS) spawnPoints.push(new THREE.Vector3(-x, FLOOR + 1.7, -z))

  return { group, solids, spawnPoints, ramps, shootables: [...solids.map((s) => s.mesh), ...shootableExtras] }
}
