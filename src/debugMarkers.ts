import * as THREE from 'three'

// Debug-Marker (F1) für sonst Unsichtbares, z.B. Spawn-Punkte - nur zum Entwickeln

const MARKER_COLOR = 0xff00ff // kommt sonst nirgends vor
const MARKER_HEIGHT = 2.2

export class DebugMarkers {
  private group: THREE.Group

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()
    scene.add(this.group)
  }

  get visible(): boolean {
    return this.group.visible
  }

  setVisible(visible: boolean) {
    this.group.visible = visible
  }

  toggle() {
    this.group.visible = !this.group.visible
  }

  addSpawnPoint(position: THREE.Vector3, index: number) {
    const beamGeometry = new THREE.CylinderGeometry(0.08, 0.08, MARKER_HEIGHT, 8)
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: MARKER_COLOR,
      transparent: true,
      opacity: 0.6,
    })
    const beam = new THREE.Mesh(beamGeometry, beamMaterial)
    beam.position.set(position.x, MARKER_HEIGHT / 2, position.z)
    this.group.add(beam)

    const ringGeometry = new THREE.RingGeometry(0.3, 0.4, 16)
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: MARKER_COLOR,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(position.x, 0.02, position.z)
    this.group.add(ring)

    const label = createTextSprite(`Spawn ${index}`)
    label.position.set(position.x, MARKER_HEIGHT + 0.4, position.z)
    this.group.add(label)
  }

  addPoint(position: THREE.Vector3, label: string, color: number = MARKER_COLOR) {
    const beamGeometry = new THREE.CylinderGeometry(0.08, 0.08, MARKER_HEIGHT, 8)
    const beamMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 })
    const beam = new THREE.Mesh(beamGeometry, beamMaterial)
    beam.position.set(position.x, MARKER_HEIGHT / 2, position.z)
    this.group.add(beam)

    const labelSprite = createTextSprite(label, color)
    labelSprite.position.set(position.x, MARKER_HEIGHT + 0.4, position.z)
    this.group.add(labelSprite)
  }
}

// Text-Sprite über ein 2D-Canvas
function createTextSprite(text: string, color: number = MARKER_COLOR): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!

  const cssColor = `#${color.toString(16).padStart(6, '0')}`
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.font = 'bold 32px sans-serif'
  ctx.fillStyle = cssColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(1.6, 0.4, 1)
  return sprite
}
