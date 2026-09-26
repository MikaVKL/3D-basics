import * as THREE from 'three'
import { Palette } from './palette'
import { WeaponView } from './weaponView'
import type { Damageable } from './damageable'
import type { Team } from './team'
import { FIRE_COOLDOWN, HIT_DAMAGE } from './shared/gameRules'

// Hitscan aus der Bildschirmmitte, Munition, Nachladen. Treffer laufen
// generisch über Damageable (Dummy oder fremder Spieler).

const IMPACT_MARKER_LIFETIME = 2 // Sekunden
const TRACER_LIFETIME = 0.06 // Sekunden
const TRACER_MAX_DISTANCE = 60 // bei Schuss ins Leere

const MAGAZINE_SIZE = 12
const RELOAD_DURATION = 1.2 // Sekunden

export interface AmmoState {
  current: number
  max: number
  reloading: boolean
}

interface ImpactMarker {
  mesh: THREE.Mesh
  remainingLifetime: number
}

interface Tracer {
  mesh: THREE.Mesh
  remainingLifetime: number
}

export class Weapon {
  private raycaster = new THREE.Raycaster()
  private cooldownRemaining = 0
  private impactMarkers: ImpactMarker[] = []

  private markerGeometry = new THREE.SphereGeometry(0.04, 8, 8)
  private markerMaterial = new THREE.MeshBasicMaterial({
    color: Palette.accentNeon,
  })

  // Leuchtspur: 1 Einheit langer Zylinder, pro Schuss per scale.y gestreckt
  private tracers: Tracer[] = []
  private tracerGeometry = new THREE.CylinderGeometry(0.015, 0.015, 1, 6)
  private tracerMaterial = new THREE.MeshBasicMaterial({
    color: Palette.accentWarm,
  })

  private camera: THREE.Camera
  private scene: THREE.Scene
  private shootables: THREE.Object3D[]
  private view: WeaponView
  // Online vom Server zugeteilt
  shooterTeam: Team
  private onKill?: (killerTeam: Team) => void
  // Jeder Schuss (Mündung -> Einschlag), für die Leuchtspur bei anderen
  onShot?: (from: THREE.Vector3, to: THREE.Vector3) => void
  // Für den Hitmarker; kill nur lokal erkannt (Dummies), online meldet der Server
  onEnemyHit?: (kill: boolean) => void

  private ammo = MAGAZINE_SIZE
  private reloadRemaining = 0

  constructor(
    camera: THREE.Camera,
    scene: THREE.Scene,
    shootables: THREE.Object3D[],
    shooterTeam: Team,
    onKill?: (killerTeam: Team) => void
  ) {
    this.camera = camera
    this.scene = scene
    this.shootables = shootables
    this.view = new WeaponView(camera)
    this.shooterTeam = shooterTeam
    this.onKill = onKill
  }

  update(deltaSeconds: number) {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - deltaSeconds)
    this.view.update(deltaSeconds)

    if (this.reloadRemaining > 0) {
      this.reloadRemaining = Math.max(0, this.reloadRemaining - deltaSeconds)
      if (this.reloadRemaining === 0) {
        this.ammo = MAGAZINE_SIZE
      }
    }

    for (let i = this.impactMarkers.length - 1; i >= 0; i--) {
      const marker = this.impactMarkers[i]
      marker.remainingLifetime -= deltaSeconds
      if (marker.remainingLifetime <= 0) {
        this.scene.remove(marker.mesh)
        this.impactMarkers.splice(i, 1)
      }
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i]
      tracer.remainingLifetime -= deltaSeconds
      if (tracer.remainingLifetime <= 0) {
        this.scene.remove(tracer.mesh)
        this.tracers.splice(i, 1)
      }
    }
  }

  tryShoot() {
    if (this.reloadRemaining > 0) return
    if (this.ammo <= 0) {
      this.reload()
      return
    }
    if (this.cooldownRemaining > 0) return

    this.cooldownRemaining = FIRE_COOLDOWN
    this.ammo -= 1
    this.view.playShootEffect()

    // matrixWorld wird sonst erst beim Rendern aktualisiert - ein Schuss
    // direkt nach einer Mausbewegung zielte noch in die alte Richtung
    this.camera.updateMatrixWorld()

    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera)

    const muzzlePosition = this.view.getMuzzleWorldPosition(new THREE.Vector3())
    // Raycaster ignoriert "visible" nicht - tote Spieler fingen sonst Kugeln ab
    const hits = this.raycaster
      .intersectObjects(this.shootables, false)
      .filter((hit) => hit.object.visible)

    if (hits.length > 0) {
      const damageable = hits[0].object.userData.damageable as Damageable | undefined
      const targetTeam = hits[0].object.userData.team as Team | undefined

      if (damageable && (targetTeam === this.shooterTeam || damageable.invulnerable)) {
        // Teamkamerad oder Spawn-Schutz: wie ein Wand-Treffer
        this.spawnImpactMarker(hits[0])
      } else if (damageable) {
        const wasAlive = damageable.isAlive
        damageable.takeDamage(HIT_DAMAGE)
        const killed = wasAlive && !damageable.isAlive
        if (killed) {
          this.onKill?.(this.shooterTeam)
        }
        this.onEnemyHit?.(killed)
      } else {
        this.spawnImpactMarker(hits[0])
      }
      this.spawnTracer(muzzlePosition, hits[0].point)
      this.onShot?.(muzzlePosition, hits[0].point)
    } else {
      const missEnd = this.raycaster.ray.origin
        .clone()
        .addScaledVector(this.raycaster.ray.direction, TRACER_MAX_DISTANCE)
      this.spawnTracer(muzzlePosition, missEnd)
      this.onShot?.(muzzlePosition, missEnd)
    }

    if (this.ammo === 0) {
      this.reload()
    }
  }

  reload() {
    if (this.reloadRemaining > 0 || this.ammo === MAGAZINE_SIZE) return
    this.reloadRemaining = RELOAD_DURATION
  }

  getAmmoState(): AmmoState {
    return { current: this.ammo, max: MAGAZINE_SIZE, reloading: this.reloadRemaining > 0 }
  }

  private spawnImpactMarker(hit: THREE.Intersection) {
    const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial)
    marker.position.copy(hit.point)

    // Minimal entlang der (Welt-)Normale versetzen, gegen Z-Fighting
    if (hit.face) {
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      marker.position.addScaledVector(worldNormal, 0.01)
    }

    this.scene.add(marker)
    this.impactMarkers.push({ mesh: marker, remainingLifetime: IMPACT_MARKER_LIFETIME })
  }

  showRemoteTracer(start: THREE.Vector3, end: THREE.Vector3) {
    this.spawnTracer(start, end)
  }

  private spawnTracer(start: THREE.Vector3, end: THREE.Vector3) {
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (length < 0.001) return

    const mesh = new THREE.Mesh(this.tracerGeometry, this.tracerMaterial)
    mesh.scale.set(1, length, 1)
    mesh.position.copy(start).addScaledVector(direction, 0.5)

    // Zylinder zeigt entlang +Y -> in Schussrichtung drehen
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())

    this.scene.add(mesh)
    this.tracers.push({ mesh, remainingLifetime: TRACER_LIFETIME })
  }
}
