import * as THREE from 'three'
import { Palette } from './palette'
import type { Damageable } from './damageable'
import { TeamColor, type Team } from './team'
import { MAX_HEALTH, MAX_SHIELD, applyDamage, regenerateShield, type Vitals } from './shared/gameRules'

// Ziel-Dummy für den Singleplayer: gleiche Werte wie ein Spieler, Team Rot,
// ohne KI, respawnt automatisch.

const RESPAWN_DELAY = 2.5 // Sekunden
const HIT_FLASH_DURATION = 0.08 // Sekunden

const HEALTH_BAR_WIDTH = 0.8
const HEALTH_BAR_HEIGHT = 0.08
const HEALTH_BAR_Y_OFFSET = 1.05
const SHIELD_BAR_Y_OFFSET = HEALTH_BAR_Y_OFFSET + HEALTH_BAR_HEIGHT + 0.03

export class Target implements Damageable {
  readonly mesh: THREE.Mesh
  readonly team: Team = 'red'
  private vitals: Vitals = { health: MAX_HEALTH, shield: MAX_SHIELD, shieldRegenCooldown: 0 }
  private respawnRemaining = 0
  private hitFlashRemaining = 0
  private material: THREE.MeshStandardMaterial

  // Balken über dem Kopf, pro Frame zur Kamera ausgerichtet (Billboard)
  private healthBarGroup: THREE.Group
  private healthBarFill: THREE.Mesh
  private healthBarFillMaterial: THREE.MeshBasicMaterial
  private shieldBarGroup: THREE.Group
  private shieldBarFill: THREE.Mesh

  constructor(position: THREE.Vector3) {
    this.material = new THREE.MeshStandardMaterial({ color: TeamColor.red })

    const geometry = new THREE.CapsuleGeometry(0.3, 1, 4, 8)
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.position.copy(position)

    this.mesh.userData.damageable = this as Damageable
    this.mesh.userData.team = this.team

    this.healthBarGroup = new THREE.Group()
    this.healthBarGroup.position.set(0, HEALTH_BAR_Y_OFFSET, 0)
    this.mesh.add(this.healthBarGroup)

    const background = new THREE.Mesh(
      new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT),
      new THREE.MeshBasicMaterial({ color: 0x10161f })
    )
    this.healthBarGroup.add(background)

    this.healthBarFillMaterial = new THREE.MeshBasicMaterial({ color: TeamColor.red })
    this.healthBarFill = new THREE.Mesh(
      new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT),
      this.healthBarFillMaterial
    )
    this.healthBarFill.position.z = 0.001 // gegen Z-Fighting
    this.healthBarGroup.add(this.healthBarFill)

    this.shieldBarGroup = new THREE.Group()
    this.shieldBarGroup.position.set(0, SHIELD_BAR_Y_OFFSET, 0)
    this.mesh.add(this.shieldBarGroup)

    const shieldBackground = new THREE.Mesh(
      new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT * 0.6),
      new THREE.MeshBasicMaterial({ color: 0x10161f })
    )
    this.shieldBarGroup.add(shieldBackground)

    this.shieldBarFill = new THREE.Mesh(
      new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT * 0.6),
      // Schild-Farbe wie im HUD (nicht die Team-Farbe, auch wenn gleich)
      new THREE.MeshBasicMaterial({ color: 0x4da6ff })
    )
    this.shieldBarFill.position.z = 0.001
    this.shieldBarGroup.add(this.shieldBarFill)
  }

  get isAlive(): boolean {
    return this.vitals.health > 0
  }

  takeDamage(amount: number) {
    if (!this.isAlive) return
    this.hitFlashRemaining = HIT_FLASH_DURATION
    if (applyDamage(this.vitals, amount)) {
      this.mesh.visible = false
      this.respawnRemaining = RESPAWN_DELAY
    }
  }

  update(deltaSeconds: number, camera: THREE.Camera) {
    if (this.respawnRemaining > 0) {
      this.respawnRemaining = Math.max(0, this.respawnRemaining - deltaSeconds)
      if (this.respawnRemaining === 0) {
        this.vitals = { health: MAX_HEALTH, shield: MAX_SHIELD, shieldRegenCooldown: 0 }
        this.mesh.visible = true
      }
    }

    regenerateShield(this.vitals, deltaSeconds)

    if (this.hitFlashRemaining > 0) {
      this.hitFlashRemaining = Math.max(0, this.hitFlashRemaining - deltaSeconds)
      this.material.color.set(this.hitFlashRemaining > 0 ? 0xffffff : TeamColor.red)
    }

    this.updateHealthBar(camera)
  }

  private updateHealthBar(camera: THREE.Camera) {
    // Ziel ist nicht rotiert -> Kamera-Rotation direkt übernehmen
    this.healthBarGroup.quaternion.copy(camera.quaternion)

    const ratio = this.vitals.health / MAX_HEALTH
    this.healthBarFill.scale.x = ratio
    this.healthBarFillMaterial.color.set(ratio <= 0.3 ? Palette.accentWarm : TeamColor.red)

    this.healthBarGroup.visible = this.mesh.visible

    this.shieldBarGroup.quaternion.copy(camera.quaternion)
    this.shieldBarFill.scale.x = this.vitals.shield / MAX_SHIELD
    this.shieldBarGroup.visible = this.mesh.visible
  }
}
