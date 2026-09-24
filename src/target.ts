import * as THREE from 'three'
import { Palette } from './palette'

// Einfaches Schießziel mit festem Leben: 10 Treffer = Tod. Kein Gegner-
// Verhalten (keine Bewegung/KI) - nur zum Testen, ob Treffererkennung und
// Schaden grundsätzlich funktionieren. Nach dem "Tod" taucht das Ziel nach
// ein paar Sekunden wieder auf, damit man ohne Neuladen weiter testen kann.

const MAX_HEALTH = 10
const RESPAWN_DELAY = 2.5 // Sekunden bis das Ziel nach dem Tod wieder erscheint
const HIT_FLASH_DURATION = 0.08 // Sekunden, wie lange das Ziel bei einem Treffer aufleuchtet

export class Target {
  readonly mesh: THREE.Mesh
  private health = MAX_HEALTH
  private respawnRemaining = 0
  private hitFlashRemaining = 0
  private material: THREE.MeshStandardMaterial

  constructor(position: THREE.Vector3) {
    this.material = new THREE.MeshStandardMaterial({ color: Palette.accentNeon })

    // Kapsel = grobe, aber sofort erkennbare "Figur"-Silhouette, ohne dass
    // wir ein echtes Charaktermodell bauen müssen.
    const geometry = new THREE.CapsuleGeometry(0.3, 1, 4, 8)
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.position.copy(position)

    // Verweis zurück auf dieses Target - so kann die Waffe beim Raycast-
    // Treffer direkt erkennen "das ist ein Ziel" und takeDamage() aufrufen.
    this.mesh.userData.target = this
  }

  get isAlive(): boolean {
    return this.health > 0
  }

  takeDamage(amount: number) {
    if (!this.isAlive) return

    this.health = Math.max(0, this.health - amount)
    this.hitFlashRemaining = HIT_FLASH_DURATION

    if (this.health === 0) {
      this.mesh.visible = false
      this.respawnRemaining = RESPAWN_DELAY
    }
  }

  update(deltaSeconds: number) {
    if (this.respawnRemaining > 0) {
      this.respawnRemaining = Math.max(0, this.respawnRemaining - deltaSeconds)
      if (this.respawnRemaining === 0) {
        this.health = MAX_HEALTH
        this.mesh.visible = true
      }
    }

    if (this.hitFlashRemaining > 0) {
      this.hitFlashRemaining = Math.max(0, this.hitFlashRemaining - deltaSeconds)
      // Beim Treffer kurz weiß aufblitzen, sonst normale Neon-Farbe.
      this.material.color.set(this.hitFlashRemaining > 0 ? 0xffffff : Palette.accentNeon)
    }
  }
}
