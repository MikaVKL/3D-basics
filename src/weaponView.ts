import * as THREE from 'three'
import { Palette } from './palette'
import type { WeaponId } from './shared/weapons'

// Waffenmodelle als Kind der Kamera, eins pro Waffe. Ohne Mündungsfeuer:
// Laserwaffen passend zu den Neon-Leuchtspuren.

const REST_POSITION = new THREE.Vector3(0.28, -0.28, -0.5)
const REST_ROTATION_Y = -0.05
// Beim Zielen liegt die Visierlinie (Oberkante von Kimme und Korn) knapp unter
// der Bildmitte; x/y legt jedes Modell selbst fest (aimX/aimY), z gilt für alle
const AIM_Z = -0.42
const AIM_SIGHT_DROP = 0.006
const SWITCH_DROP = 0.35 // so weit sinkt die Waffe beim Wechseln

const RECOIL_DURATION = 0.12 // Sekunden
const RECOIL_KICK_Z = 0.08
const RECOIL_KICK_ROTATION = 0.12
const STAB_DURATION = 0.25
const STAB_REACH = 0.22

// Helles Korn (wie der weiße Punkt an echten Visieren): sonst geht es im Dunkel der Waffe unter
const SIGHT_DOT = new THREE.MeshStandardMaterial({ color: 0xf2f6fa, emissive: 0xf2f6fa, emissiveIntensity: 0.5 })

// Gemeinsame Waffenmaterialien: heller Schlitten/Gehäuse, dunklerer Rahmen, dunkler Griff,
// Rillen. Sie leuchten leicht mit, sonst wären sie im Dämmerlicht nur schwarze Schatten.
function gunMaterial(color: number, roughness: number, metalness: number, glow: number) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive: color, emissiveIntensity: glow })
}
const METAL = gunMaterial(0x7a8ba2, 0.4, 0.5, 0.3)
const FRAME = gunMaterial(0x4c596b, 0.45, 0.5, 0.3)
const GRIP = gunMaterial(0x3a4350, 0.85, 0.1, 0.4)
const GROOVE = gunMaterial(0x1a2028, 0.6, 0.4, 0)

interface Model {
  group: THREE.Group
  // Unsichtbarer Punkt am Lauf-Ende (Start der Leuchtspur)
  muzzle: THREE.Object3D
  recoilScale: number
  // Verschiebung der Waffe zum Zielen, damit die Visierlinie in der Bildmitte liegt
  aimX: number
  aimY: number
  // Messer: Stoß nach vorn statt Rückstoß
  stab: boolean
}

function part(
  group: THREE.Group,
  material: THREE.Material,
  size: [number, number, number],
  position: [number, number, number],
  rotationX = 0
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
  mesh.position.set(...position)
  mesh.rotation.x = rotationX
  group.add(mesh)
}

// Nachlade-Bewegung: 0..1 Fortschritt -> Stärke der Pose (weich ein/aus)
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function reloadEnvelope(progress: number): number {
  if (progress <= 0) return 0
  return smoothstep(0, 0.15, progress) * (1 - smoothstep(0.8, 1, progress))
}

// Kurzer Ruck um einen Zeitpunkt des Nachladens
function reloadBump(progress: number, at: number): number {
  return progress <= 0 ? 0 : Math.exp(-(((progress - at) / 0.05) ** 2))
}

export class WeaponView {
  readonly group = new THREE.Group()
  private readonly models: Record<WeaponId, Model>
  private current: Model
  private readonly accent: THREE.MeshStandardMaterial
  private recoilRemaining = 0
  // 0 = im Anschlag, 1 = ganz abgesenkt (Waffenwechsel)
  lowered = 0
  // 0..1 beim Rutschen: Waffe nach innen geneigt und etwas tiefer
  slide = 0
  // 0..1 beim Zielen: Waffe wandert in die Bildmitte
  aim = 0
  // Fortschritt des Nachladens 0..1 (0 = nicht beim Nachladen)
  reload = 0

  constructor(camera: THREE.Camera) {
    this.group.position.copy(REST_POSITION)
    this.group.rotation.y = REST_ROTATION_Y

    const body = new THREE.MeshStandardMaterial({
      color: Palette.weaponBody,
      roughness: 0.4,
      metalness: 0.6,
    })
    const accent = new THREE.MeshStandardMaterial({
      color: Palette.accentNeon,
      emissive: Palette.accentNeon,
      emissiveIntensity: 0.8,
    })
    this.accent = accent
    this.models = {
      pistol: this.buildPistol(body, accent),
      rifle: this.buildRifle(body, accent),
      shotgun: this.buildShotgun(accent),
      knife: this.buildKnife(body, accent),
    }
    this.current = this.models.pistol
    this.setWeapon('pistol')
    camera.add(this.group)
  }

  setTeamColor(color: number) {
    this.accent.color.setHex(color)
    this.accent.emissive.setHex(color)
  }

  private buildPistol(body: THREE.Material, accent: THREE.Material): Model {
    const group = new THREE.Group()
    // Zweifarbig wie eine echte Pistole: dunkler Schlitten, hellerer Rahmen, schwarzer Griff
    const slide = METAL
    const grip = GRIP
    const groove = GROOVE
    part(group, slide, [0.07, 0.075, 0.49], [0, 0.0175, -0.085]) // Schlitten
    part(group, body, [0.032, 0.032, 0.05], [0, 0.015, -0.355]) // Laufmündung
    part(group, accent, [0.04, 0.04, 0.012], [0, 0.015, -0.385]) // Mündungsring
    const frame = FRAME
    part(group, frame, [0.06, 0.04, 0.34], [0, -0.04, -0.01]) // Rahmen
    part(group, frame, [0.055, 0.03, 0.12], [0, -0.035, -0.2]) // Rahmen vorn (Schiene)
    part(group, grip, [0.056, 0.16, 0.075], [0, -0.13, 0.09], 0.25) // Griff
    // Abzugsbügel und Abzug
    part(group, frame, [0.012, 0.05, 0.012], [0, -0.085, -0.07])
    part(group, frame, [0.012, 0.012, 0.1], [0, -0.108, -0.015])
    part(group, groove, [0.01, 0.03, 0.012], [0, -0.075, 0.02])
    // Rillen am hinteren Schlitten und Leuchtstreifen an den Seiten (statt Fleck oben)
    for (const z of [0.08, 0.105, 0.13]) part(group, groove, [0.074, 0.06, 0.01], [0, 0.0175, z])
    part(group, accent, [0.074, 0.01, 0.26], [0, 0.03, -0.12])
    part(group, accent, [0.062, 0.012, 0.02], [0, -0.075, 0.12], 0.25) // Griffkante
    part(group, frame, [0.016, 0.022, 0.024], [0, 0.045, 0.172]) // Hahn
    // Visier: Korn vorn auf dem Schlitten, zwei Kimmenpfosten hinten
    // (alle Oberkanten bei y 0,075, damit die Visierlinie parallel zum Lauf liegt)
    part(group, SIGHT_DOT, [0.014, 0.035, 0.02], [0, 0.0575, -0.31])
    part(group, slide, [0.02, 0.025, 0.02], [-0.022, 0.0625, 0.14])
    part(group, slide, [0.02, 0.025, 0.02], [0.022, 0.0625, 0.14])
    return this.finishModel(group, -0.4, 1, false, 0.075)
  }

  private buildRifle(body: THREE.Material, accent: THREE.Material): Model {
    void body
    const group = new THREE.Group()
    part(group, METAL, [0.08, 0.07, 0.4], [0, 0.02, -0.02]) // oberes Gehäuse
    part(group, FRAME, [0.075, 0.05, 0.32], [0, -0.04, 0]) // unteres Gehäuse
    part(group, FRAME, [0.07, 0.07, 0.28], [0, 0.01, -0.36]) // Handschutz
    for (const z of [-0.29, -0.34, -0.39, -0.44]) part(group, GROOVE, [0.074, 0.025, 0.022], [0, 0.015, z]) // Lüftungsschlitze
    part(group, FRAME, [0.03, 0.03, 0.1], [0, 0.02, -0.54]) // Lauf
    part(group, accent, [0.04, 0.04, 0.012], [0, 0.02, -0.592]) // Mündungsring
    part(group, GRIP, [0.05, 0.17, 0.08], [0, -0.13, -0.12], -0.2) // Magazin
    part(group, accent, [0.052, 0.012, 0.06], [0, -0.22, -0.145], -0.2) // Magazinkante
    part(group, GRIP, [0.05, 0.14, 0.06], [0, -0.1, 0.12], 0.3) // Griff
    // Abzugsbügel und Abzug
    part(group, FRAME, [0.012, 0.04, 0.012], [0, -0.085, 0.0])
    part(group, FRAME, [0.012, 0.012, 0.1], [0, -0.103, 0.045])
    part(group, GROOVE, [0.01, 0.03, 0.012], [0, -0.07, 0.06])
    // Auswurföffnung, Spanngriff, Leuchtstreifen an den Seiten
    part(group, GROOVE, [0.082, 0.03, 0.07], [0, 0.03, 0.05])
    part(group, FRAME, [0.09, 0.016, 0.03], [0, 0.04, 0.17])
    part(group, accent, [0.084, 0.01, 0.22], [0, 0.04, -0.14])
    // Schaft: Stützrohr, Schaftkappe
    part(group, METAL, [0.04, 0.04, 0.12], [0, 0.0, 0.26])
    part(group, FRAME, [0.06, 0.1, 0.18], [0, -0.01, 0.34])
    part(group, GRIP, [0.065, 0.11, 0.02], [0, -0.01, 0.44])
    // Visier: Korn vorn, Kimme hinten (Oberkante y 0,1)
    part(group, SIGHT_DOT, [0.03, 0.05, 0.03], [0, 0.075, -0.5])
    part(group, METAL, [0.02, 0.045, 0.03], [-0.025, 0.0775, 0.1])
    part(group, METAL, [0.02, 0.045, 0.03], [0.025, 0.0775, 0.1])
    group.position.set(-0.02, -0.04, -0.08)
    return this.finishModel(group, -0.57, 0.6, false, 0.1)
  }

  // Vorderlader-Pumpgun: Rohr mit Magazinrohr darunter, Pumpgriff, Schrotpatronen seitlich
  private buildShotgun(accent: THREE.Material): Model {
    const group = new THREE.Group()
    part(group, METAL, [0.075, 0.08, 0.3], [0, 0.01, 0.0]) // Gehäuse
    part(group, FRAME, [0.07, 0.04, 0.26], [0, -0.05, 0.02]) // unteres Gehäuse
    part(group, FRAME, [0.04, 0.04, 0.55], [0, 0.025, -0.42]) // Lauf
    part(group, METAL, [0.032, 0.032, 0.46], [0, -0.02, -0.38]) // Magazinrohr
    part(group, accent, [0.05, 0.05, 0.012], [0, 0.025, -0.696]) // Mündungsring
    part(group, accent, [0.038, 0.038, 0.01], [0, -0.02, -0.612]) // Rohrkappe
    part(group, GRIP, [0.066, 0.06, 0.2], [0, -0.02, -0.28]) // Pumpgriff
    for (const z of [-0.2, -0.24, -0.28, -0.32, -0.36]) part(group, GROOVE, [0.07, 0.064, 0.008], [0, -0.02, z])
    part(group, GROOVE, [0.082, 0.03, 0.08], [0, 0.025, 0.02]) // Auswurföffnung
    part(group, accent, [0.084, 0.01, 0.16], [0, 0.04, -0.12]) // Leuchtstreifen
    // Schrotpatronen in der Seitenwand (Leuchtkappen in Teamfarbe)
    for (const z of [-0.06, -0.015, 0.03, 0.075]) part(group, accent, [0.088, 0.02, 0.02], [0, -0.025, z])
    // Abzugsbügel, Abzug, Griff
    part(group, FRAME, [0.012, 0.04, 0.012], [0, -0.085, 0.0])
    part(group, FRAME, [0.012, 0.012, 0.1], [0, -0.103, 0.045])
    part(group, GROOVE, [0.01, 0.03, 0.012], [0, -0.07, 0.06])
    part(group, GRIP, [0.05, 0.14, 0.06], [0, -0.1, 0.15], 0.3)
    // Schaft
    part(group, METAL, [0.04, 0.05, 0.1], [0, 0.005, 0.22])
    part(group, FRAME, [0.06, 0.1, 0.22], [0, -0.01, 0.35])
    part(group, GRIP, [0.065, 0.12, 0.02], [0, -0.01, 0.47])
    // Visier: Perlkorn vorn auf dem Lauf, Kimmenpfosten hinten (Oberkante y 0,075)
    part(group, SIGHT_DOT, [0.016, 0.03, 0.016], [0, 0.06, -0.66])
    part(group, METAL, [0.02, 0.025, 0.02], [-0.022, 0.0625, 0.12])
    part(group, METAL, [0.02, 0.025, 0.02], [0.022, 0.0625, 0.12])
    group.position.set(-0.02, -0.04, -0.08)
    return this.finishModel(group, -0.72, 1.2, false, 0.075)
  }

  private buildKnife(body: THREE.Material, accent: THREE.Material): Model {
    void body
    const group = new THREE.Group()
    const blade = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.3, metalness: 0.3, emissive: 0xdfe6ee, emissiveIntensity: 0.2 })
    part(group, GRIP, [0.04, 0.045, 0.12], [0, 0, 0.02]) // Griff
    for (const z of [-0.01, 0.025, 0.06]) part(group, GROOVE, [0.044, 0.049, 0.01], [0, 0, z]) // Griffrillen
    part(group, FRAME, [0.05, 0.05, 0.025], [0, 0, 0.095]) // Knauf
    part(group, METAL, [0.048, 0.1, 0.022], [0, 0.01, -0.05]) // Parierstange
    part(group, accent, [0.052, 0.012, 0.026], [0, 0.065, -0.05]) // Leuchtkante oben
    part(group, blade, [0.012, 0.065, 0.18], [0, 0.01, -0.15]) // Klinge
    part(group, blade, [0.012, 0.05, 0.07], [0, 0.017, -0.275])
    part(group, blade, [0.012, 0.03, 0.05], [0, 0.027, -0.335]) // Spitze
    part(group, accent, [0.014, 0.01, 0.2], [0, 0.015, -0.17]) // Leuchtrille
    part(group, GROOVE, [0.014, 0.008, 0.2], [0, -0.0175, -0.16]) // Schneide
    // Flach zur Kamera gekippt, sonst sieht man nur die Klingenkante
    group.position.set(-0.03, -0.02, -0.12)
    group.rotation.set(0.3, 0.35, -1.1)
    return this.finishModel(group, -0.3, 1, true)
  }

  // sightTop: Oberkante der Visierung im Modell (Messer: keine, Zielen gesperrt)
  private finishModel(group: THREE.Group, muzzleZ: number, recoilScale: number, stab = false, sightTop = 0): Model {
    const muzzle = new THREE.Object3D()
    muzzle.position.set(0, 0.02, muzzleZ)
    group.add(muzzle)
    this.group.add(group)
    const aimX = -group.position.x
    const aimY = -(group.position.y + sightTop) - AIM_SIGHT_DROP
    return { group, muzzle, recoilScale, aimX, aimY, stab }
  }

  setWeapon(id: WeaponId) {
    for (const [modelId, model] of Object.entries(this.models)) model.group.visible = modelId === id
    this.current = this.models[id]
    this.recoilRemaining = 0
  }

  getMuzzleWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.current.muzzle.getWorldPosition(target)
  }

  playShootEffect() {
    this.recoilRemaining = this.current.stab ? STAB_DURATION : RECOIL_DURATION
  }

  update(deltaSeconds: number) {
    this.recoilRemaining = Math.max(0, this.recoilRemaining - deltaSeconds)
    const restX = REST_POSITION.x + (this.current.aimX - REST_POSITION.x) * this.aim
    const restY = REST_POSITION.y + (this.current.aimY - REST_POSITION.y) * this.aim
    const restZ = REST_POSITION.z + (AIM_Z - REST_POSITION.z) * this.aim
    // Nachladen: Waffe kippt zur Seite und hoch (weich ein/aus), mit einem
    // kleinen Ruck beim Magazin-Lösen (30 %) und beim Einrasten (75 %)
    const reloadPose = reloadEnvelope(this.reload)
    const reloadJolt = reloadBump(this.reload, 0.3) + reloadBump(this.reload, 0.75)
    this.group.position.y = restY - SWITCH_DROP * this.lowered - 0.05 * this.slide - 0.04 * reloadPose - 0.025 * reloadJolt
    this.group.rotation.y = REST_ROTATION_Y * (1 - this.aim)
    // Beim Wechsel leicht zur Seite kippen, damit das Absenken nicht steif wirkt
    this.group.rotation.z = 0.35 * this.slide + 0.3 * this.lowered - 0.55 * reloadPose
    if (this.current.stab) {
      // Schnell vor, langsamer zurück
      const t = 1 - this.recoilRemaining / STAB_DURATION // 0 -> 1
      const thrust = this.recoilRemaining > 0 ? (t < 0.3 ? t / 0.3 : (1 - t) / 0.7) : 0
      this.group.position.z = restZ - STAB_REACH * thrust
      this.group.position.x = restX - 0.12 * thrust
      this.group.rotation.x = -this.lowered * 0.6
      return
    }
    const recoil = (this.recoilRemaining / RECOIL_DURATION) * this.current.recoilScale // 1 -> 0
    this.group.position.x = restX - 0.05 * reloadPose
    this.group.position.z = restZ + RECOIL_KICK_Z * recoil + 0.03 * reloadJolt
    this.group.rotation.x = -RECOIL_KICK_ROTATION * recoil - this.lowered * 0.6 + 0.35 * reloadPose - 0.08 * reloadJolt
  }
}
