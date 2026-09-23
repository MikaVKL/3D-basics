import * as THREE from 'three'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'
import type { Solid } from './arena'

// Diese Klasse kümmert sich um alles, was den Spieler betrifft:
// - Maussteuerung (Umschauen) über PointerLockControls
// - WASD-Bewegung + Springen
// - Schwerkraft
// - einfache Kollision mit Wänden/Kisten, damit man nicht durchläuft

const EYE_HEIGHT = 1.7
const MOVE_SPEED = 6 // Meter pro Sekunde
const JUMP_SPEED = 6.5
const GRAVITY = 18
const PLAYER_RADIUS = 0.4 // für die Kollision mit Wänden/Kisten

export class Player {
  readonly controls: PointerLockControls
  private velocity = new THREE.Vector3()
  private onGround = true

  // Tastatur-Zustand: welche Bewegungstasten sind aktuell gedrückt
  private input = { forward: false, back: false, left: false, right: false }

  private solids: Solid[]

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, solids: Solid[]) {
    this.solids = solids
    this.controls = new PointerLockControls(camera, domElement)
    this.controls.object.position.set(0, EYE_HEIGHT, 12)

    window.addEventListener('keydown', (e) => this.setKey(e.code, true))
    window.addEventListener('keyup', (e) => this.setKey(e.code, false))
  }

  spawn(position: THREE.Vector3) {
    this.controls.object.position.copy(position)
    this.velocity.set(0, 0, 0)
  }

  private setKey(code: string, pressed: boolean) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.input.forward = pressed
        break
      case 'KeyS':
      case 'ArrowDown':
        this.input.back = pressed
        break
      case 'KeyA':
      case 'ArrowLeft':
        this.input.left = pressed
        break
      case 'KeyD':
      case 'ArrowRight':
        this.input.right = pressed
        break
      case 'Space':
        if (this.onGround) {
          this.velocity.y = JUMP_SPEED
          this.onGround = false
        }
        break
    }
  }

  update(deltaSeconds: number) {
    // Schwerkraft anwenden
    this.velocity.y -= GRAVITY * deltaSeconds

    // Bewegungsrichtung relativ zur Blickrichtung berechnen.
    // getDirection liefert die Blickrichtung; für "seitwärts" reicht ein
    // 90°-gedrehter Vektor auf der horizontalen Ebene.
    const forwardInput = Number(this.input.forward) - Number(this.input.back)
    const rightInput = Number(this.input.right) - Number(this.input.left)

    if (forwardInput !== 0 || rightInput !== 0) {
      const moveDirection = new THREE.Vector3()

      const camera = this.controls.object
      const forward = new THREE.Vector3()
      camera.getWorldDirection(forward)
      forward.y = 0
      forward.normalize()

      const right = new THREE.Vector3().crossVectors(forward, camera.up).negate()

      moveDirection.addScaledVector(forward, forwardInput)
      moveDirection.addScaledVector(right, rightInput)
      moveDirection.normalize().multiplyScalar(MOVE_SPEED * deltaSeconds)

      this.tryMove(moveDirection)
    }

    // Vertikale Bewegung (Springen/Fallen) + Boden-Kollision
    const camera = this.controls.object
    camera.position.y += this.velocity.y * deltaSeconds

    if (camera.position.y <= EYE_HEIGHT) {
      camera.position.y = EYE_HEIGHT
      this.velocity.y = 0
      this.onGround = true
    }
  }

  // Bewegt die Kamera horizontal, aber prüft vorher, ob die Zielposition
  // mit einem Solid (Wand/Kiste) kollidieren würde. X und Z werden getrennt
  // geprüft, damit man an Wänden "entlang gleiten" kann statt komplett
  // stecken zu bleiben.
  //
  // Wichtig: Wenn der volle Schritt kollidiert, wird nicht einfach die
  // komplette Bewegung verworfen (das würde den Spieler eine sichtbare
  // Lücke vor jeder Wand/Kiste "einfrieren" lassen, aus der er nie wieder
  // herauskommt). Stattdessen wird per Bisektion die größte noch sichere
  // Teilstrecke gesucht, damit man bis knapp an das Hindernis heranlaufen
  // kann - wie man es aus jedem Shooter erwartet.
  private tryMove(delta: THREE.Vector3) {
    const camera = this.controls.object
    const position = camera.position

    position.x = this.resolveAxis(position, 'x', delta.x)
    position.z = this.resolveAxis(position, 'z', delta.z)
  }

  private resolveAxis(position: THREE.Vector3, axis: 'x' | 'z', delta: number): number {
    const current = position[axis]
    if (delta === 0) return current

    const target = position.clone()
    target[axis] = current + delta

    if (!this.collidesAt(target)) {
      return target[axis]
    }

    // Bisektion: den größten Bruchteil von "delta" finden, der noch sicher ist.
    let safeFraction = 0
    let blockedFraction = 1
    const probe = position.clone()

    for (let i = 0; i < 8; i++) {
      const midFraction = (safeFraction + blockedFraction) / 2
      probe[axis] = current + delta * midFraction

      if (this.collidesAt(probe)) {
        blockedFraction = midFraction
      } else {
        safeFraction = midFraction
      }
    }

    return current + delta * safeFraction
  }

  private collidesAt(position: THREE.Vector3): boolean {
    const playerBox = new THREE.Box3(
      new THREE.Vector3(position.x - PLAYER_RADIUS, position.y - EYE_HEIGHT, position.z - PLAYER_RADIUS),
      new THREE.Vector3(position.x + PLAYER_RADIUS, position.y + 0.3, position.z + PLAYER_RADIUS)
    )

    for (const solid of this.solids) {
      if (playerBox.intersectsBox(solid.box)) {
        return true
      }
    }
    return false
  }
}
