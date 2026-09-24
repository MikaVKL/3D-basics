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
//
// update() liest bewusst NICHT mehr direkt die Kamera, sondern
// player.getNetworkState() (siehe player.ts) - genau die Daten, die ein
// Multiplayer-Client später per Netzwerk für ANDERE Spieler bekommen würde.
// Für die eigene Hülle kommt der Zustand hier noch lokal von der eigenen
// Kamera, aber der Code kennt intern schon keinen Unterschied mehr zu
// "fremden" Zustandsdaten.

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
  // folgt dem Netzwerk-Zustand des Spielers (Yaw, nicht Pitch - sonst würde
  // sich die Figur beim Umschauen nach oben/unten seltsam nach vorne/hinten
  // neigen, siehe Kommentar oben).
  update() {
    const state = this.player.getNetworkState()
    const capsuleCenterY = state.position.y - EYE_HEIGHT + CAPSULE_LENGTH / 2 + CAPSULE_RADIUS
    this.mesh.position.set(state.position.x, capsuleCenterY, state.position.z)
    this.mesh.rotation.set(0, state.yaw, 0)

    this.mesh.visible = state.isAlive
  }
}
