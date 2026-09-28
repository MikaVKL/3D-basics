import * as THREE from 'three'
import { EYE_HEIGHT, CROUCH_EYE_HEIGHT } from './player'
import type { PlayerNetworkState } from './shared/protocol'
import { Palette } from './palette'
import { TeamColor, type Team } from './team'

// Spieler-Figur im Low-Poly-Stil, gesteuert nur über applyState(). Optik
// und Trefferfläche sind getrennt: "mesh" ist eine unsichtbare Kapsel, auf
// die die Waffe zielt (Treffer-Verhalten wie zuvor), "root" die sichtbare
// Figur. Blickrichtung ist -z (wie die Kamera bei yaw 0).

const HITBOX_RADIUS = 0.35
const HITBOX_LENGTH = 1.2 // Gesamthöhe = LENGTH + 2*RADIUS = 1.9
const HITBOX_HEIGHT = HITBOX_LENGTH + 2 * HITBOX_RADIUS
const CROUCH_HEIGHT = 1.3
const CROUCH_DROP = 0.55 // so weit sinkt der Oberkörper im Ducken
const HIT_FLASH_DURATION = 0.08
// Leichtes Eigenleuchten in Teamfarbe: auch im Schatten (von hinten) erkennbar
const TEAM_GLOW = 0.35
const STRIDE = 1.1 // Meter pro halbem Beinschwung
const MAX_LEG_SWING = 0.6 // rad

function box(width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
}

// Glied, das an einem Gelenk (pivot) hängt und darum schwingt
function limb(width: number, length: number, depth: number, material: THREE.Material): THREE.Group {
  const pivot = new THREE.Group()
  const part = box(width, length, depth, material)
  part.position.y = -length / 2
  pivot.add(part)
  return pivot
}

export class PlayerAvatar {
  readonly root = new THREE.Group()
  // Unsichtbare Trefferfläche (userData: team, damageable)
  readonly mesh: THREE.Mesh
  private readonly upperBody = new THREE.Group()
  private readonly leftLeg: THREE.Group
  private readonly rightLeg: THREE.Group
  private readonly teamMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6 })
  private readonly teamDarkMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7 })
  private readonly materials: THREE.MeshStandardMaterial[]
  private team: Team
  private hitFlashRemaining = 0
  private walkPhase = 0
  private readonly lastPosition = new THREE.Vector3()
  private hasLastPosition = false

  constructor(team: Team) {
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.8 })
    const visorMaterial = new THREE.MeshStandardMaterial({
      color: Palette.accentNeon,
      emissive: Palette.accentNeon,
      emissiveIntensity: 1.4,
    })
    const gunMaterial = new THREE.MeshStandardMaterial({ color: Palette.weaponBody, roughness: 0.5 })
    this.materials = [this.teamMaterial, this.teamDarkMaterial, headMaterial, visorMaterial, gunMaterial]

    this.mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(HITBOX_RADIUS, HITBOX_LENGTH, 4, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    )
    this.mesh.position.y = HITBOX_HEIGHT / 2
    this.root.add(this.mesh)

    this.leftLeg = limb(0.22, 0.8, 0.26, this.teamDarkMaterial)
    this.rightLeg = limb(0.22, 0.8, 0.26, this.teamDarkMaterial)
    this.leftLeg.position.set(-0.14, 0.8, 0)
    this.rightLeg.position.set(0.14, 0.8, 0)
    this.root.add(this.leftLeg, this.rightLeg)

    const torso = box(0.6, 0.65, 0.36, this.teamMaterial)
    torso.position.y = 1.125
    const head = box(0.42, 0.42, 0.42, headMaterial)
    head.position.y = 1.67
    const visor = box(0.34, 0.09, 0.03, visorMaterial)
    visor.position.set(0, 1.7, -0.22)
    const leftArm = limb(0.15, 0.55, 0.17, this.teamMaterial)
    const rightArm = limb(0.15, 0.55, 0.17, this.teamMaterial)
    leftArm.position.set(-0.38, 1.4, 0)
    rightArm.position.set(0.38, 1.4, 0)
    // Waffe rechts: rechte Hand am Griff, linke greift quer an den Lauf
    leftArm.rotation.set(1.25, 0, 0.76)
    rightArm.rotation.set(1.25, 0, -0.37)
    const gun = box(0.1, 0.14, 0.55, gunMaterial)
    gun.position.set(0.18, 1.28, -0.6)
    const gunStripe = box(0.11, 0.03, 0.4, visorMaterial)
    gunStripe.position.set(0.18, 1.36, -0.6)
    this.upperBody.add(torso, head, visor, leftArm, rightArm, gun, gunStripe)
    this.root.add(this.upperBody)

    this.team = team
    this.setTeam(team)
  }

  setTeam(team: Team) {
    this.team = team
    this.teamMaterial.color.set(TeamColor[team])
    this.teamDarkMaterial.color.set(TeamColor[team]).multiplyScalar(0.55)
    this.resetGlow()
    // weapon.ts liest das Team am Mesh (Friendly-Fire)
    this.mesh.userData.team = team
  }

  // Körpermitte in Weltkoordinaten (z.B. Richtung für den Schadensanzeiger)
  get centerPosition(): THREE.Vector3 {
    return this.mesh.getWorldPosition(new THREE.Vector3())
  }

  // Nur Yaw - sonst kippt die Figur beim Hoch-/Runterschauen
  applyState(state: PlayerNetworkState) {
    if (this.team !== state.team) this.setTeam(state.team)

    const eyeHeight = state.crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT
    this.root.position.set(state.position.x, state.position.y - eyeHeight, state.position.z)
    this.root.rotation.set(0, state.yaw, 0)
    this.root.updateMatrixWorld()

    const height = state.crouching ? CROUCH_HEIGHT : HITBOX_HEIGHT
    this.mesh.scale.y = height / HITBOX_HEIGHT
    this.mesh.position.y = height / 2
    this.upperBody.position.y = state.crouching ? -CROUCH_DROP : 0
    const legScale = state.crouching ? 0.35 : 1
    this.leftLeg.scale.y = legScale
    this.rightLeg.scale.y = legScale
    this.leftLeg.position.y = 0.8 * legScale
    this.rightLeg.position.y = 0.8 * legScale

    this.animateWalk(state)

    this.root.visible = state.isAlive
    // Raycaster prüft "visible" am getroffenen Objekt selbst, nicht am Elternteil
    this.mesh.visible = state.isAlive
  }

  // Beine schwingen passend zur zurückgelegten Strecke am Boden
  private animateWalk(state: PlayerNetworkState) {
    const position = this.root.position
    const moved = this.hasLastPosition
      ? Math.hypot(position.x - this.lastPosition.x, position.z - this.lastPosition.z)
      : 0
    this.lastPosition.copy(position)
    this.hasLastPosition = true
    if (moved > 2) return // Teleport/Respawn
    this.walkPhase += (moved / STRIDE) * Math.PI
    // Stillstand: Beine laufen langsam zurück in die Ruheposition
    const swing = moved > 0.002 ? Math.sin(this.walkPhase) * MAX_LEG_SWING : this.leftLeg.rotation.x * 0.8
    const amplitude = state.crouching ? 0.5 : 1
    this.leftLeg.rotation.x = swing * amplitude
    this.rightLeg.rotation.x = -swing * amplitude
  }

  // Spawn-Schutz: halb durchsichtig
  setProtected(isProtected: boolean) {
    for (const material of this.materials) {
      material.transparent = isProtected
      material.opacity = isProtected ? 0.4 : 1
    }
  }

  flash() {
    this.hitFlashRemaining = HIT_FLASH_DURATION
    this.teamMaterial.emissive.set(0xffffff)
    this.teamDarkMaterial.emissive.set(0xffffff)
  }

  update(deltaSeconds: number) {
    if (this.hitFlashRemaining <= 0) return
    this.hitFlashRemaining -= deltaSeconds
    if (this.hitFlashRemaining <= 0) this.resetGlow()
  }

  private resetGlow() {
    this.teamMaterial.emissive.set(TeamColor[this.team]).multiplyScalar(TEAM_GLOW)
    this.teamDarkMaterial.emissive.set(TeamColor[this.team]).multiplyScalar(TEAM_GLOW * 0.55)
  }

  dispose() {
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose()
    })
    for (const material of this.materials) material.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
