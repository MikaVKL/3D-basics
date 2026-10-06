// Rauchgranate: Wurf (Flugbahn gegen die Arena), fliegende Granate und Rauchwolke.
// Der Rauch ist reine Sichtsperre (Schüsse gehen hindurch). Der Werfer simuliert den Flug und
// meldet nur Start, Landepunkt und Flugzeit; alle zeigen denselben Bogen und dieselbe Wolke.

import * as THREE from 'three'
import { GADGETS, DEFAULT_GADGET, blindDuration, blindStrength, type GadgetId } from './shared/gadgets'
import { TeamColor, type Team } from './team'

const THROW_SPEED = 15 // m/s
const THROW_LIFT = 0.18 // Wurf leicht nach oben (Anteil der Geschwindigkeit)
const GRAVITY = 16
const STEP = 1 / 60
const MIN_FLIGHT = 0.15 // kürzeste gezeigte Flugzeit (Animation)
const MIN_THROW_TIME = 0.03 // darunter steckt man mit der Nase in der Wand: kein Wurf
const CLOUD_CUBES = 240 // Rauch aus vielen kleinen Würfeln (Retro-Look, wie Feuer in alten Spielen)
const SMOKE_TONES = [0xa3afc1, 0x8793a8, 0xbac5d6, 0x6f7b91]
const GROW_TIME = 0.6
const SHRINK_TIME = 2.2
const DISSOLVE_TIME = 0.9 // so lange schrumpft ein einzelner Würfel am Ende

interface Flight {
  mesh: THREE.Mesh
  from: THREE.Vector3
  to: THREE.Vector3
  duration: number
  elapsed: number
  arc: number
  onLand: (position: THREE.Vector3) => void
}

interface Burst {
  mesh: THREE.Mesh
  age: number
}

interface SmokeCube {
  x: number
  y: number
  z: number
  size: number
  spin: number
  phase: number
  speed: number
  delay: number // Sekunden bis der Würfel auftaucht (außen später: die Wolke quillt nach außen)
  end: number // Alter, in dem er ganz verschwunden ist (außen früher: die Wolke löst sich von außen auf)
}

interface Cloud {
  group: THREE.Group
  mesh: THREE.InstancedMesh
  cubes: SmokeCube[]
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
  gadget: GadgetId = DEFAULT_GADGET
  cooldownRemaining = 0
  // Geblendet: Restzeit und Gesamtdauer (für das Ausblenden)
  blindRemaining = 0
  private blindTotal = 0
  private blindStrengthNow = 0 // höchste Stärke des laufenden Blendens (0..1)
  private readonly bursts: Burst[] = []
  // Blick des eigenen Spielers (für die Blendwirkung)
  viewer: THREE.Camera | null = null
  readonly clouds: Cloud[] = []
  private readonly flights: Flight[] = []
  private readonly scene: THREE.Scene
  private readonly world: THREE.Object3D[]
  private readonly raycaster = new THREE.Raycaster()
  private readonly grenadeGeometry = new THREE.IcosahedronGeometry(0.11, 0)
  private readonly burstGeometry = new THREE.IcosahedronGeometry(1, 1)
  private readonly cubeGeometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly cubeMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a3446, flatShading: true })
  private readonly tmpMatrix = new THREE.Matrix4()
  private readonly tmpQuat = new THREE.Quaternion()
  private readonly tmpScale = new THREE.Vector3()
  private readonly tmpPos = new THREE.Vector3()
  private readonly yAxis = new THREE.Vector3(0, 1, 0)
  private readonly tmpColor = new THREE.Color()
  // Landung (Rauch geht auf / Blendgranate knallt) für den Ton
  onLand?: (kind: GadgetId, position: THREE.Vector3) => void
  // Blendgranate hat bei dir gewirkt (Sekunden)
  onBlinded?: (seconds: number) => void

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
    this.blindRemaining = 0
    this.blindTotal = 0
    this.blindStrengthNow = 0
  }

  // Auswahl gilt ab dem nächsten Leben (startLife); die Abklingzeit bleibt
  setGadget(id: GadgetId) {
    this.gadget = id
  }

  // 0..1: erst voll weiß, dann weiches Ausblenden
  // Deckkraft des weißen Schleiers: Verlauf x Stärke (direkt hingesehen voll, schräg schwächer)
  get blindOpacity(): number {
    return this.blindLevel * this.blindStrengthNow
  }

  get blindLevel(): number {
    if (this.blindTotal <= 0 || this.blindRemaining <= 0) return 0
    const p = this.blindRemaining / this.blindTotal
    return p > 0.45 ? 1 : (p / 0.45) * (p / 0.45)
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
  spawnFlight(from: THREE.Vector3, to: THREE.Vector3, duration: number, team: Team, kind: GadgetId = this.gadget) {
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
      onLand: (position) => (kind === 'smoke' ? this.spawnCloud(position) : this.spawnBurst(kind, position)),
    })
  }

  // Blendgranate: kurzer Lichtblitz; wer zum Knall sieht (freie Sicht, Winkel, Abstand), ist geblendet
  spawnBurst(kind: GadgetId, position: THREE.Vector3) {
    const mesh = new THREE.Mesh(
      this.burstGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    )
    mesh.position.copy(position)
    this.scene.add(mesh)
    this.bursts.push({ mesh, age: 0 })
    this.onLand?.(kind, position)
    this.blindFrom(kind, position)
  }

  // Wirkung auf den eigenen Spieler (nur der sieht seinen Bildschirm)
  private blindFrom(kind: GadgetId, position: THREE.Vector3) {
    const camera = this.viewer
    if (!camera) return
    const eye = camera.getWorldPosition(new THREE.Vector3())
    const toBurst = position.clone().sub(eye)
    const distance = toBurst.length()
    if (distance < 0.01) return this.applyBlind(GADGETS[kind].blind?.maxTime ?? 0, 1)
    toBurst.divideScalar(distance)
    const forward = camera.getWorldDirection(new THREE.Vector3())
    const angle = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, forward.dot(toBurst)))))
    const seconds = blindDuration(GADGETS[kind], distance, angle)
    if (seconds <= 0) return
    // Wand dazwischen schützt
    this.raycaster.set(eye, toBurst)
    this.raycaster.far = Math.max(0, distance - 0.4)
    if (this.raycaster.intersectObjects(this.world, false).length > 0) return
    this.applyBlind(seconds, blindStrength(GADGETS[kind], angle))
  }

  private applyBlind(seconds: number, strength: number) {
    if (seconds <= 0) return
    this.blindStrengthNow = Math.max(this.blindStrengthNow, strength)
    this.blindRemaining = Math.max(this.blindRemaining, seconds)
    this.blindTotal = Math.max(this.blindTotal, this.blindRemaining)
    this.onBlinded?.(seconds)
  }

  spawnCloud(position: THREE.Vector3) {
    const stats = GADGETS.smoke
    const group = new THREE.Group()
    group.position.copy(position)
    const mesh = new THREE.InstancedMesh(this.cubeGeometry, this.cubeMaterial, CLOUD_CUBES)
    mesh.frustumCulled = false
    // Grobe Hülle für den Strahltest (die Würfel werden einzeln geprüft)
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, stats.radius * 0.5, 0), stats.radius * 1.6)
    const cubes: SmokeCube[] = []
    for (let i = 0; i < CLOUD_CUBES; i++) {
      // Gleichmäßig in einer am Boden abgeflachten Kugel; kleine Würfel außen, größere innen
      const direction = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      const reach = Math.cbrt(Math.random())
      const size = 0.3 + (1 - reach) * 0.35 + Math.random() * 0.2
      const x = direction.x * reach * stats.radius * 0.95
      const z = direction.z * reach * stats.radius * 0.95
      const y = Math.max(size * 0.5, stats.radius * 0.5 + direction.y * reach * stats.radius * 0.75)
      cubes.push({
        x,
        y,
        z,
        size,
        spin: (Math.random() - 0.5) * 1.2,
        phase: Math.random() * 6.28,
        speed: 0.5 + Math.random() * 0.8,
        delay: reach * 0.45 * Math.random() + reach * 0.1,
        end: stats.duration - 2.4 * reach * (0.4 + 0.6 * Math.random()),
      })
      mesh.setColorAt(i, this.tmpColor.setHex(SMOKE_TONES[i % SMOKE_TONES.length]))
    }
    group.add(mesh)
    this.scene.add(group)
    const cloud: Cloud = { group, mesh, cubes, age: 0, duration: stats.duration, radius: stats.radius }
    this.clouds.push(cloud)
    this.layoutCloud(cloud)
    this.onLand?.('smoke', position)
  }

  // 0..1: wie weit die Wolke steht (nur für die Dichte; die Würfel selbst blenden einzeln aus)
  private cloudScale(cloud: Cloud): number {
    const grow = Math.min(1, cloud.age / GROW_TIME)
    const shrink = Math.min(1, (cloud.duration - cloud.age) / SHRINK_TIME)
    return (1 - (1 - grow) * (1 - grow)) * Math.max(0, shrink)
  }

  // Würfel setzen: Die Wolke quillt von innen nach außen auf, jeder Würfel schwebt leicht, dreht
  // sich und löst sich zum Schluss einzeln auf (außen zuerst, steigt dabei auf und schrumpft)
  private layoutCloud(cloud: Cloud) {
    const spread = 1 - Math.pow(1 - Math.min(1, cloud.age / GROW_TIME), 2)
    for (let i = 0; i < cloud.cubes.length; i++) {
      const cube = cloud.cubes[i]
      const appear = THREE.MathUtils.smoothstep((cloud.age - cube.delay) / 0.5, 0, 1)
      const vanish = THREE.MathUtils.smoothstep((cube.end - cloud.age) / DISSOLVE_TIME, 0, 1)
      const bob = Math.sin(cloud.age * cube.speed + cube.phase) * 0.18
      const rise = (1 - vanish) * 1.3
      this.tmpPos.set(cube.x * spread, cube.y * spread + bob + rise, cube.z * spread)
      this.tmpQuat.setFromAxisAngle(this.yAxis, cube.phase + cloud.age * cube.spin)
      this.tmpScale.setScalar(Math.max(0.0005, cube.size * appear * vanish))
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale)
      cloud.mesh.setMatrixAt(i, this.tmpMatrix)
    }
    cloud.mesh.instanceMatrix.needsUpdate = true
  }

  // 0..1: wie dicht der Rauch um diesen Punkt ist (Kamera in der Wolke = nichts mehr zu sehen)
  smokeDensity(point: THREE.Vector3): number {
    let best = 0
    for (const cloud of this.clouds) {
      const reach = cloud.radius * 0.85 * this.cloudScale(cloud)
      if (reach <= 0.01) continue
      const centre = this.tmpPos.copy(cloud.group.position)
      centre.y += cloud.radius * 0.45
      const t = THREE.MathUtils.clamp((reach - point.distanceTo(centre)) / (reach * 0.5), 0, 1)
      best = Math.max(best, t * t * (3 - 2 * t))
    }
    return best
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

    if (this.blindRemaining > 0) {
      this.blindRemaining = Math.max(0, this.blindRemaining - deltaSeconds)
      if (this.blindRemaining === 0) {
        this.blindTotal = 0
        this.blindStrengthNow = 0
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i]
      burst.age += deltaSeconds
      const duration = GADGETS.flash.duration
      if (burst.age >= duration) {
        this.scene.remove(burst.mesh)
        ;(burst.mesh.material as THREE.Material).dispose()
        this.bursts.splice(i, 1)
        continue
      }
      const t = burst.age / duration
      burst.mesh.scale.setScalar(0.3 + 2.2 * Math.sqrt(t))
      ;(burst.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * (1 - t)
    }

    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const cloud = this.clouds[i]
      cloud.age += deltaSeconds
      if (cloud.age >= cloud.duration) {
        this.scene.remove(cloud.group)
        cloud.mesh.dispose()
        this.clouds.splice(i, 1)
        continue
      }
      this.layoutCloud(cloud)
    }
  }

  // Liegt der Punkt in einer Wolke (z. B. für die Sichtprüfung im Test)?
  insideCloud(point: THREE.Vector3): boolean {
    return this.clouds.some((c) => c.group.position.distanceTo(point) < c.radius * 0.7)
  }
}
