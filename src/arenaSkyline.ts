import * as THREE from 'three'
import { createCrateTexture, createPanelTexture, worldBox, CRATE_TILE, PANEL_TILE } from './surfaceTextures'
import { addEdgeOutline, bakeStaticParts, createWedgeGeometry, type ArenaResult, type Ramp, type Solid } from './arena'

// Karte "Skyline" (Testgerüst, nur über ?map=skyline und nur offline): drei Hochhäuser ohne Boden dazwischen
// (Nebel), Hallen unter den Dächern, Skybridges, Stege, hängende Container, Masten. Alles punktsymmetrisch
// (180° um die Mitte): was für Haus A gebaut wird, entsteht gespiegelt für Haus B.
// Maße siehe Entwurf (Skizze v2); Fenster, Treppenhaus-Feinheiten und Optik folgen.

const FLOOR = 12 // Hallenboden
const HALL_TOP = 17.7 // Unterkante der Dachplatte über den Hallen A/B
const ROOF = 18 // Dach A/B
const ROOF_C = 20 // Dach der Mitte
const BELOW = -60 // Gebäudekörper reichen bis tief in den Nebel

export const SKYLINE_FALL_Y = -20 // darunter: Absturz

// Tageslicht statt Lasertag-Dämmerung (Nutzerwunsch): Sonne, blauer Himmel, heller Dunst, helle Oberflächen
export const SKYLINE_LOOK = {
  background: 0xbcd8f2,
  sky: { horizon: 0xe3f0fb, middle: 0xa4cdf2, top: 0x5b97dc },
  fog: 0xd2e5f6,
  ambient: 0xffffff,
  skyLight: 0xd3e8ff,
  groundLight: 0xf0e6d4,
  sun: 0xfff1d6,
  wall: 0xc4cbd3, // heller Beton
  crate: 0xdcae6c, // helles Holz
  edge: 0x6f8197, // Kanten dezent statt Neon
}

// Augenhöhe 1,7 über dem Hallenboden; je zwei Spawns pro Seite in der eigenen Halle
const HALL_SPAWNS: Array<[number, number]> = [
  [-26, -5.5],
  [-26, -2],
  [-23, 0.2],
  [-22.5, -6],
]

export function buildSkylineArena(): ArenaResult {
  const group = new THREE.Group()
  const solids: Solid[] = []
  const ramps: Ramp[] = []
  const shootableExtras: THREE.Object3D[] = []

  const wallMaterial = new THREE.MeshStandardMaterial({ color: SKYLINE_LOOK.wall, map: createPanelTexture(), roughness: 0.9, metalness: 0.0 })
  const crateMaterial = new THREE.MeshStandardMaterial({ color: SKYLINE_LOOK.crate, map: createCrateTexture(), roughness: 0.8, metalness: 0.0 })

  // Quader von-bis; sym = zusätzlich um 180° um die Mitte gespiegelt (Haus B bzw. zweite Hälfte der Mitte)
  function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, options: { sym?: boolean; cover?: boolean } = {}) {
    const { sym = true, cover = false } = options
    const place = (ax0: number, ax1: number, az0: number, az1: number) => {
      const material = cover ? crateMaterial : wallMaterial
      const mesh = new THREE.Mesh(worldBox(ax1 - ax0, y1 - y0, az1 - az0, cover ? CRATE_TILE : PANEL_TILE), material)
      mesh.position.set((ax0 + ax1) / 2, (y0 + y1) / 2, (az0 + az1) / 2)
      addEdgeOutline(mesh, SKYLINE_LOOK.edge)
      group.add(mesh)
      solids.push({ mesh, box: new THREE.Box3().setFromObject(mesh), kind: cover ? 'cover' : undefined })
    }
    place(x0, x1, z0, z1)
    if (sym) place(-x1, -x0, -z1, -z0)
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
  box(-30, -14, FLOOR, HALL_TOP, -9, -8.2)
  box(-30, -14, FLOOR, HALL_TOP, 8.2, 9)
  box(-14.8, -14, FLOOR, HALL_TOP, -9, -1.5)
  box(-14.8, -14, FLOOR, HALL_TOP, 1.5, 9)
  box(-14.8, -14, 15, HALL_TOP, -1.5, 1.5) // Sturz über der Tür
  // Dachplatte mit Loch über der Rampe (Kopffreiheit)
  box(-30, -21.2, HALL_TOP, ROOF, -9, 9)
  box(-15.7, -14, HALL_TOP, ROOF, -9, 9)
  box(-21.2, -15.7, HALL_TOP, ROOF, -9, 4.6)
  box(-21.2, -15.7, HALL_TOP, ROOF, 8.2, 9)
  // Rampe Halle -> Dach (6 m auf 12,5 m) mit Bord zur Halle, damit man nur von vorne hinaufgeht
  ramp(-28.2, -15.7, 5, 8, 'x', true, FLOOR, ROOF)
  box(-28.2, -15.7, FLOOR, ROOF, 4.8, 5)
  // Skybridge (Glasgang später): Boden, Wände, Decke
  box(-14, -6, FLOOR - 1, FLOOR, -1.9, 1.9)
  box(-14, -6, FLOOR, 15, -1.9, -1.5)
  box(-14, -6, FLOOR, 15, 1.5, 1.9)
  box(-14, -6, 15, 15.3, -1.9, 1.9)
  // Säulen und Deckung in der Halle
  for (const [x, z] of [[-23, -4], [-23, 4], [-19, -4], [-19, 4]]) box(x - 0.6, x + 0.6, FLOOR, HALL_TOP, z - 0.6, z + 0.6)
  box(-22.5, -19.5, FLOOR, FLOOR + 1.2, -0.3, 0.9, { cover: true })

  // --- Dach A/B: Deckung, Sichtschutzwand ---
  box(-24.3, -21.7, ROOF, ROOF + 1.4, -4.7, -3.3, { cover: true })
  box(-22.7, -21.3, ROOF, ROOF + 1.4, -3.5, -2.1, { cover: true })
  box(-20.3, -17.7, ROOF, ROOF + 1.4, 2.3, 3.7, { cover: true })
  box(-19.2, -16.8, ROOF, ROOF + 1.8, -7.4, -5, { cover: true })
  box(-26.3, -24.7, ROOF, ROOF + 1.4, -1.8, -0.2, { cover: true })
  box(-22.5, -22.1, ROOF, ROOF + 2.4, -2, 3) // Wand: bricht die Längsachse des Dachs

  // --- Kran mit hängendem Container (Zwischenplattform) und Mast ---
  box(-15.6, -14.8, ROOF, 24.4, 3.8, 4.6) // Kranturm auf dem Dachrand
  box(-15.6, -8.4, 24, 24.4, 4, 4.4) // Ausleger
  box(-9.3, -9.1, 16, 24, 4.1, 4.3) // Seil
  box(-13, -7, 13.6, 16, 2.8, 5.5) // Container (Oberseite 16 m)
  box(-16.3, -15.7, ROOF, ROOF + 8, -8.1, -7.5) // Funkmasten
  box(-28.3, -27.7, ROOF, ROOF + 8, -8.1, -7.5)

  // --- Mitte (Dach C, Halle, Atrium) ---
  box(-6, 6, BELOW, FLOOR, -8, 8, { sym: false })
  box(-6, -5.2, FLOOR, ROOF_C - 0.3, -8, -1.5) // Westwand mit Tür; gespiegelt: Ostwand
  box(-6, -5.2, FLOOR, ROOF_C - 0.3, 1.5, 8)
  box(-6, -5.2, 15, ROOF_C - 0.3, -1.5, 1.5)
  box(-6, 6, FLOOR, ROOF_C - 0.3, -8, -7.2) // Nordwand, gespiegelt: Südwand
  box(-6, 6, ROOF_C - 0.3, ROOF_C, -8, -3) // Dachplatte mit Atrium-Loch 6 x 6 m
  box(-6, -3, ROOF_C - 0.3, ROOF_C, -3, 3)
  for (const [x, z] of [[-3.9, -5.6], [3.9, -5.6]]) box(x - 0.6, x + 0.6, FLOOR, ROOF_C - 0.3, z - 0.6, z + 0.6, { sym: false })
  // Dach C: Deckung, Mast
  box(-5.1, -2.5, ROOF_C, ROOF_C + 1.4, -6.3, -4.9, { cover: true })
  box(-4.8, -3.2, ROOF_C, ROOF_C + 1.4, 4, 5.6, { cover: true })
  box(-1.2, 1.2, ROOF_C, ROOF_C + 2.4, -6.9, -4.5) // Wasserturm (Block)
  box(-5.3, -4.7, ROOF_C, ROOF_C + 8, -7.3, -6.7)
  // Stege A -> C (Rampe 18 -> 20 m), gespiegelt C -> B
  ramp(-14, -6, -6.25, -3.75, 'x', true, ROOF, ROOF_C)
  // Werbetafeln (Haken-Anker), schweben vor den Dächern
  box(-4, 4, 19, 23, -11.5, -10.5)

  group.updateMatrixWorld(true)
  bakeStaticParts(group, new Set())

  const spawnPoints: THREE.Vector3[] = []
  for (const [x, z] of HALL_SPAWNS) spawnPoints.push(new THREE.Vector3(x, FLOOR + 1.7, z))
  for (const [x, z] of HALL_SPAWNS) spawnPoints.push(new THREE.Vector3(-x, FLOOR + 1.7, -z))

  return { group, solids, spawnPoints, ramps, shootables: [...solids.map((s) => s.mesh), ...shootableExtras] }
}
