import * as THREE from 'three'
import { Palette } from './palette'
import type { Damageable } from './damageable'

// Einfaches Schießziel mit festem Leben: 10 Treffer = Tod. Kein Gegner-
// Verhalten (keine Bewegung/KI) - nur zum Testen, ob Treffererkennung und
// Schaden grundsätzlich funktionieren. Nach dem "Tod" taucht das Ziel nach
// ein paar Sekunden wieder auf, damit man ohne Neuladen weiter testen kann.

const MAX_HEALTH = 10
const RESPAWN_DELAY = 2.5 // Sekunden bis das Ziel nach dem Tod wieder erscheint
const HIT_FLASH_DURATION = 0.08 // Sekunden, wie lange das Ziel bei einem Treffer aufleuchtet

const HEALTH_BAR_WIDTH = 0.8
const HEALTH_BAR_HEIGHT = 0.08
const HEALTH_BAR_Y_OFFSET = 1.05 // knapp über dem Kopf der Kapsel

export class Target implements Damageable {
  readonly mesh: THREE.Mesh
  private health = MAX_HEALTH
  private respawnRemaining = 0
  private hitFlashRemaining = 0
  private material: THREE.MeshStandardMaterial

  // Schwebender Lebensbalken über dem Kopf: zwei einfache Ebenen
  // (dunkler Hintergrund + farbige Füllung), keine Texturdatei nötig.
  // Wird pro Frame per Quaternion zur Kamera ausgerichtet ("Billboard").
  private healthBarGroup: THREE.Group
  private healthBarFill: THREE.Mesh
  private healthBarFillMaterial: THREE.MeshBasicMaterial

  constructor(position: THREE.Vector3) {
    this.material = new THREE.MeshStandardMaterial({ color: Palette.accentNeon })

    // Kapsel = grobe, aber sofort erkennbare "Figur"-Silhouette, ohne dass
    // wir ein echtes Charaktermodell bauen müssen.
    const geometry = new THREE.CapsuleGeometry(0.3, 1, 4, 8)
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.position.copy(position)

    // Verweis zurück auf dieses Target über die gemeinsame Damageable-
    // Schnittstelle - so kann die Waffe beim Raycast-Treffer generisch
    // erkennen "das kann Schaden nehmen" und takeDamage() aufrufen, ohne
    // zu wissen, ob es ein Ziel-Dummy oder (später) ein anderer Spieler ist.
    this.mesh.userData.damageable = this as Damageable

    this.healthBarGroup = new THREE.Group()
    this.healthBarGroup.position.set(0, HEALTH_BAR_Y_OFFSET, 0)
    this.mesh.add(this.healthBarGroup)

    const background = new THREE.Mesh(
      new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT),
      new THREE.MeshBasicMaterial({ color: 0x10161f })
    )
    this.healthBarGroup.add(background)

    this.healthBarFillMaterial = new THREE.MeshBasicMaterial({ color: Palette.accentNeon })
    this.healthBarFill = new THREE.Mesh(
      new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT),
      this.healthBarFillMaterial
    )
    this.healthBarFill.position.z = 0.001 // knapp davor, gegen Z-Fighting mit dem Hintergrund
    this.healthBarGroup.add(this.healthBarFill)
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

  update(deltaSeconds: number, camera: THREE.Camera) {
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

    this.updateHealthBar(camera)
  }

  private updateHealthBar(camera: THREE.Camera) {
    // Das Ziel selbst hat keine eigene Rotation, daher richtet das Kopieren
    // der Kamera-Weltrotation den Balken korrekt zur Kamera aus (Billboard) -
    // ohne Rotation des Eltern-Meshes müsste man sonst umrechnen.
    this.healthBarGroup.quaternion.copy(camera.quaternion)

    const ratio = this.health / MAX_HEALTH
    this.healthBarFill.scale.x = ratio
    this.healthBarFillMaterial.color.set(ratio <= 0.3 ? Palette.accentWarm : Palette.accentNeon)

    // Nur sichtbar, solange das Ziel selbst lebt/sichtbar ist.
    this.healthBarGroup.visible = this.mesh.visible
  }
}
