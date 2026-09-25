import * as THREE from 'three'
import { Palette } from './palette'
import type { Damageable } from './damageable'
import { TeamColor, type Team } from './team'
import { MAX_HEALTH, MAX_SHIELD, applyDamage, regenerateShield, type Vitals } from './shared/gameRules'

// Schießziel mit denselben Werten wie der echte Spieler (100 HP + 25
// Schild, siehe player.ts) - vorher hatte es nur 10 HP und starb bei 15
// Schaden/Treffer in einem Schuss, was sich als Übungsziel unrealistisch
// anfühlte. Kein Gegner-Verhalten (keine Bewegung/KI) - nur zum Testen, ob
// Treffererkennung/Schaden/Schild-Absorption grundsätzlich funktionieren.
// Nach dem "Tod" taucht das Ziel nach ein paar Sekunden wieder auf, damit
// man ohne Neuladen weiter testen kann.
//
// Steht bis zum echten Multiplayer als Platzhalter für "das gegnerische
// Team" - fest dem roten Team zugeordnet (der Spieler ist blau, siehe
// playerAvatar.ts), damit sich das Team-System/Kill-Counter schon jetzt
// im Singleplayer sinnvoll testen lässt.

const RESPAWN_DELAY = 2.5 // Sekunden bis das Ziel nach dem Tod wieder erscheint
const HIT_FLASH_DURATION = 0.08 // Sekunden, wie lange das Ziel bei einem Treffer aufleuchtet

const HEALTH_BAR_WIDTH = 0.8
const HEALTH_BAR_HEIGHT = 0.08
const HEALTH_BAR_Y_OFFSET = 1.05 // knapp über dem Kopf der Kapsel
const SHIELD_BAR_Y_OFFSET = HEALTH_BAR_Y_OFFSET + HEALTH_BAR_HEIGHT + 0.03 // dünner Balken direkt darüber

export class Target implements Damageable {
  readonly mesh: THREE.Mesh
  readonly team: Team = 'red'
  private vitals: Vitals = { health: MAX_HEALTH, shield: MAX_SHIELD, shieldRegenCooldown: 0 }
  private respawnRemaining = 0
  private hitFlashRemaining = 0
  private material: THREE.MeshStandardMaterial

  // Schwebende Balken über dem Kopf: zwei einfache Ebenen (dunkler
  // Hintergrund + farbige Füllung) pro Balken, keine Texturdatei nötig.
  // Wird pro Frame per Quaternion zur Kamera ausgerichtet ("Billboard").
  private healthBarGroup: THREE.Group
  private healthBarFill: THREE.Mesh
  private healthBarFillMaterial: THREE.MeshBasicMaterial
  private shieldBarGroup: THREE.Group
  private shieldBarFill: THREE.Mesh

  constructor(position: THREE.Vector3) {
    this.material = new THREE.MeshStandardMaterial({ color: TeamColor.red })

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
    // Team-Zugehörigkeit direkt am Mesh - siehe playerAvatar.ts.
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
    this.healthBarFill.position.z = 0.001 // knapp davor, gegen Z-Fighting mit dem Hintergrund
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
      // Bewusst dieselbe Schild-Farbe wie im Spieler-HUD (#4da6ff) - hat
      // nichts mit der Team-Farbe zu tun, auch wenn der Wert zufällig
      // identisch mit TeamColor.blue ist.
      new THREE.MeshBasicMaterial({ color: 0x4da6ff })
    )
    this.shieldBarFill.position.z = 0.001
    this.shieldBarGroup.add(this.shieldBarFill)
  }

  get isAlive(): boolean {
    return this.vitals.health > 0
  }

  // Identisches Schadensmodell wie beim Spieler (shared/gameRules.ts).
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
      // Beim Treffer kurz weiß aufblitzen, sonst normale Team-Farbe.
      this.material.color.set(this.hitFlashRemaining > 0 ? 0xffffff : TeamColor.red)
    }

    this.updateHealthBar(camera)
  }

  private updateHealthBar(camera: THREE.Camera) {
    // Das Ziel selbst hat keine eigene Rotation, daher richtet das Kopieren
    // der Kamera-Weltrotation den Balken korrekt zur Kamera aus (Billboard) -
    // ohne Rotation des Eltern-Meshes müsste man sonst umrechnen.
    this.healthBarGroup.quaternion.copy(camera.quaternion)

    const ratio = this.vitals.health / MAX_HEALTH
    this.healthBarFill.scale.x = ratio
    this.healthBarFillMaterial.color.set(ratio <= 0.3 ? Palette.accentWarm : TeamColor.red)

    // Nur sichtbar, solange das Ziel selbst lebt/sichtbar ist.
    this.healthBarGroup.visible = this.mesh.visible

    this.shieldBarGroup.quaternion.copy(camera.quaternion)
    this.shieldBarFill.scale.x = this.vitals.shield / MAX_SHIELD
    this.shieldBarGroup.visible = this.mesh.visible
  }
}
