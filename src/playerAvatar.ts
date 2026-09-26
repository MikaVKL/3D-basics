import * as THREE from 'three'
import { EYE_HEIGHT, CROUCH_EYE_HEIGHT } from './player'
import type { PlayerNetworkState } from './shared/protocol'
import { TeamColor, type Team } from './team'

// Spieler-Hülle (Platzhalter-Kapsel), gesteuert nur über applyState() -
// eigene und fremde Hülle nutzen denselben Code

const CAPSULE_RADIUS = 0.35
const CAPSULE_LENGTH = 1.0 // Zylinderteil; Gesamthöhe = LENGTH + 2*RADIUS
const STANDING_HEIGHT = CAPSULE_LENGTH + 2 * CAPSULE_RADIUS
// Beim Ducken per scale.y gestaucht
const CROUCH_HEIGHT = 1.1
const CROUCH_SCALE_Y = CROUCH_HEIGHT / STANDING_HEIGHT
const HIT_FLASH_DURATION = 0.08

export class PlayerAvatar {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.MeshStandardMaterial
  private team: Team
  private hitFlashRemaining = 0

  constructor(team: Team) {
    this.material = new THREE.MeshStandardMaterial()
    const geometry = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 4, 8)
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.team = team
    this.setTeam(team)
  }

  setTeam(team: Team) {
    this.team = team
    this.material.color.set(TeamColor[team])
    // weapon.ts liest das Team am Mesh (Friendly-Fire)
    this.mesh.userData.team = team
  }

  // Nur Yaw - sonst kippt die Figur beim Hoch-/Runterschauen
  applyState(state: PlayerNetworkState) {
    if (this.team !== state.team) this.setTeam(state.team)

    const eyeHeight = state.crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT
    const groundY = state.position.y - eyeHeight

    this.mesh.scale.y = state.crouching ? CROUCH_SCALE_Y : 1
    const totalHeight = state.crouching ? CROUCH_HEIGHT : STANDING_HEIGHT
    this.mesh.position.set(state.position.x, groundY + totalHeight / 2, state.position.z)
    this.mesh.rotation.set(0, state.yaw, 0)

    this.mesh.visible = state.isAlive
  }

  // Spawn-Schutz: halb durchsichtig
  setProtected(isProtected: boolean) {
    this.material.transparent = isProtected
    this.material.opacity = isProtected ? 0.4 : 1
  }

  flash() {
    this.hitFlashRemaining = HIT_FLASH_DURATION
    this.material.color.set(0xffffff)
  }

  update(deltaSeconds: number) {
    if (this.hitFlashRemaining <= 0) return
    this.hitFlashRemaining -= deltaSeconds
    if (this.hitFlashRemaining <= 0) this.material.color.set(TeamColor[this.team])
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
