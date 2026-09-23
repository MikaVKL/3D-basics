import * as THREE from 'three'
import type { Solid } from './arena'

// Diese Klasse kümmert sich NUR um Bewegung/Physik/Kollision des Spielers.
// Bewusst getrennt von der Eingabequelle (Tastatur+Maus vs. Touch) - beide
// rufen einfach setMoveInput(x,z) und jump() auf, die Physik dahinter ist
// für beide identisch.

const EYE_HEIGHT = 1.7
const MOVE_SPEED = 6 // Meter pro Sekunde
const JUMP_SPEED = 6.5
const GRAVITY = 18
const PLAYER_RADIUS = 0.4 // für die Kollision mit Wänden/Kisten

export class Player {
  private velocity = new THREE.Vector3()
  private onGround = true
  private solids: Solid[]

  // Gewünschte Bewegungsrichtung relativ zur Blickrichtung:
  // x = seitwärts (-1 = links, 1 = rechts), z = vorwärts/rückwärts (-1 = zurück, 1 = vor)
  // Beide Werte liegen im Bereich [-1, 1] (Touch-Joystick kann auch Zwischenwerte liefern).
  private moveInputX = 0
  private moveInputZ = 0
  private camera: THREE.PerspectiveCamera

  constructor(camera: THREE.PerspectiveCamera, solids: Solid[]) {
    this.camera = camera
    this.solids = solids
  }

  spawn(position: THREE.Vector3) {
    this.camera.position.copy(position)
    this.velocity.set(0, 0, 0)
  }

  setMoveInput(x: number, z: number) {
    this.moveInputX = THREE.MathUtils.clamp(x, -1, 1)
    this.moveInputZ = THREE.MathUtils.clamp(z, -1, 1)
  }

  jump() {
    if (this.onGround) {
      this.velocity.y = JUMP_SPEED
      this.onGround = false
    }
  }

  update(deltaSeconds: number) {
    // Schwerkraft anwenden
    this.velocity.y -= GRAVITY * deltaSeconds

    if (this.moveInputX !== 0 || this.moveInputZ !== 0) {
      const moveDirection = new THREE.Vector3()

      const forward = new THREE.Vector3()
      this.camera.getWorldDirection(forward)
      forward.y = 0
      forward.normalize()

      const right = new THREE.Vector3().crossVectors(forward, this.camera.up).negate()

      moveDirection.addScaledVector(forward, this.moveInputZ)
      moveDirection.addScaledVector(right, this.moveInputX)

      // Nur normalisieren, wenn die Länge > 1 ist (Tastatur liefert immer
      // Länge 1 oder 1.41 bei Diagonalbewegung; ein Touch-Joystick kann aber
      // auch bewusst kürzere, "sanftere" Eingaben liefern, z.B. 0.3 für
      // langsames Gehen - die wollen wir nicht auf 1 hochskalieren).
      if (moveDirection.length() > 1) {
        moveDirection.normalize()
      }
      moveDirection.multiplyScalar(MOVE_SPEED * deltaSeconds)

      this.tryMove(moveDirection)
    }

    // Vertikale Bewegung (Springen/Fallen) + Boden-Kollision
    this.camera.position.y += this.velocity.y * deltaSeconds

    if (this.camera.position.y <= EYE_HEIGHT) {
      this.camera.position.y = EYE_HEIGHT
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
    const position = this.camera.position

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
