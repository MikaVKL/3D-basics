import * as THREE from 'three'
import type { Solid, Ramp } from './arena'
import { rampHeightAt } from './arena'
import type { Damageable } from './damageable'
import type { Team } from './team'
import type { PlayerNetworkState } from './shared/protocol'
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
const JUMP_SPEED = 7.6 // ~1.6m Sprunghöhe: reicht für die 1.4m-Kisten
const GRAVITY = 18
const PLAYER_RADIUS = 0.4

const MAX_STAMINA = 100
const STAMINA_DRAIN_RATE = 25 // pro Sekunde (~4s Dauersprint)
const STAMINA_REGEN_RATE = 15
// Mindestvorrat zum Starten eines Sprints (verhindert Start-Stopp-Flackern
// bei fast leerem Vorrat); einmal gestartet, läuft er bis 0
const MIN_STAMINA_TO_START_SPRINT = 15


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
  private onGround = true
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

  private wantsToSprint = false
  private isSprinting = false
  private stamina = MAX_STAMINA


  // Fuß-Höhe; Schwerkraft/Sprung wirken nur hier, die (Duck-)Augenhöhe
  // kommt getrennt dazu, damit Ducken nicht mit der Fallphysik vermischt wird
  private bodyY = 0

  private vitals: Vitals = { health: MAX_HEALTH, shield: MAX_SHIELD, shieldRegenCooldown: 0 }

  // Online entscheidet der Server über Schaden/Schild/Respawn
  networkControlled = false
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

  spawn(position: THREE.Vector3) {
    this.spawnPoint.copy(position)
    this.camera.position.copy(position)
    this.velocity.set(0, 0, 0)
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
      position: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      },
      yaw: euler.y,
      health: this.vitals.health,
      maxHealth: MAX_HEALTH,
      isAlive: this.isAlive,
      crouching: this.isCrouching,
      sprinting: this.isSprinting,
      shield: this.vitals.shield,
      maxShield: MAX_SHIELD,
      team: this.team,
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
  }

  setMoveInput(x: number, z: number) {
    this.moveInputX = THREE.MathUtils.clamp(x, -1, 1)
    this.moveInputZ = THREE.MathUtils.clamp(z, -1, 1)
  }

  setCrouching(crouching: boolean) {
    this.wantsToCrouch = crouching
  }

  setSprinting(sprinting: boolean) {
    this.wantsToSprint = sprinting
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
      if (this.respawnRemaining === 0 && !this.networkControlled) {
        this.spawn(this.spawnPoint)
      }
      return
    }

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
    if (this.wantsToSprint && !this.isCrouching && isMoving) {
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

    if (this.moveInputX !== 0 || this.moveInputZ !== 0) {
      const moveDirection = new THREE.Vector3()

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
      let speed = MOVE_SPEED
      if (this.isCrouching) {
        speed = MOVE_SPEED * CROUCH_SPEED_MULTIPLIER
      } else if (this.isSprinting) {
        speed = MOVE_SPEED * SPRINT_SPEED_MULTIPLIER
      }
      moveDirection.multiplyScalar(speed * deltaSeconds)

      this.tryMove(moveDirection)
    }

    // Fuß-Höhe vor dem Fallen als Referenz: nach schnellem Fall liegt bodyY
    // schon unter der Kante, auf der man landen soll
    const feetBefore = this.bodyY
    this.bodyY += this.velocity.y * deltaSeconds
    if (this.velocity.y > 0) this.stopAtCeiling(feetBefore)

    const groundHeight = this.groundHeightAt(this.camera.position.x, this.camera.position.z, feetBefore)

    if (this.bodyY <= groundHeight) {
      this.bodyY = groundHeight
      this.velocity.y = 0
      this.onGround = true
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
