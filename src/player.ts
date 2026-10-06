import * as THREE from 'three'
import type { Solid, Ramp } from './arena'
import { rampHeightAt } from './arena'
import type { Damageable } from './damageable'
import type { Team } from './team'
import type { PlayerNetworkState } from './shared/protocol'
import { WEAPONS, DEFAULT_WEAPON, type WeaponId } from './shared/weapons'
import {
  MAX_HEALTH,
  MAX_SHIELD,
  RESPAWN_DELAY,
  applyDamage,
  regenerateShield,
  type Vitals,
} from './shared/gameRules'

// Nur Bewegung/Physik/Kollision - Eingabequellen (Desktop/Touch) rufen
// lediglich setMoveInput(), jump() usw. auf.

export const EYE_HEIGHT = 1.7
// Unter der Kante der 1.4m-Kisten, damit man dahinter voll gedeckt ist
export const CROUCH_EYE_HEIGHT = 1.0
const CROUCH_SPEED_MULTIPLIER = 0.6
// Augenhöhen-Änderung beim Ducken/Aufstehen in m/s (beide Richtungen gleich)
const CROUCH_TRANSITION_SPEED = 6
const MOVE_SPEED = 6 // Meter pro Sekunde
const SPRINT_SPEED_MULTIPLIER = 1.6
const AIM_SPEED_MULTIPLIER = 0.75
// Lehnen (Q/E): Kamera seitlich versetzt und gekippt, Körper bleibt stehen
export const LEAN_DISTANCE = 0.45 // m bei vollem Lehnen
const LEAN_SPEED = 7 // 1/s: in ~0,15 s ganz gelehnt
const LEAN_SPEED_MULTIPLIER = 0.75
const LEAN_CAMERA_RADIUS = 0.12 // so dicht darf die Kamera an Wände (Körper hält 0,3 m)
const JUMP_SPEED = 7.6 // ~1.6m Sprunghöhe: reicht für die 1.4m-Kisten
const GRAVITY = 18
// Sprungpad: Steighöhe über dem Pad (überall gleich, auch auf Stegen). Es gibt bewusst keine unsichtbare Decke;
// über die Wände kommt man trotzdem nie, weil volle Wände für die Kollision unbegrenzt hoch sind (arena.ts)
const PAD_RISE = 4.4
const PAD_RETRIGGER = 0.5 // s bis zum nächsten Auslösen
const PLAYER_RADIUS = 0.4

const MAX_STAMINA = 100
const STAMINA_DRAIN_RATE = 20 // pro Sekunde (5 s Dauersprint, ~48 m)
const STAMINA_REGEN_RATE = 15
// Mindestvorrat zum Starten eines Sprints (verhindert Start-Stopp-Flackern
// bei fast leerem Vorrat); einmal gestartet, läuft er bis 0
const MIN_STAMINA_TO_START_SPRINT = 15

// Rutschen: Ducken aus dem Sprint heraus gibt einen Schub in Laufrichtung,
// der dann bis aufs Duck-Tempo ausläuft (~0,8 s, ~6 m)
const SLIDE_BOOST = 1.25
const SLIDE_MAX_SPEED = 13
const SLIDE_FRICTION = 10 // m/s²
// Sonst ließe sich durch Duck-Spam dauerhaft schneller als im Sprint laufen
const SLIDE_COOLDOWN = 0.6
// Bunny-Hop: Schwung über dem Lauftempo bleibt in der Luft erhalten und
// verfällt am Boden erst nach BHOP_WINDOW. Wer direkt bei der Landung
// wieder springt, behält ihn und bekommt etwas dazu (bis BHOP_MAX_SPEED).
const BHOP_WINDOW = 0.12
const BHOP_BOOST = 1.05
const BHOP_MAX_SPEED = 12
// Leertaste kurz vor der Landung zählt als Sprung bei der Landung
const JUMP_BUFFER = 0.15
const MIN_HOP_FALL_SPEED = 2
const GROUND_FRICTION = 25 // m/s², nur auf Schwung über dem Sprint-Tempo
// Lenkrate (1/s), mit der die Geschwindigkeit der Eingabe folgt, sobald
// man schneller als das Lauftempo ist
const GROUND_CONTROL = 15
const AIR_CONTROL = 8
// Längere Schritte werden unterteilt, damit man bei hohem Tempo und
// niedriger Bildrate nicht durch dünne Wände rutscht
const MAX_MOVE_STEP = 0.25


// Die untersten Zentimeter des Körpers kollidieren nicht seitlich - sonst
// hängt man an der Oberkante der Kiste fest, auf der man steht.
const STEP_CLEARANCE = 0.15
// Wie hoch ein Rampenpunkt unter der Standfläche über den Füßen liegen
// darf, um als Boden zu zählen (verhindert Hochziehen von der Seite)
const MAX_RAMP_STEP = 0.5


export interface HealthState {
  current: number
  max: number
}

export interface ShieldState {
  current: number
  max: number
}

export interface StaminaState {
  current: number
  max: number
}

// Das Format liegt in shared/protocol.ts, weil auch der Server es kennen muss.
export type { PlayerNetworkState } from './shared/protocol'

export class Player implements Damageable {
  private velocity = new THREE.Vector3()
  // Horizontal in m/s (velocity.y bleibt die Fallgeschwindigkeit)
  private horizontalVelocity = new THREE.Vector2()
  private sliding = false
  private slideCooldown = 0
  private crouchPressed = false
  private groundTime = Infinity // seit der letzten Landung
  private jumpBuffer = 0
  private padCooldown = 0
  onSlide?: () => void
  private onGround = true
  onJump?: () => void
  // fallSpeed in m/s beim Aufsetzen
  onLand?: (fallSpeed: number) => void
  private solids: Solid[]
  private ramps: Ramp[]

  // Relativ zur Blickrichtung, je [-1, 1]: x = rechts, z = vorwärts
  private moveInputX = 0
  private moveInputZ = 0
  private camera: THREE.PerspectiveCamera

  // Eingabe vs. tatsächlicher Zustand (Aufstehen nur mit Kopffreiheit)
  private wantsToCrouch = false
  private isCrouching = false
  private eyeHeight = EYE_HEIGHT

  private aiming = false
  // Lehnen: Wunsch (-1 links, 0, 1 rechts), weich nachgeführt, und was nach Wandprüfung gilt
  private leanInput = 0
  private leanSmooth = 0
  private leanEffective = 0
  // Seitlicher Versatz, der gerade auf camera.position liegt (Körperposition = Kamera minus Versatz)
  private leanApplied = new THREE.Vector3()
  private wantsToSprint = false
  private isSprinting = false
  private stamina = MAX_STAMINA


  // Fuß-Höhe; Schwerkraft/Sprung wirken nur hier, die (Duck-)Augenhöhe
  // kommt getrennt dazu, damit Ducken nicht mit der Fallphysik vermischt wird
  private bodyY = 0

  private vitals: Vitals = { health: MAX_HEALTH, shield: MAX_SHIELD, shieldRegenCooldown: 0 }

  // Online entscheidet der Server über Schaden/Schild/Respawn
  networkControlled = false
  // Gehaltene Waffe bestimmt das Lauftempo (setzt main.ts)
  weapon: WeaponId = DEFAULT_WEAPON
  // Nur Anzeige (entscheidet der Server)
  spawnProtected = false
  private respawnRemaining = 0
  private spawnPoint = new THREE.Vector3()
  team: Team

  constructor(camera: THREE.PerspectiveCamera, solids: Solid[], ramps: Ramp[] = [], team: Team = 'blue') {
    this.camera = camera
    this.solids = solids
    this.ramps = ramps
    this.team = team
  }

  // Fußhöhe über dem Boden (Minimap: obere/untere Ebene)
  get feetHeight(): number {
    return this.bodyY
  }

  // Server-Korrektur: zurück an eine gültige Stelle, Leben/Ausdauer bleiben
  moveTo(position: THREE.Vector3) {
    this.camera.position.copy(position)
    this.resetLean()
    this.velocity.set(0, 0, 0)
    this.horizontalVelocity.set(0, 0)
    this.sliding = false
    this.bodyY = position.y - this.eyeHeight
  }

  spawn(position: THREE.Vector3) {
    this.spawnPoint.copy(position)
    this.camera.position.copy(position)
    this.resetLean()
    this.velocity.set(0, 0, 0)
    this.horizontalVelocity.set(0, 0)
    this.sliding = false
    this.slideCooldown = 0
    this.crouchPressed = false
    this.groundTime = Infinity
    this.jumpBuffer = 0
    this.vitals.health = MAX_HEALTH
    this.respawnRemaining = 0
    this.wantsToCrouch = false
    this.isCrouching = false
    this.eyeHeight = EYE_HEIGHT
    this.bodyY = position.y - EYE_HEIGHT
    this.wantsToSprint = false
    this.isSprinting = false
    this.stamina = MAX_STAMINA
    this.vitals.shield = MAX_SHIELD
    this.vitals.shieldRegenCooldown = 0
  }

  get isOnGround(): boolean {
    return this.onGround
  }

  get isSliding(): boolean {
    return this.sliding
  }

  get horizontalSpeed(): number {
    return this.horizontalVelocity.length()
  }

  get isAlive(): boolean {
    return this.vitals.health > 0
  }

  getHealthState(): HealthState {
    return { current: this.vitals.health, max: MAX_HEALTH }
  }

  getShieldState(): ShieldState {
    return { current: this.vitals.shield, max: MAX_SHIELD }
  }

  getStaminaState(): StaminaState {
    return { current: this.stamina, max: MAX_STAMINA }
  }

  getRespawnCountdown(): number {
    return this.respawnRemaining
  }

  // Wird 20x/s an den Server geschickt
  getNetworkState(): PlayerNetworkState {
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ')
    return {
      // Körperposition: ohne den Lehn-Versatz (der steckt im lean-Wert)
      position: {
        x: this.camera.position.x - this.leanApplied.x,
        y: this.camera.position.y,
        z: this.camera.position.z - this.leanApplied.z,
      },
      yaw: euler.y,
      health: this.vitals.health,
      maxHealth: MAX_HEALTH,
      isAlive: this.isAlive,
      crouching: this.isCrouching,
      sliding: this.sliding,
      eyeHeight: this.eyeHeight,
      sprinting: this.isSprinting,
      lean: this.leanEffective,
      shield: this.vitals.shield,
      maxShield: MAX_SHIELD,
      team: this.team,
      weapon: this.weapon,
    }
  }

  // Nur Singleplayer - online kommt Schaden über applyServerVitals()
  takeDamage(amount: number) {
    if (this.networkControlled) return
    if (applyDamage(this.vitals, amount)) this.die()
  }

  // Stand laut Server; Respawn kommt als eigene Nachricht (main.ts)
  applyServerVitals(health: number, shield: number, spawnProtected: boolean) {
    this.spawnProtected = spawnProtected
    const wasAlive = this.isAlive
    this.vitals.health = health
    this.vitals.shield = shield
    if (wasAlive && !this.isAlive) this.die()
  }

  private die() {
    this.respawnRemaining = RESPAWN_DELAY
    this.velocity.set(0, 0, 0)
    this.horizontalVelocity.set(0, 0)
    this.sliding = false
  }

  setMoveInput(x: number, z: number) {
    this.moveInputX = THREE.MathUtils.clamp(x, -1, 1)
    this.moveInputZ = THREE.MathUtils.clamp(z, -1, 1)
  }

  setCrouching(crouching: boolean) {
    if (crouching && !this.wantsToCrouch) this.crouchPressed = true
    this.wantsToCrouch = crouching
  }

  // Beim Zielen langsamer, kein Sprint
  setAiming(aiming: boolean) {
    this.aiming = aiming
  }

  get leanTarget() {
    return this.leanInput
  }

  // -1 links, 0 gerade, 1 rechts (Wunsch; die Kamera gleitet dorthin)
  setLean(direction: -1 | 0 | 1) {
    this.leanInput = direction
  }

  // -1..1: wie weit gelehnt (nach Wandprüfung), für Kippen der Kamera und die Figur der anderen
  get lean(): number {
    return this.leanEffective
  }

  setSprinting(sprinting: boolean) {
    this.wantsToSprint = sprinting
  }

  // Sprungpad: nach oben geschleudert, PAD_RISE m über die Fußhöhe; false in der Pause
  launchFromPad(): boolean {
    if (!this.isAlive || this.padCooldown > 0) return false
    const speed = Math.sqrt(2 * GRAVITY * PAD_RISE)
    this.velocity.y = speed
    this.onGround = false
    this.sliding = false
    this.jumpBuffer = 0
    this.padCooldown = PAD_RETRIGGER
    return true
  }

  jump() {
    if (!this.isAlive) return
    if (!this.onGround) {
      this.jumpBuffer = JUMP_BUFFER
      return
    }
    const speed = this.horizontalVelocity.length()
    if (this.groundTime <= BHOP_WINDOW && speed > this.crouchSpeed()) {
      this.horizontalVelocity.multiplyScalar(Math.max(1, Math.min(BHOP_MAX_SPEED, speed * BHOP_BOOST) / speed))
    }
    this.velocity.y = JUMP_SPEED
    this.onGround = false
    this.sliding = false
    this.jumpBuffer = 0
    this.onJump?.()
  }

  update(deltaSeconds: number) {
    // Lehn-Versatz vom letzten Frame wieder abziehen: Kollision und Physik rechnen mit der Körperposition
    this.camera.position.sub(this.leanApplied)
    this.leanApplied.set(0, 0, 0)

    if (!this.isAlive) {
      this.leanSmooth = 0
      this.leanEffective = 0
      this.respawnRemaining = Math.max(0, this.respawnRemaining - deltaSeconds)
      if (this.respawnRemaining === 0 && !this.networkControlled) {
        this.spawn(this.spawnPoint)
      }
      return
    }

    // isSprinting stammt hier noch vom letzten Frame
    this.slideCooldown = Math.max(0, this.slideCooldown - deltaSeconds)
    this.padCooldown = Math.max(0, this.padCooldown - deltaSeconds)
    this.jumpBuffer = Math.max(0, this.jumpBuffer - deltaSeconds)
    if (this.crouchPressed && this.onGround && this.isSprinting && this.slideCooldown === 0) {
      this.startSlide(SLIDE_BOOST)
    }
    this.crouchPressed = false

    // Ducken geht sofort, Aufstehen nur mit Kopffreiheit. Vor der Kollision,
    // damit tryMove() die richtige Körpergröße nutzt.
    if (this.wantsToCrouch) {
      this.isCrouching = true
    } else if (this.isCrouching && !this.canStandAt(this.camera.position.x, this.camera.position.z)) {
      this.isCrouching = true
    } else {
      this.isCrouching = false
    }

    // Augenhöhe gleichmäßig annähern statt springen
    const targetEyeHeight = this.isCrouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT
    const maxStep = CROUCH_TRANSITION_SPEED * deltaSeconds
    if (this.eyeHeight < targetEyeHeight) {
      // Wachsen durch eine Decke begrenzen (man kann inzwischen, z.B. im
      // Sprung, unter eine geraten sein)
      const headTop = this.bodyY + this.eyeHeight + 0.3
      const ceiling = this.ceilingAbove(this.camera.position.x, this.camera.position.z, headTop)
      const maxEye = ceiling - this.bodyY - 0.3
      this.eyeHeight = Math.min(targetEyeHeight, this.eyeHeight + maxStep, Math.max(this.eyeHeight, maxEye))
    } else if (this.eyeHeight > targetEyeHeight) {
      this.eyeHeight = Math.max(targetEyeHeight, this.eyeHeight - maxStep)
    }
    this.camera.position.y = this.bodyY + this.eyeHeight

    if (!this.networkControlled) regenerateShield(this.vitals, deltaSeconds)

    // Sprint nur ungeduckt, in Bewegung und mit Stamina
    const isMoving = this.moveInputX !== 0 || this.moveInputZ !== 0
    // Wer lehnt, sprintet nicht: man läuft gelehnt mit 75 % Tempo weiter (statt dass Laufen das Lehnen abbricht)
    if (this.wantsToSprint && !this.isCrouching && !this.aiming && isMoving && this.leanInput === 0) {
      this.isSprinting = this.isSprinting ? this.stamina > 0 : this.stamina >= MIN_STAMINA_TO_START_SPRINT
    } else {
      this.isSprinting = false
    }

    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_RATE * deltaSeconds)
    } else {
      this.stamina = Math.min(MAX_STAMINA, this.stamina + STAMINA_REGEN_RATE * deltaSeconds)
    }

    this.velocity.y -= GRAVITY * deltaSeconds

    if (this.sliding) this.updateSlide(deltaSeconds)
    if (!this.sliding) this.updateMomentum(deltaSeconds)
    this.moveHorizontally(deltaSeconds)

    // Fuß-Höhe vor dem Fallen als Referenz: nach schnellem Fall liegt bodyY
    // schon unter der Kante, auf der man landen soll
    const feetBefore = this.bodyY
    this.bodyY += this.velocity.y * deltaSeconds
    if (this.velocity.y > 0) this.stopAtCeiling(feetBefore)

    const groundHeight = this.groundHeightAt(this.camera.position.x, this.camera.position.z, feetBefore)

    if (this.bodyY <= groundHeight) {
      const landed = !this.onGround
      const fallSpeed = -this.velocity.y
      if (landed) this.onLand?.(fallSpeed)
      this.bodyY = groundHeight
      this.velocity.y = 0
      this.onGround = true
      if (landed) this.handleLanding(fallSpeed)
    } else {
      this.onGround = false
    }

    // Landung unter einem Bauteil (z.B. Fenster-Sockel) mit noch laufender
    // Duck-Animation: Kopf nicht in den Sturz ragen lassen
    const headroom =
      this.ceilingAbove(this.camera.position.x, this.camera.position.z, this.bodyY + STEP_CLEARANCE) -
      this.bodyY -
      0.3
    if (this.eyeHeight > headroom) this.eyeHeight = Math.max(CROUCH_EYE_HEIGHT, headroom)

    this.camera.position.y = this.bodyY + this.eyeHeight

    this.updateLean(deltaSeconds)
  }

  private resetLean() {
    this.leanSmooth = 0
    this.leanEffective = 0
    this.leanApplied.set(0, 0, 0)
  }

  // Gelehnt wird im Stehen, Gehen und Ducken (auch in Bewegung, dann ohne Sprint), nicht beim Rutschen. Die Kamera geht
  // seitlich, bis sie dicht an eine Wand kommt (hinter einer Kante hervorlugen, nie durch sie hindurch).
  private updateLean(deltaSeconds: number) {
    const target = this.sliding ? 0 : this.leanInput
    const step = LEAN_SPEED * deltaSeconds
    this.leanSmooth += THREE.MathUtils.clamp(target - this.leanSmooth, -step, step)

    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up)

    const side = Math.sign(this.leanSmooth)
    let reach = Math.abs(this.leanSmooth) * LEAN_DISTANCE
    if (side !== 0) reach = Math.min(reach, this.leanClearance(right, side))
    this.leanEffective = (side * reach) / LEAN_DISTANCE
    this.leanApplied.copy(right).multiplyScalar(side * reach)
    this.camera.position.add(this.leanApplied)
  }

  // Wie weit (m, höchstens LEAN_DISTANCE) die Kamera in Richtung right*side ohne Wandkontakt kommt
  private leanClearance(right: THREE.Vector3, side: number): number {
    const position = this.camera.position
    const y = position.y
    let free = 0
    for (let d = 0.05; d <= LEAN_DISTANCE + 1e-6; d += 0.05) {
      const x = position.x + right.x * side * d
      const z = position.z + right.z * side * d
      let blocked = false
      for (const solid of this.solids) {
        const box = solid.box
        if (
          x + LEAN_CAMERA_RADIUS > box.min.x &&
          x - LEAN_CAMERA_RADIUS < box.max.x &&
          z + LEAN_CAMERA_RADIUS > box.min.z &&
          z - LEAN_CAMERA_RADIUS < box.max.z &&
          y + 0.15 > box.min.y &&
          y - 0.15 < box.max.y
        ) {
          blocked = true
          break
        }
      }
      if (blocked) break
      free = d
    }
    return free
  }

  // Gewünschte Geschwindigkeit aus Eingabe, Blickrichtung und Tempo-Stufe
  private desiredVelocity(): THREE.Vector3 {
    const moveDirection = new THREE.Vector3()
    if (this.moveInputX === 0 && this.moveInputZ === 0) return moveDirection

    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()

    // cross(forward, up) ist in Three.js bereits "rechts" (kein negate)
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up)

    moveDirection.addScaledVector(forward, this.moveInputZ)
    moveDirection.addScaledVector(right, this.moveInputX)

    // Nur kürzen (Diagonale), nicht verlängern - der Touch-Joystick liefert
    // bewusst auch kurze Werte für langsames Gehen
    if (moveDirection.length() > 1) {
      moveDirection.normalize()
    }
    return moveDirection.multiplyScalar(this.stanceSpeed())
  }

  // Volles Tempo der aktuellen Haltung (Gehen/Sprint/Ducken)
  private stanceSpeed(): number {
    const speed =
      MOVE_SPEED * WEAPONS[this.weapon].moveSpeed * (this.aiming ? AIM_SPEED_MULTIPLIER : 1) * (this.leanEffective !== 0 ? LEAN_SPEED_MULTIPLIER : 1)
    if (this.isCrouching) return speed * CROUCH_SPEED_MULTIPLIER
    return this.isSprinting ? speed * SPRINT_SPEED_MULTIPLIER : speed
  }

  // Bis zum normalen Höchsttempo (Sprint, geduckt: Duck-Tempo) folgt man der
  // Eingabe sofort, auch beim Anhalten. Nur Schwung darüber (Rutschen,
  // Bunny-Hop) wird gelenkt und am Boden abgebremst. Früher galt schon das
  // Sprint-Tempo nach dem Loslassen als Schwung - man glitt meterweit nach.
  private updateMomentum(deltaSeconds: number) {
    const desired3 = this.desiredVelocity()
    const desired = new THREE.Vector2(desired3.x, desired3.z)
    const velocity = this.horizontalVelocity
    const desiredSpeed = desired.length()
    let speed = velocity.length()

    if (this.onGround) {
      this.groundTime += deltaSeconds
      const normalMax = this.isCrouching ? this.stanceSpeed() : this.sprintSpeed()
      if (this.groundTime > BHOP_WINDOW) speed = Math.max(0, speed - GROUND_FRICTION * deltaSeconds)
      if (speed <= normalMax + 1e-3) {
        velocity.copy(desired)
        return
      }
      // Bremse direkt aufs Tempo (über die Lenkung wirkte sie nur zu einem Bruchteil)
      velocity.setLength(speed)
      this.steer(desired, Math.max(speed, desiredSpeed), GROUND_CONTROL * deltaSeconds)
    } else if (desiredSpeed > 0) {
      this.steer(desired, Math.max(speed, desiredSpeed), AIR_CONTROL * deltaSeconds)
    }
  }

  private steer(desired: THREE.Vector2, speed: number, amount: number) {
    const velocity = this.horizontalVelocity
    const direction = desired.lengthSq() > 0 ? desired.clone() : velocity.clone()
    if (direction.lengthSq() === 0) return
    velocity.lerp(direction.setLength(speed), Math.min(1, amount))
  }

  private handleLanding(fallSpeed: number) {
    // Rampe hinab "landet" man jeden Frame minimal - das ist kein Hop
    if (fallSpeed > MIN_HOP_FALL_SPEED) this.groundTime = 0
    if (this.jumpBuffer > 0) {
      this.jump()
      return
    }
    // Mit gehaltenem Ducken und Schwung landen = weiterrutschen (ohne Schub)
    if (this.wantsToCrouch && this.slideCooldown === 0 && this.horizontalVelocity.length() > MOVE_SPEED * WEAPONS[this.weapon].moveSpeed) {
      this.startSlide(1)
    }
  }

  private sprintSpeed(): number {
    return MOVE_SPEED * WEAPONS[this.weapon].moveSpeed * SPRINT_SPEED_MULTIPLIER
  }

  private crouchSpeed(): number {
    return MOVE_SPEED * WEAPONS[this.weapon].moveSpeed * CROUCH_SPEED_MULTIPLIER
  }

  // Richtung = aktuelle Laufrichtung (nicht Blick), damit seitliches
  // Rutschen aus dem Strafe-Sprint heraus geht
  private startSlide(boost: number) {
    const speed = this.horizontalVelocity.length()
    if (speed < this.crouchSpeed()) return
    this.horizontalVelocity.multiplyScalar(Math.max(1, Math.min(SLIDE_MAX_SPEED, speed * boost) / speed))
    this.sliding = true
    this.isSprinting = false
    this.onSlide?.()
  }

  private updateSlide(deltaSeconds: number) {
    const speed = this.horizontalVelocity.length() - SLIDE_FRICTION * deltaSeconds
    if (!this.wantsToCrouch || !this.onGround || speed <= this.crouchSpeed()) {
      // Restschwung übernimmt updateMomentum()
      this.sliding = false
      this.slideCooldown = SLIDE_COOLDOWN
      return
    }
    this.horizontalVelocity.multiplyScalar(speed / this.horizontalVelocity.length())
  }

  // Wird eine Achse blockiert (Wand), verfällt dort auch der Schwung
  private moveHorizontally(deltaSeconds: number) {
    const dx = this.horizontalVelocity.x * deltaSeconds
    const dz = this.horizontalVelocity.y * deltaSeconds
    const length = Math.hypot(dx, dz)
    if (length === 0) return
    const steps = Math.ceil(length / MAX_MOVE_STEP)
    const position = this.camera.position
    const step = new THREE.Vector3(dx / steps, 0, dz / steps)
    for (let i = 0; i < steps; i++) {
      const beforeX = position.x
      const beforeZ = position.z
      this.tryMove(step)
      if (Math.abs(position.x - beforeX) < Math.abs(step.x) - 1e-6) {
        this.horizontalVelocity.x = 0
        step.x = 0
      }
      if (Math.abs(position.z - beforeZ) < Math.abs(step.z) - 1e-6) {
        this.horizontalVelocity.y = 0
        step.z = 0
      }
    }
  }

  // Kopf stößt beim Hochspringen an
  private stopAtCeiling(feetBefore: number) {
    const headBefore = feetBefore + this.eyeHeight + 0.3
    const ceiling = this.ceilingAbove(this.camera.position.x, this.camera.position.z, headBefore)
    if (this.bodyY + this.eyeHeight + 0.3 > ceiling) {
      this.bodyY = ceiling - this.eyeHeight - 0.3
      this.velocity.y = 0
    }
  }

  // Unterkante des niedrigsten Solids über headTop (Infinity wenn frei)
  private ceilingAbove(x: number, z: number, headTop: number): number {
    let ceiling = Infinity
    for (const solid of this.solids) {
      const box = solid.box
      if (
        x + PLAYER_RADIUS > box.min.x &&
        x - PLAYER_RADIUS < box.max.x &&
        z + PLAYER_RADIUS > box.min.z &&
        z - PLAYER_RADIUS < box.max.z &&
        box.min.y >= headTop - 1e-6
      ) {
        ceiling = Math.min(ceiling, box.min.y)
      }
    }
    return ceiling
  }

  // Höchste Stand-Höhe unter der ganzen Standfläche (nicht nur dem
  // Mittelpunkt - sonst fällt man an Kanten seitlich in die Kiste). Nur
  // Flächen bis eine kleine Stufe über referenceY (Füße) zählen, sonst würde
  // man auf Stürze oder Wände gezogen.
  private groundHeightAt(x: number, z: number, referenceY: number = Infinity): number {
    let height = 0
    for (const solid of this.solids) {
      const box = solid.box
      if (
        x + PLAYER_RADIUS > box.min.x &&
        x - PLAYER_RADIUS < box.max.x &&
        z + PLAYER_RADIUS > box.min.z &&
        z - PLAYER_RADIUS < box.max.z &&
        box.max.y <= referenceY + STEP_CLEARANCE
      ) {
        height = Math.max(height, box.max.y)
      }
    }
    for (const ramp of this.ramps) {
      const rampHeight = this.rampHeightUnderFootprint(ramp, x, z)
      if (rampHeight !== null && rampHeight <= referenceY + MAX_RAMP_STEP) {
        height = Math.max(height, rampHeight)
      }
    }
    return height
  }

  // Höchster Rampenpunkt unter der Standfläche (null = keine Berührung)
  private rampHeightUnderFootprint(ramp: Ramp, x: number, z: number): number | null {
    const minX = Math.max(x - PLAYER_RADIUS, ramp.minX)
    const maxX = Math.min(x + PLAYER_RADIUS, ramp.maxX)
    const minZ = Math.max(z - PLAYER_RADIUS, ramp.minZ)
    const maxZ = Math.min(z + PLAYER_RADIUS, ramp.maxZ)
    if (minX > maxX || minZ > maxZ) return null
    const along = ramp.ascending ? (ramp.axis === 'x' ? maxX : maxZ) : ramp.axis === 'x' ? minX : minZ
    return rampHeightAt(ramp, ramp.axis === 'x' ? along : minX, ramp.axis === 'z' ? along : minZ)
  }

  // X und Z getrennt (an Wänden entlanggleiten); bei Kollision per
  // Bisektion bis dicht ans Hindernis statt den Schritt zu verwerfen
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

    if (!this.blocksMove(position, target)) {
      return target[axis]
    }

    let safeFraction = 0
    let blockedFraction = 1
    const probe = position.clone()

    for (let i = 0; i < 8; i++) {
      const midFraction = (safeFraction + blockedFraction) / 2
      probe[axis] = current + delta * midFraction

      if (this.blocksMove(position, probe)) {
        blockedFraction = midFraction
      } else {
        safeFraction = midFraction
      }
    }

    return current + delta * safeFraction
  }

  // Blockiert nur, was TIEFER in ein Hindernis führt - wer minimal in
  // einer Wand steckt oder sie nur berührt, kommt so immer wieder heraus
  private blocksMove(from: THREE.Vector3, to: THREE.Vector3): boolean {
    for (const solid of this.solids) {
      const overlapAfter = this.bodyOverlapArea(to, solid.box)
      if (overlapAfter > 0 && overlapAfter > this.bodyOverlapArea(from, solid.box) + 1e-9) {
        return true
      }
    }
    return false
  }

  // Überschneidungsfläche (X/Z) von Körper und Solid, 0 bei bloßer Berührung
  private bodyOverlapArea(position: THREE.Vector3, box: THREE.Box3): number {
    const bottom = position.y - this.eyeHeight + STEP_CLEARANCE
    const top = position.y + 0.3
    if (Math.min(top, box.max.y) - Math.max(bottom, box.min.y) <= 0) return 0
    const overlapX = Math.min(position.x + PLAYER_RADIUS, box.max.x) - Math.max(position.x - PLAYER_RADIUS, box.min.x)
    const overlapZ = Math.min(position.z + PLAYER_RADIUS, box.max.z) - Math.max(position.z - PLAYER_RADIUS, box.min.z)
    if (overlapX <= 0 || overlapZ <= 0) return 0
    return overlapX * overlapZ
  }

  // Kopffreiheit zum Aufstehen, ab aktueller Fuß-Höhe (auch in der Luft)
  private canStandAt(x: number, z: number): boolean {
    const bottom = this.bodyY + CROUCH_EYE_HEIGHT
    const top = this.bodyY + EYE_HEIGHT + 0.3

    for (const solid of this.solids) {
      const box = solid.box
      if (
        x + PLAYER_RADIUS > box.min.x &&
        x - PLAYER_RADIUS < box.max.x &&
        z + PLAYER_RADIUS > box.min.z &&
        z - PLAYER_RADIUS < box.max.z &&
        top > box.min.y &&
        bottom < box.max.y
      ) {
        return false
      }
    }
    return true
  }
}
