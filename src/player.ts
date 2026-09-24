import * as THREE from 'three'
import type { Solid, Ramp } from './arena'
import { rampHeightAt } from './arena'
import type { Damageable } from './damageable'

// Diese Klasse kümmert sich NUR um Bewegung/Physik/Kollision des Spielers.
// Bewusst getrennt von der Eingabequelle (Tastatur+Maus vs. Touch) - beide
// rufen einfach setMoveInput(x,z) und jump() auf, die Physik dahinter ist
// für beide identisch.

export const EYE_HEIGHT = 1.7
// Augenhöhe im Ducken: deutlich unter die 1.4m-Deckungskisten, damit man
// dahinter wirklich komplett gedeckt ist (im Stehen schaut man bei 1.7m
// Augenhöhe sonst ~30cm über eine 1.4m-Kiste).
export const CROUCH_EYE_HEIGHT = 1.0
const CROUCH_SPEED_MULTIPLIER = 0.6 // langsamer im Ducken, wie in den meisten Shootern
// Wie schnell sich die Augenhöhe beim Ducken/Aufstehen annähert (Meter pro
// Sekunde) - für BEIDE Richtungen gleich, damit es nicht (wie ursprünglich)
// beim Aufstehen abrupt und nur beim Runter-Ducken "zufällig smooth" wirkt
// (das war vorher gar keine Animation, sondern einfach der normale
// Fallweg unter Schwerkraft - deshalb nur in eine Richtung sichtbar).
const CROUCH_TRANSITION_SPEED = 6
const MOVE_SPEED = 6 // Meter pro Sekunde
const JUMP_SPEED = 7.6 // reicht für gut 1,6m Sprunghöhe - genug, um auf die Deckungs-Kisten zu springen
const GRAVITY = 18
const PLAYER_RADIUS = 0.4 // für die Kollision mit Wänden/Kisten

// Die Seiten-Kollision (collidesAt) lässt die untersten paar Zentimeter des
// Spielers "durch" Hindernisse, die knapp unter den eigenen Füßen liegen.
// Ohne das würde man beim Stehen exakt auf einer Kisten-Oberkante ständig
// mit genau dieser Kiste seitlich kollidieren (die Fuß-Höhe berührt dann
// exakt die Kisten-Oberkante) und könnte nicht mehr von ihr herunterlaufen.
const STEP_CLEARANCE = 0.15

const MAX_HEALTH = 100
const RESPAWN_DELAY = 3 // Sekunden bis der Spieler nach dem Tod wieder auftaucht

export interface HealthState {
  current: number
  max: number
}

// Genau das, was ein Multiplayer-Client später pro Frame an andere Spieler
// schicken müsste, um sie korrekt darzustellen: Position, Blickrichtung
// (nur Yaw - Pitch ist rein lokal für die eigene Kamera relevant, siehe
// playerAvatar.ts) und Leben. Absichtlich ein einfaches, flaches Objekt aus
// Zahlen (kein THREE.Vector3/Quaternion) - das lässt sich 1:1 als JSON über
// ein Netzwerk schicken, ohne Klassen-Instanzen (de-)serialisieren zu müssen.
export interface PlayerNetworkState {
  position: { x: number; y: number; z: number }
  yaw: number
  health: number
  maxHealth: number
  isAlive: boolean
  crouching: boolean
}

export class Player implements Damageable {
  private velocity = new THREE.Vector3()
  private onGround = true
  private solids: Solid[]
  private ramps: Ramp[]

  // Gewünschte Bewegungsrichtung relativ zur Blickrichtung:
  // x = seitwärts (-1 = links, 1 = rechts), z = vorwärts/rückwärts (-1 = zurück, 1 = vor)
  // Beide Werte liegen im Bereich [-1, 1] (Touch-Joystick kann auch Zwischenwerte liefern).
  private moveInputX = 0
  private moveInputZ = 0
  private camera: THREE.PerspectiveCamera

  // "Möchte ducken" (Eingabe) vs. "duckt tatsächlich" (nach Kopffreiheits-
  // Check, siehe update()) - man darf nicht mitten in einem zu niedrigen
  // Zwischenraum plötzlich aufstehen und in etwas hineinclippen.
  private wantsToCrouch = false
  private isCrouching = false
  private eyeHeight = EYE_HEIGHT

  // Boden-/Fallhöhe OHNE Augenhöhen-Anteil (also z.B. 0 auf Arena-Boden,
  // unabhängig davon ob man steht oder duckt). Schwerkraft/Sprung wirken
  // ausschließlich hier - die Augenhöhe wird erst am Ende jedes Frames
  // addiert. Ohne diese Trennung würde eine Änderung der Augenhöhe (Ducken)
  // mit der Fall-Physik verrechnet und wirkte in eine Richtung "smooth"
  // (zufällig wie ein normaler Fall) und in die andere abrupt (sofortiges
  // Hochspringen der Kamera) - genau der gemeldete Bug.
  private bodyY = 0

  private health = MAX_HEALTH
  private respawnRemaining = 0
  private spawnPoint = new THREE.Vector3()

  constructor(camera: THREE.PerspectiveCamera, solids: Solid[], ramps: Ramp[] = []) {
    this.camera = camera
    this.solids = solids
    this.ramps = ramps
  }

  spawn(position: THREE.Vector3) {
    this.spawnPoint.copy(position)
    this.camera.position.copy(position)
    this.velocity.set(0, 0, 0)
    this.health = MAX_HEALTH
    this.respawnRemaining = 0
    this.wantsToCrouch = false
    this.isCrouching = false
    this.eyeHeight = EYE_HEIGHT
    this.bodyY = position.y - EYE_HEIGHT
  }

  get isAlive(): boolean {
    return this.health > 0
  }

  getHealthState(): HealthState {
    return { current: this.health, max: MAX_HEALTH }
  }

  // Sekunden bis zum Respawn, für die HUD-Anzeige ("Respawn in 3s").
  getRespawnCountdown(): number {
    return this.respawnRemaining
  }

  // Bündelt alles, was für einen späteren Multiplayer-Sync relevant wäre
  // (siehe PlayerNetworkState oben). Wird aktuell noch nirgends "verschickt",
  // aber playerAvatar.ts könnte damit z.B. auch die Hülle EINES ANDEREN
  // Spielers positionieren - dieselbe Funktion, nur mit fremden Zustands-
  // Daten statt der eigenen Kamera.
  getNetworkState(): PlayerNetworkState {
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ')
    return {
      position: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      },
      yaw: euler.y,
      health: this.health,
      maxHealth: MAX_HEALTH,
      isAlive: this.isAlive,
      crouching: this.isCrouching,
    }
  }

  // Es gibt aktuell noch keine Gegner, die das hier tatsächlich aufrufen -
  // die Infrastruktur (Schaden, Tod, Respawn) steht aber schon, damit
  // spätere Gegner/Multiplayer nur noch takeDamage() aufrufen müssen.
  takeDamage(amount: number) {
    if (!this.isAlive) return

    this.health = Math.max(0, this.health - amount)
    if (this.health === 0) {
      this.respawnRemaining = RESPAWN_DELAY
      this.velocity.set(0, 0, 0)
    }
  }

  setMoveInput(x: number, z: number) {
    this.moveInputX = THREE.MathUtils.clamp(x, -1, 1)
    this.moveInputZ = THREE.MathUtils.clamp(z, -1, 1)
  }

  setCrouching(crouching: boolean) {
    this.wantsToCrouch = crouching
  }

  jump() {
    if (this.onGround && this.isAlive) {
      this.velocity.y = JUMP_SPEED
      this.onGround = false
    }
  }

  update(deltaSeconds: number) {
    if (!this.isAlive) {
      this.respawnRemaining = Math.max(0, this.respawnRemaining - deltaSeconds)
      if (this.respawnRemaining === 0) {
        this.spawn(this.spawnPoint)
      }
      return
    }

    // Ducken auflösen: Hinsetzen geht immer sofort, Aufstehen nur, wenn über
    // dem Kopf tatsächlich Platz ist (sonst bliebe man z.B. unter einer
    // niedrigen Deckung "stecken" und würde optisch/kollisionsmäßig
    // hineinclippen). Beeinflusst die Augenhöhe für diesen gesamten Frame -
    // muss vor der Kollisionsprüfung stehen, damit tryMove() weiter unten
    // schon die richtige Körpergröße verwendet.
    if (this.wantsToCrouch) {
      this.isCrouching = true
    } else if (this.isCrouching && !this.canStandAt(this.camera.position.x, this.camera.position.z)) {
      this.isCrouching = true // bleibt vorerst geduckt, wird jeden Frame neu geprüft
    } else {
      this.isCrouching = false
    }

    // Augenhöhe nicht instant springen lassen, sondern gleichmäßig
    // annähern - in beide Richtungen mit derselben Geschwindigkeit. Wirkt
    // direkt auf camera.position.y (über bodyY + eyeHeight), komplett
    // unabhängig von Schwerkraft/Sprung-Physik weiter unten.
    const targetEyeHeight = this.isCrouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT
    const maxStep = CROUCH_TRANSITION_SPEED * deltaSeconds
    if (this.eyeHeight < targetEyeHeight) {
      this.eyeHeight = Math.min(targetEyeHeight, this.eyeHeight + maxStep)
    } else if (this.eyeHeight > targetEyeHeight) {
      this.eyeHeight = Math.max(targetEyeHeight, this.eyeHeight - maxStep)
    }
    this.camera.position.y = this.bodyY + this.eyeHeight

    // Schwerkraft anwenden
    this.velocity.y -= GRAVITY * deltaSeconds

    if (this.moveInputX !== 0 || this.moveInputZ !== 0) {
      const moveDirection = new THREE.Vector3()

      const forward = new THREE.Vector3()
      this.camera.getWorldDirection(forward)
      forward.y = 0
      forward.normalize()

      // cross(forward, up) ergibt in Three.js' rechtshändigem Koordinatensystem
      // bereits den korrekten "rechts"-Vektor der Kamera - kein .negate() nötig
      // (das hätte links/rechts vertauscht, exakt der gemeldete Joystick-Bug).
      const right = new THREE.Vector3().crossVectors(forward, this.camera.up)

      moveDirection.addScaledVector(forward, this.moveInputZ)
      moveDirection.addScaledVector(right, this.moveInputX)

      // Nur normalisieren, wenn die Länge > 1 ist (Tastatur liefert immer
      // Länge 1 oder 1.41 bei Diagonalbewegung; ein Touch-Joystick kann aber
      // auch bewusst kürzere, "sanftere" Eingaben liefern, z.B. 0.3 für
      // langsames Gehen - die wollen wir nicht auf 1 hochskalieren).
      if (moveDirection.length() > 1) {
        moveDirection.normalize()
      }
      const speed = this.isCrouching ? MOVE_SPEED * CROUCH_SPEED_MULTIPLIER : MOVE_SPEED
      moveDirection.multiplyScalar(speed * deltaSeconds)

      this.tryMove(moveDirection)
    }

    // Vertikale Bewegung (Springen/Fallen) - rein auf bodyY, ohne
    // Augenhöhen-Anteil (siehe Kommentar beim Feld weiter oben).
    this.bodyY += this.velocity.y * deltaSeconds

    // Boden-Höhe unter den Füßen ermitteln: normalerweise der Arena-Boden
    // (0), aber wenn man über einer Kiste steht, deren Oberkante. Dadurch
    // kann man auf Kisten landen und stehen bleiben, statt durch sie
    // hindurchzufallen oder immer auf y=0 zurückgesetzt zu werden.
    const groundHeight = this.groundHeightAt(this.camera.position.x, this.camera.position.z)

    if (this.bodyY <= groundHeight) {
      this.bodyY = groundHeight
      this.velocity.y = 0
      this.onGround = true
    } else {
      this.onGround = false
    }

    this.camera.position.y = this.bodyY + this.eyeHeight
  }

  // Höchste Stand-Höhe direkt unter dem Punkt (x, z): entweder eine
  // Solid-Oberkante (Kiste/Plattform), ein interpolierter Rampen-Punkt, oder
  // 0 (Arena-Boden), falls dort keins von beiden liegt.
  private groundHeightAt(x: number, z: number): number {
    let height = 0
    for (const solid of this.solids) {
      const box = solid.box
      if (x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z) {
        height = Math.max(height, box.max.y)
      }
    }
    for (const ramp of this.ramps) {
      const rampHeight = rampHeightAt(ramp, x, z)
      if (rampHeight !== null) {
        height = Math.max(height, rampHeight)
      }
    }
    return height
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
      new THREE.Vector3(
        position.x - PLAYER_RADIUS,
        position.y - this.eyeHeight + STEP_CLEARANCE,
        position.z - PLAYER_RADIUS
      ),
      new THREE.Vector3(position.x + PLAYER_RADIUS, position.y + 0.3, position.z + PLAYER_RADIUS)
    )

    for (const solid of this.solids) {
      if (playerBox.intersectsBox(solid.box)) {
        return true
      }
    }
    return false
  }

  // Prüft, ob am Punkt (x, z) genug Kopffreiheit zum Aufstehen wäre: eine
  // Box exakt im Bereich zwischen Duck- und Steh-Augenhöhe (der Teil, der
  // beim Aufstehen zusätzlich beansprucht würde) darf nichts überschneiden.
  private canStandAt(x: number, z: number): boolean {
    const groundHeight = this.groundHeightAt(x, z)
    const standBox = new THREE.Box3(
      new THREE.Vector3(x - PLAYER_RADIUS, groundHeight + CROUCH_EYE_HEIGHT, z - PLAYER_RADIUS),
      new THREE.Vector3(x + PLAYER_RADIUS, groundHeight + EYE_HEIGHT + 0.3, z + PLAYER_RADIUS)
    )

    for (const solid of this.solids) {
      if (standBox.intersectsBox(solid.box)) {
        return false
      }
    }
    return true
  }
}
