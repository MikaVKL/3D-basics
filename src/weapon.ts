import * as THREE from 'three'
import { Palette } from './palette'
import { WeaponView } from './weaponView'

// Einfachste Form von Ego-Shooter-"Schießen": ein Hitscan-Raycast genau aus
// der Bildschirmmitte (dahin zeigt ja das Fadenkreuz), plus ein sichtbares
// Waffenmodell mit Rückstoß/Mündungsfeuer (siehe weaponView.ts). Noch keine
// Munition, kein Schaden an Gegnern - das kommt in späteren kleinen Schritten.

const FIRE_COOLDOWN = 0.15 // Sekunden zwischen zwei Schüssen (verhindert Spam)
const IMPACT_MARKER_LIFETIME = 2 // Sekunden, bis ein Einschussloch wieder verschwindet

interface ImpactMarker {
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

  private camera: THREE.Camera
  private scene: THREE.Scene
  private shootables: THREE.Object3D[]
  private view: WeaponView

  constructor(camera: THREE.Camera, scene: THREE.Scene, shootables: THREE.Object3D[]) {
    this.camera = camera
    this.scene = scene
    this.shootables = shootables
    this.view = new WeaponView(camera)
  }

  // Muss jeden Frame aufgerufen werden, damit Feuerpause und die
  // Einschuss-Marker (die nach einer Weile wieder verschwinden) funktionieren.
  update(deltaSeconds: number) {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - deltaSeconds)
    this.view.update(deltaSeconds)

    for (let i = this.impactMarkers.length - 1; i >= 0; i--) {
      const marker = this.impactMarkers[i]
      marker.remainingLifetime -= deltaSeconds
      if (marker.remainingLifetime <= 0) {
        this.scene.remove(marker.mesh)
        this.impactMarkers.splice(i, 1)
      }
    }
  }

  // Versucht, einen Schuss auszulösen. Schlägt fehl (macht nichts), solange
  // die Feuerpause noch läuft.
  tryShoot() {
    if (this.cooldownRemaining > 0) return
    this.cooldownRemaining = FIRE_COOLDOWN
    this.view.playShootEffect()

    // (0, 0) in normalisierten Bildschirmkoordinaten ist die Bildschirmmitte -
    // exakt dort, wo das Fadenkreuz sitzt.
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera)

    const hits = this.raycaster.intersectObjects(this.shootables, false)
    if (hits.length === 0) return

    this.spawnImpactMarker(hits[0])
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
}
