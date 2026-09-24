import * as THREE from 'three'
import { Palette } from './palette'
import type { Player } from './player'
import type { Damageable } from './damageable'

// Sichtbare Spieler-Hülle: die Kamera allein hat kein Mesh - für einen
// späteren Multiplayer müssten andere Spieler aber überhaupt etwas sehen
// können. Diese Klasse baut genau das schon jetzt, auch wenn man sich
// selbst in der Ego-Perspektive nicht sieht. Nutzt bewusst dieselbe
// Kapsel-Form wie die Ziele (target.ts) für ein konsistentes Aussehen.
//
// Wichtig für später: die eigene Hülle wird NICHT in die "shootables"-Liste
// der eigenen Waffe aufgenommen (siehe main.ts) - man soll sich nicht
// selbst treffen können. Im Multiplayer bekäme jeder Client nur die
// Hüllen der ANDEREN Spieler in seine eigene Schussliste.

const CAPSULE_RADIUS = 0.35
const CAPSULE_LENGTH = 1.0 // Zylinderteil; Gesamthöhe = LENGTH + 2*RADIUS
const EYE_HEIGHT = 1.7

export class PlayerAvatar implements Damageable {
  readonly mesh: THREE.Mesh
  private player: Player

  constructor(player: Player) {
    this.player = player

    const material = new THREE.MeshStandardMaterial({ color: Palette.accentWarm })
    const geometry = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 4, 8)
    this.mesh = new THREE.Mesh(geometry, material)

    // Schaden an dieser Hülle wird an den echten Spieler weitergeleitet -
    // dieselbe Damageable-Schnittstelle wie bei Target, siehe damageable.ts.
    this.mesh.userData.damageable = this as Damageable
  }

  get isAlive(): boolean {
    return this.player.isAlive
  }

  takeDamage(amount: number) {
    this.player.takeDamage(amount)
  }

  // Muss jeden Frame aufgerufen werden: Position/Ausrichtung der Hülle
  // folgt der Kamera. Nur der Yaw (Drehung um die Hochachse) wird übernommen,
  // nicht der Pitch (Hoch-/Runterschauen) - sonst würde sich die Figur beim
  // Umschauen nach oben/unten seltsam nach vorne/hinten neigen.
  update(camera: THREE.Camera) {
    const capsuleCenterY = camera.position.y - EYE_HEIGHT + CAPSULE_LENGTH / 2 + CAPSULE_RADIUS
    this.mesh.position.set(camera.position.x, capsuleCenterY, camera.position.z)

    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    this.mesh.rotation.set(0, euler.y, 0)

    this.mesh.visible = this.player.isAlive
  }
}
