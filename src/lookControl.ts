import * as THREE from 'three'

// Kamera-Drehung für Maus und Touch. 'YXZ' (erst Yaw, dann Pitch) hält den
// Horizont gerade.

const PITCH_LIMIT = Math.PI / 2 - 0.05
const BASE_SENSITIVITY = 0.0025

export class LookControl {
  private euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private camera: THREE.Camera
  private sensitivity: number

  constructor(camera: THREE.Camera, sensitivity: number = BASE_SENSITIVITY) {
    this.camera = camera
    this.sensitivity = sensitivity
    this.euler.setFromQuaternion(camera.quaternion)
  }

  // Faktor aus den Einstellungen (1 = Grundwert)
  setSensitivityScale(scale: number) {
    this.sensitivity = BASE_SENSITIVITY * scale
  }

  rotate(deltaX: number, deltaY: number) {
    this.euler.y -= deltaX * this.sensitivity
    this.euler.x -= deltaY * this.sensitivity
    this.euler.x = THREE.MathUtils.clamp(this.euler.x, -PITCH_LIMIT, PITCH_LIMIT)

    this.camera.quaternion.setFromEuler(this.euler)
  }
}
