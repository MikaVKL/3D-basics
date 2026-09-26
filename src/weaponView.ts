import * as THREE from 'three'
import { Palette } from './palette'

// Waffenmodell als Kind der Kamera. Ohne Mündungsfeuer: gedacht als
// Laserpistole passend zu den Neon-Leuchtspuren.

const REST_POSITION = new THREE.Vector3(0.28, -0.28, -0.5)
const REST_ROTATION_Y = -0.05

const RECOIL_DURATION = 0.12 // Sekunden
const RECOIL_KICK_Z = 0.08
const RECOIL_KICK_ROTATION = 0.12

export class WeaponView {
  readonly group: THREE.Group
  private muzzle: THREE.Object3D
  private recoilRemaining = 0

  constructor(camera: THREE.Camera) {
    this.group = new THREE.Group()
    this.group.position.copy(REST_POSITION)
    this.group.rotation.y = REST_ROTATION_Y

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: Palette.weaponBody,
      roughness: 0.4,
      metalness: 0.6,
    })
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: Palette.accentNeon,
      emissive: Palette.accentNeon,
      emissiveIntensity: 0.8,
    })

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.32), bodyMaterial)
    this.group.add(body)

    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.22), bodyMaterial)
    barrel.position.set(0, 0.02, -0.27)
    this.group.add(barrel)

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.07), bodyMaterial)
    grip.position.set(0, -0.11, 0.09)
    grip.rotation.x = 0.3
    this.group.add(grip)

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.015, 0.06), accentMaterial)
    stripe.position.set(0, 0.055, 0.05)
    this.group.add(stripe)

    // Unsichtbarer Punkt am Lauf-Ende (Start der Leuchtspur)
    this.muzzle = new THREE.Object3D()
    this.muzzle.position.set(0, 0.02, -0.4)
    this.group.add(this.muzzle)

    camera.add(this.group)
  }

  getMuzzleWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(target)
  }

  playShootEffect() {
    this.recoilRemaining = RECOIL_DURATION
  }

  update(deltaSeconds: number) {
    if (this.recoilRemaining > 0) {
      this.recoilRemaining = Math.max(0, this.recoilRemaining - deltaSeconds)
      const progress = this.recoilRemaining / RECOIL_DURATION // 1 -> 0
      this.group.position.z = REST_POSITION.z + RECOIL_KICK_Z * progress
      this.group.rotation.x = -RECOIL_KICK_ROTATION * progress
    } else {
      this.group.position.z = REST_POSITION.z
      this.group.rotation.x = 0
    }
  }
}
