// Rauchgranate: Wurf (Flugbahn gegen die Arena), fliegende Granate und Rauchwolke.
// Der Rauch ist reine Sichtsperre (Schüsse gehen hindurch). Der Werfer simuliert den Flug und
// meldet nur Start, Landepunkt und Flugzeit; alle zeigen denselben Bogen und dieselbe Wolke.

import * as THREE from 'three'
import { GADGETS, DEFAULT_GADGET, type GadgetId } from './shared/gadgets'
import { TeamColor, type Team } from './team'

const THROW_SPEED = 15 // m/s
const THROW_LIFT = 0.18 // Wurf leicht nach oben (Anteil der Geschwindigkeit)
const GRAVITY = 16
const STEP = 1 / 60
const MIN_FLIGHT = 0.15 // kürzeste gezeigte Flugzeit (Animation)
const MIN_THROW_TIME = 0.03 // darunter steckt man mit der Nase in der Wand: kein Wurf
const CLOUD_BLOBS = 14
const GROW_TIME = 0.6
const SHRINK_TIME = 1.5

interface Flight {
  mesh: THREE.Mesh
  from: THREE.Vector3
  to: THREE.Vector3
  duration: number
  elapsed: number
  arc: number
  onLand: (position: THREE.Vector3) => void
}

interface Cloud {
  group: THREE.Group
  blobs: Array<{ mesh: THREE.Mesh; base: number; spin: number }>
  age: number
  duration: number
  radius: number
}

export interface ThrowResult {
  from: THREE.Vector3
  to: THREE.Vector3
  flight: number
}

export class GadgetSystem {
  readonly gadget: GadgetId = DEFAULT_GADGET
  cooldownRemaining = 0
  readonly clouds: Cloud[] = []
  private readonly flights: Flight[] = []
  private readonly scene: THREE.Scene
  private readonly world: THREE.Object3D[]
  private readonly raycaster = new THREE.Raycaster()
  private readonly grenadeGeometry = new THREE.IcosahedronGeometry(0.11, 0)
  private readonly blobGeometry = new THREE.IcosahedronGeometry(1, 1)
  private readonly blobMaterials = [0xb7c3d3, 0xa6b3c6, 0xc4cfdd].map(
    (color) => new THREE.MeshLambertMaterial({ color, emissive: 0x3a465a, flatShading: true, side: THREE.DoubleSide })
  )
  // Landung (für den Ton) und Wurf melden
  onLand?: (position: THREE.Vector3) => void

  constructor(scene: THREE.Scene, world: THREE.Object3D[]) {
    this.scene = scene
    this.world = world
  }

  get stats() {
    return GADGETS[this.gadget]
  }

  get ready(): boolean {
    return this.cooldownRemaining <= 0
  }

  // Neues Leben: Granate wieder bereit
  reset() {
    this.cooldownRemaining = 0
  }

  // Werfen aus der Kamera: Flugbahn gegen die Arena rechnen, Flug und Wolke starten
  tryThrow(camera: THREE.Camera, team: Team): ThrowResult | null {
    if (!this.ready) return null
    const direction = new THREE.Vector3()
    camera.getWorldDirection(direction)
    const from = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(direction, 0.4)
    from.y -= 0.15
    const velocity = direction.clone().multiplyScalar(THROW_SPEED)
    velocity.y += THROW_SPEED * THROW_LIFT

    const position = from.clone()
    let flight = 0
    const maxFlight = this.stats.maxFlightTime
    while (flight < maxFlight) {
      const next = position.clone().addScaledVector(velocity, STEP)
      next.y -= 0.5 * GRAVITY * STEP * STEP
      velocity.y -= GRAVITY * STEP
      const segment = next.clone().sub(position)
      const length = segment.length()
      let landed = false
      if (length > 1e-6) {
        this.raycaster.set(position, segment.clone().divideScalar(length))
        this.raycaster.far = length
        const hit = this.raycaster.intersectObjects(this.world, false)[0]
        if (hit) {
          // Knapp vor der Fläche bleiben, damit die Wolke nicht in der Wand beginnt
          const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0)
          position.copy(hit.point).addScaledVector(normal, 0.25)
          if (normal.y > 0.5) {
            landed = true
          } else {
            // Wand oder Decke: abprallen und herunterfallen, die Wolke liegt am Boden
            velocity.set(normal.x * 1.5, Math.min(velocity.y, 0), normal.z * 1.5)
            flight += STEP
            continue
          }
        }
      }
      if (!landed && next.y <= 0.15) {
        // Boden (auch wo keine Bodenfläche liegt, z. B. im Tunnel)
        next.y = 0.15
        position.copy(next)
        landed = true
      }
      if (landed) {
        flight += STEP
        break
      }
      position.copy(next)
      flight += STEP
    }
    if (flight < MIN_THROW_TIME) return null
    this.cooldownRemaining = this.stats.cooldown
    this.spawnFlight(from, position.clone(), flight, team)
    return { from, to: position.clone(), flight }
  }

  // Auch für die Würfe anderer (Server-Meldung): Bogen zeigen, bei der Landung die Wolke
  spawnFlight(from: THREE.Vector3, to: THREE.Vector3, duration: number, team: Team) {
    const mesh = new THREE.Mesh(
      this.grenadeGeometry,
      new THREE.MeshBasicMaterial({ color: TeamColor[team], fog: false })
    )
    mesh.position.copy(from)
    this.scene.add(mesh)
    const distance = from.distanceTo(to)
    this.flights.push({
      mesh,
      from: from.clone(),
      to: to.clone(),
      duration: Math.max(MIN_FLIGHT, duration),
      elapsed: 0,
      arc: Math.min(5, 0.5 + distance * 0.12),
      onLand: (position) => this.spawnCloud(position),
    })
  }

  spawnCloud(position: THREE.Vector3) {
    const stats = this.stats
    const group = new THREE.Group()
    group.position.copy(position)
    const blobs: Cloud['blobs'] = []
    for (let i = 0; i < CLOUD_BLOBS; i++) {
      // Kugelverteilung, nach unten gedrückt (Rauch quillt am Boden)
      const offset = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.7, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(stats.radius * 0.55 * Math.sqrt(Math.random()))
      const base = stats.radius * (0.38 + Math.random() * 0.22)
      const mesh = new THREE.Mesh(this.blobGeometry, this.blobMaterials[i % this.blobMaterials.length])
      mesh.position.copy(offset)
      mesh.position.y = Math.max(base * 0.35, mesh.position.y + stats.radius * 0.3)
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
      mesh.scale.setScalar(0.001)
      group.add(mesh)
      blobs.push({ mesh, base, spin: (Math.random() - 0.5) * 0.4 })
    }
    this.scene.add(group)
    this.clouds.push({ group, blobs, age: 0, duration: stats.duration, radius: stats.radius })
    this.onLand?.(position)
  }

  update(deltaSeconds: number) {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - deltaSeconds)

    for (let i = this.flights.length - 1; i >= 0; i--) {
      const flight = this.flights[i]
      flight.elapsed += deltaSeconds
      const t = Math.min(1, flight.elapsed / flight.duration)
      flight.mesh.position.lerpVectors(flight.from, flight.to, t)
      flight.mesh.position.y += flight.arc * 4 * t * (1 - t)
      flight.mesh.rotation.x += deltaSeconds * 9
      if (t >= 1) {
        this.scene.remove(flight.mesh)
        ;(flight.mesh.material as THREE.Material).dispose()
        this.flights.splice(i, 1)
        flight.onLand(flight.to)
      }
    }

    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const cloud = this.clouds[i]
      cloud.age += deltaSeconds
      if (cloud.age >= cloud.duration) {
        this.scene.remove(cloud.group)
        this.clouds.splice(i, 1)
        continue
      }
      // Aufquellen am Anfang, Schrumpfen am Ende
      const grow = Math.min(1, cloud.age / GROW_TIME)
      const shrink = Math.min(1, (cloud.duration - cloud.age) / SHRINK_TIME)
      const scale = (1 - (1 - grow) * (1 - grow)) * shrink
      for (const blob of cloud.blobs) {
        blob.mesh.scale.setScalar(Math.max(0.001, blob.base * scale))
        blob.mesh.rotation.y += blob.spin * deltaSeconds
      }
    }
  }

  // Liegt der Punkt in einer Wolke (z. B. für die Sichtprüfung im Test)?
  insideCloud(point: THREE.Vector3): boolean {
    return this.clouds.some((c) => c.group.position.distanceTo(point) < c.radius * 0.7)
  }
}
