import * as THREE from 'three'
import { Palette } from './palette'

// Reine Optik: keine Kollision, nicht beschießbar (nicht in solids/shootables).
// Wandlampen ohne echte Lichtquelle (Leuchten per Sprite), Rampen-Schilder.

const LAMP_HEIGHT = 4.2
const LAMP_COLOR = 0xffc98a

function glowTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')!
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.3)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gradient
  g.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

// Lampen an einer Wand-Innenseite. normal = Richtung in den Raum
export interface LampRow {
  from: THREE.Vector3
  to: THREE.Vector3
  count: number
  normal: THREE.Vector3
}

// Alle Lampen gebündelt: Gehäuse und Leuchtstreifen je ein InstancedMesh,
// alle Leuchtpunkte eine Punktwolke - 3 Draw Calls statt 3 pro Lampe
export function addWallLamps(group: THREE.Group, rows: LampRow[]) {
  const placements: THREE.Matrix4[] = []
  for (const row of rows) {
    for (let i = 0; i < row.count; i++) {
      const t = row.count === 1 ? 0.5 : i / (row.count - 1)
      const position = row.from.clone().lerp(row.to, t).setY(LAMP_HEIGHT).addScaledVector(row.normal, 0.07)
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(row.normal.x, row.normal.z))
      placements.push(new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(1, 1, 1)))
    }
  }
  const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, offset: THREE.Vector3) => {
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length)
    const local = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z)
    placements.forEach((matrix, i) => mesh.setMatrixAt(i, matrix.clone().multiply(local)))
    group.add(mesh)
  }
  instanced(new THREE.BoxGeometry(0.7, 0.2, 0.14), new THREE.MeshStandardMaterial({ color: 0x1a202b, roughness: 0.6 }), new THREE.Vector3())
  instanced(
    new THREE.BoxGeometry(0.55, 0.08, 0.04),
    new THREE.MeshStandardMaterial({ color: LAMP_COLOR, emissive: LAMP_COLOR, emissiveIntensity: 1.6 }),
    new THREE.Vector3(0, -0.07, 0.06)
  )

  const glowPositions = placements.map((matrix) => new THREE.Vector3(0, -0.1, 0.35).applyMatrix4(matrix))
  const glow = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(glowPositions),
    new THREE.PointsMaterial({
      map: glowTexture(),
      color: LAMP_COLOR,
      size: 1.8,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  group.add(glow)
}

// Großer Buchstabe als Schild (Ansagen im Team: "Gegner auf A")
export function addLabel(group: THREE.Group, text: string, position: THREE.Vector3, normal: THREE.Vector3, size = 1.2) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')!
  const neon = `#${Palette.accentNeon.toString(16).padStart(6, '0')}`
  g.strokeStyle = neon
  g.lineWidth = 6
  g.strokeRect(6, 6, 116, 116)
  g.fillStyle = neon
  g.font = 'bold 84px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 64, 70)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
  )
  plane.position.copy(position).addScaledVector(normal, 0.02)
  plane.rotation.y = Math.atan2(normal.x, normal.z)
  group.add(plane)
}
