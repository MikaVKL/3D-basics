import * as THREE from 'three'

// Dreht die Kamera anhand von Look-Deltas (z.B. Mausbewegung oder Touch-Wisch-Geste).
// Bewusst von der Eingabequelle getrennt: Maus- UND Touch-Steuerung rufen am Ende
// beide nur `rotate(deltaX, deltaY)` auf, damit die Dreh-Logik nicht doppelt
// geschrieben werden muss.
//
// 'YXZ'-Euler-Reihenfolge ist der Standard für Ego-Shooter-Kameras: erst Yaw
// (links/rechts, Y-Achse), dann Pitch (hoch/runter, X-Achse). So bleibt der
// Horizont beim Umschauen immer gerade (kein "Rollen" der Kamera).

const PITCH_LIMIT = Math.PI / 2 - 0.05 // knapp unter 90°, damit man nicht "durchdreht"

export class LookControl {
  private euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private camera: THREE.Camera
  private sensitivity: number

  constructor(camera: THREE.Camera, sensitivity: number = 0.0025) {
    this.camera = camera
    this.sensitivity = sensitivity
    this.euler.setFromQuaternion(camera.quaternion)
  }

  rotate(deltaX: number, deltaY: number) {
    this.euler.y -= deltaX * this.sensitivity
    this.euler.x -= deltaY * this.sensitivity
    this.euler.x = THREE.MathUtils.clamp(this.euler.x, -PITCH_LIMIT, PITCH_LIMIT)

    this.camera.quaternion.setFromEuler(this.euler)
  }
}
