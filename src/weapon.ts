import * as THREE from 'three'
import { Palette } from './palette'
import { WeaponView } from './weaponView'
import type { Damageable } from './damageable'
import type { Team } from './team'
import { FIRE_COOLDOWN, HIT_DAMAGE } from './shared/gameRules'

// Hitscan-Raycast genau aus der Bildschirmmitte (dahin zeigt das Fadenkreuz),
// plus sichtbares Waffenmodell mit Rückstoß (siehe weaponView.ts), Munition
// und Nachladen. Getroffene Objekte werden generisch über die Damageable-
// Schnittstelle behandelt (siehe damageable.ts) - das ist absichtlich so
// entkoppelt, damit später Multiplayer-Gegner ohne Änderungen hier andocken.

const IMPACT_MARKER_LIFETIME = 2 // Sekunden, bis ein Einschussloch wieder verschwindet
const TRACER_LIFETIME = 0.06 // Sekunden, wie lange die Leuchtspur sichtbar bleibt
const TRACER_MAX_DISTANCE = 60 // Länge des Tracers, falls der Schuss nichts trifft (fliegt "ins Leere")

const MAGAZINE_SIZE = 12
const RELOAD_DURATION = 1.2 // Sekunden für einen Nachlade-Vorgang

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

  // Leuchtspur: ein dünner, langgezogener Zylinder von der Mündung bis zum
  // Einschlagpunkt. Die Basis-Geometrie ist 1 Einheit lang und wird pro
  // Schuss per scale.y auf die tatsächliche Distanz gestreckt - günstiger,
  // als für jeden Schuss eine neue Geometrie mit der passenden Länge zu bauen.
  private tracers: Tracer[] = []
  private tracerGeometry = new THREE.CylinderGeometry(0.015, 0.015, 1, 6)
  private tracerMaterial = new THREE.MeshBasicMaterial({
    color: Palette.accentWarm,
  })

  private camera: THREE.Camera
  private scene: THREE.Scene
  private shootables: THREE.Object3D[]
  private view: WeaponView
  // Im Multiplayer vom Server zugeteilt (siehe main.ts), daher änderbar
  shooterTeam: Team
  private onKill?: (killerTeam: Team) => void
  // Jeder abgegebene Schuss (Mündung -> Einschlag), damit andere Spieler
  // im Multiplayer die Leuchtspur sehen (siehe main.ts)
  onShot?: (from: THREE.Vector3, to: THREE.Vector3) => void
  // Treffer auf einen Gegner (für den Hitmarker); kill = lokal erkannter
  // Kill (Singleplayer-Dummies) - online meldet den Kill der Server
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

  // Muss jeden Frame aufgerufen werden, damit Feuerpause und die
  // Einschuss-Marker (die nach einer Weile wieder verschwinden) funktionieren.
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

  // Versucht, einen Schuss auszulösen. Schlägt fehl (macht nichts), solange
  // die Feuerpause noch läuft oder während des Nachladens. Das Magazin
  // wird automatisch nachgeladen, sobald es durch einen Schuss leer wird -
  // der ammo<=0-Fall unten ist nur eine Absicherung für den Fall, dass
  // tryShoot() trotzdem mit leerem Magazin aufgerufen wird.
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

    // Kamera-Matrix sicherstellen: Mausbewegung aktualisiert die Blickrichtung
    // sofort bei jedem 'mousemove', aber die matrixWorld der Kamera wird
    // normalerweise erst beim nächsten renderer.render() neu berechnet. Ohne
    // dieses explizite Update könnte ein Schuss direkt nach einer schnellen
    // Mausbewegung noch mit der (minimal) veralteten Blickrichtung zielen.
    this.camera.updateMatrixWorld()

    // (0, 0) in normalisierten Bildschirmkoordinaten ist die Bildschirmmitte -
    // exakt dort, wo das Fadenkreuz sitzt.
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera)

    const muzzlePosition = this.view.getMuzzleWorldPosition(new THREE.Vector3())
    // Unsichtbare Objekte (tote Spieler/Ziele) würden sonst Kugeln abfangen -
    // der Raycaster selbst ignoriert "visible" nicht.
    const hits = this.raycaster
      .intersectObjects(this.shootables, false)
      .filter((hit) => hit.object.visible)

    if (hits.length > 0) {
      // Generisch: könnte ein Ziel-Dummy oder (später) ein anderer Spieler
      // sein - weapon.ts muss den Unterschied nicht kennen, siehe damageable.ts.
      const damageable = hits[0].object.userData.damageable as Damageable | undefined
      const targetTeam = hits[0].object.userData.team as Team | undefined

      if (damageable && targetTeam === this.shooterTeam) {
        // Freundschaftliches Feuer: kein Schaden, verhält sich wie ein
        // normaler Wand-Treffer (statischer Marker statt Aufblitzen).
        this.spawnImpactMarker(hits[0])
      } else if (damageable) {
        // Treffer auf etwas Lebendes: Schaden statt des statischen
        // Einschuss-Markers - das Aufblitzen des Ziels ist hier das Feedback.
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
      // Kein Treffer: Tracer trotzdem bis zu einem weit entfernten Punkt in
      // Schussrichtung anzeigen, damit man sieht, dass (und wohin) man
      // "ins Leere" geschossen hat.
      const missEnd = this.raycaster.ray.origin
        .clone()
        .addScaledVector(this.raycaster.ray.direction, TRACER_MAX_DISTANCE)
      this.spawnTracer(muzzlePosition, missEnd)
      this.onShot?.(muzzlePosition, missEnd)
    }

    // Sofort nachladen, sobald das Magazin durch diesen Schuss leer wird -
    // nicht erst beim nächsten (dann folgenlosen) Schussversuch.
    if (this.ammo === 0) {
      this.reload()
    }
  }

  // Startet das Nachladen manuell (z.B. per Taste), falls das Magazin nicht
  // schon voll ist und nicht schon nachgeladen wird.
  reload() {
    if (this.reloadRemaining > 0 || this.ammo === MAGAZINE_SIZE) return
    this.reloadRemaining = RELOAD_DURATION
  }

  // Für die HUD-Anzeige (Munition/Nachladen).
  getAmmoState(): AmmoState {
    return { current: this.ammo, max: MAGAZINE_SIZE, reloading: this.reloadRemaining > 0 }
  }

  private spawnImpactMarker(hit: THREE.Intersection) {
    const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial)
    marker.position.copy(hit.point)

    // Ein winziges Stück entlang der Flächen-Normale nach außen versetzen,
    // sonst "flackert" die Kugel mit der getroffenen Wand/Kiste (Z-Fighting).
    // Die Normale muss dafür von lokalen Objekt- in Weltkoordinaten
    // umgerechnet werden (z.B. der Boden ist um 90° gedreht).
    if (hit.face) {
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      marker.position.addScaledVector(worldNormal, 0.01)
    }

    this.scene.add(marker)
    this.impactMarkers.push({ mesh: marker, remainingLifetime: IMPACT_MARKER_LIFETIME })
  }

  // Leuchtspur eines anderen Spielers (Multiplayer)
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

    // Der Zylinder zeigt standardmäßig entlang der Y-Achse - auf die
    // tatsächliche Schussrichtung drehen.
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())

    this.scene.add(mesh)
    this.tracers.push({ mesh, remainingLifetime: TRACER_LIFETIME })
  }
}
