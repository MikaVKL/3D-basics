import * as THREE from 'three'
import { Palette } from './palette'
import type { WeaponId } from './shared/weapons'

// Waffenmodelle als Kind der Kamera, eins pro Waffe. Ohne Mündungsfeuer:
// Laserwaffen passend zu den Neon-Leuchtspuren.

const REST_POSITION = new THREE.Vector3(0.28, -0.28, -0.5)
const REST_ROTATION_Y = -0.05
const SWITCH_DROP = 0.35 // so weit sinkt die Waffe beim Wechseln

const RECOIL_DURATION = 0.12 // Sekunden
const RECOIL_KICK_Z = 0.08
const RECOIL_KICK_ROTATION = 0.12
const STAB_DURATION = 0.25
const STAB_REACH = 0.22

interface Model {
  group: THREE.Group
  // Unsichtbarer Punkt am Lauf-Ende (Start der Leuchtspur)
  muzzle: THREE.Object3D
  recoilScale: number
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

export class WeaponView {
  readonly group = new THREE.Group()
  private readonly models: Record<WeaponId, Model>
  private current: Model
  private recoilRemaining = 0
  // 0 = im Anschlag, 1 = ganz abgesenkt (Waffenwechsel)
  lowered = 0
  // 0..1 beim Rutschen: Waffe nach innen geneigt und etwas tiefer
  slide = 0

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
    this.models = {
      pistol: this.buildPistol(body, accent),
      rifle: this.buildRifle(body, accent),
      knife: this.buildKnife(body, accent),
    }
    this.current = this.models.pistol
    this.setWeapon('pistol')
    camera.add(this.group)
  }

  private buildPistol(body: THREE.Material, accent: THREE.Material): Model {
    const group = new THREE.Group()
    part(group, body, [0.09, 0.1, 0.32], [0, 0, 0])
    part(group, body, [0.04, 0.04, 0.22], [0, 0.02, -0.27])
    part(group, body, [0.06, 0.16, 0.07], [0, -0.11, 0.09], 0.3)
    part(group, accent, [0.095, 0.015, 0.06], [0, 0.055, 0.05])
    return this.finishModel(group, -0.4, 1)
  }

  private buildRifle(body: THREE.Material, accent: THREE.Material): Model {
    const group = new THREE.Group()
    part(group, body, [0.08, 0.11, 0.55], [0, 0, -0.05])
    part(group, body, [0.035, 0.035, 0.25], [0, 0.02, -0.44])
    part(group, body, [0.05, 0.17, 0.08], [0, -0.13, -0.12], -0.2) // Magazin
    part(group, body, [0.05, 0.14, 0.06], [0, -0.1, 0.12], 0.3) // Griff
    part(group, body, [0.06, 0.1, 0.18], [0, -0.01, 0.3]) // Schaft
    part(group, accent, [0.01, 0.02, 0.36], [-0.042, 0.02, -0.1])
    part(group, body, [0.03, 0.05, 0.03], [0, 0.075, -0.5]) // Korn
    group.position.set(-0.02, -0.04, -0.08)
    return this.finishModel(group, -0.57, 0.6)
  }

  private buildKnife(body: THREE.Material, accent: THREE.Material): Model {
    const group = new THREE.Group()
    const blade = new THREE.MeshStandardMaterial({ color: 0xc9d2dc, roughness: 0.35, metalness: 0.2 })
    part(group, body, [0.04, 0.045, 0.12], [0, 0, 0.02]) // Griff
    part(group, accent, [0.045, 0.09, 0.02], [0, 0.01, -0.05]) // Parierstange
    part(group, blade, [0.012, 0.065, 0.22], [0, 0.01, -0.17])
    part(group, blade, [0.012, 0.035, 0.06], [0, 0.025, -0.3]) // Spitze
    // Flach zur Kamera gekippt, sonst sieht man nur die Klingenkante
    group.position.set(-0.03, -0.02, -0.12)
    group.rotation.set(0.3, 0.35, -1.1)
    return this.finishModel(group, -0.3, 1, true)
  }

  private finishModel(group: THREE.Group, muzzleZ: number, recoilScale: number, stab = false): Model {
    const muzzle = new THREE.Object3D()
    muzzle.position.set(0, 0.02, muzzleZ)
    group.add(muzzle)
    this.group.add(group)
    return { group, muzzle, recoilScale, stab }
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
    this.group.position.y = REST_POSITION.y - SWITCH_DROP * this.lowered - 0.05 * this.slide
    this.group.rotation.z = 0.35 * this.slide
    if (this.current.stab) {
      // Schnell vor, langsamer zurück
      const t = 1 - this.recoilRemaining / STAB_DURATION // 0 -> 1
      const thrust = this.recoilRemaining > 0 ? (t < 0.3 ? t / 0.3 : (1 - t) / 0.7) : 0
      this.group.position.z = REST_POSITION.z - STAB_REACH * thrust
      this.group.position.x = REST_POSITION.x - 0.12 * thrust
      this.group.rotation.x = -this.lowered * 0.6
      return
    }
    const recoil = (this.recoilRemaining / RECOIL_DURATION) * this.current.recoilScale // 1 -> 0
    this.group.position.x = REST_POSITION.x
    this.group.position.z = REST_POSITION.z + RECOIL_KICK_Z * recoil
    this.group.rotation.x = -RECOIL_KICK_ROTATION * recoil - this.lowered * 0.6
  }
}
