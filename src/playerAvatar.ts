import * as THREE from 'three'
import { EYE_HEIGHT, CROUCH_EYE_HEIGHT } from './player'
import type { PlayerNetworkState } from './shared/protocol'
import { TeamColor, type Team } from './team'

// Sichtbare Spieler-Hülle - Platzhalter-Modell, nutzt bewusst dieselbe
// Kapsel-Form wie die Ziele (target.ts). Wird ausschließlich über
// applyState() mit einem PlayerNetworkState gesteuert: für die eigene Hülle
// kommt der aus der lokalen Kamera, für andere Spieler interpoliert aus den
// Server-Snapshots (remotePlayers.ts) - die Hülle selbst kennt keinen
// Unterschied.
//
// Die eigene Hülle wird NICHT in die "shootables"-Liste aufgenommen (siehe
// main.ts) - man soll sich nicht selbst treffen können.

const CAPSULE_RADIUS = 0.35
const CAPSULE_LENGTH = 1.0 // Zylinderteil; Gesamthöhe = LENGTH + 2*RADIUS
const STANDING_HEIGHT = CAPSULE_LENGTH + 2 * CAPSULE_RADIUS
// Beim Ducken wird die Hülle vertikal gestaucht (per scale.y), damit sie
// nicht durch den Boden clippt oder in der Luft hängt - sichtbares Pendant
// zur reduzierten Augenhöhe in player.ts.
const CROUCH_HEIGHT = 1.1
const CROUCH_SCALE_Y = CROUCH_HEIGHT / STANDING_HEIGHT

export class PlayerAvatar {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.MeshStandardMaterial

  constructor(team: Team) {
    // Team-Farbe statt einer neutralen Akzentfarbe - man muss auf den ersten
    // Blick erkennen können, wer Freund und wer Feind ist (siehe team.ts).
    this.material = new THREE.MeshStandardMaterial()
    const geometry = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 4, 8)
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.setTeam(team)
  }

  setTeam(team: Team) {
    this.material.color.set(TeamColor[team])
    // Team-Zugehörigkeit direkt am Mesh - weapon.ts kann so generisch (ohne
    // den Objekttyp zu kennen) Freundschaftliches Feuer verhindern.
    this.mesh.userData.team = team
  }

  // Yaw, nicht Pitch - sonst würde sich die Figur beim Umschauen nach
  // oben/unten seltsam nach vorne/hinten neigen.
  applyState(state: PlayerNetworkState) {
    if (this.mesh.userData.team !== state.team) this.setTeam(state.team)

    const eyeHeight = state.crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT
    const groundY = state.position.y - eyeHeight

    this.mesh.scale.y = state.crouching ? CROUCH_SCALE_Y : 1
    const totalHeight = state.crouching ? CROUCH_HEIGHT : STANDING_HEIGHT
    this.mesh.position.set(state.position.x, groundY + totalHeight / 2, state.position.z)
    this.mesh.rotation.set(0, state.yaw, 0)

    this.mesh.visible = state.isAlive
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
