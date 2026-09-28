import * as THREE from 'three'
import { Palette } from './palette'

// Kurzlebige Effekte: Mündungsleuchten, Einschlagfunken, Zerfall beim Tod.
// Jeder Effekt aktualisiert sich selbst und meldet, wann er fertig ist.

interface Effect {
  object: THREE.Object3D
  // false = fertig, wird entfernt
  update(deltaSeconds: number): boolean
  dispose?(): void
}

const GRAVITY = 12
const MUZZLE_LIFETIME = 0.06
const SPARK_COUNT = 14
const SPARK_LIFETIME = 0.35
const FRAGMENT_COUNT = 14
const FRAGMENT_LIFETIME = 1.4
const MAX_EFFECTS = 60

// Weicher, runder Leuchtpunkt als Textur (per Canvas, keine Bilddatei)
function createGlowTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.8)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

export class Effects {
  private readonly scene: THREE.Scene
  private readonly effects: Effect[] = []
  private readonly glowTexture = createGlowTexture()
  private readonly fragmentGeometry = new THREE.BoxGeometry(0.16, 0.16, 0.16)

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  get count(): number {
    return this.effects.length
  }

  private add(effect: Effect) {
    // Obergrenze gegen Leistungseinbruch bei Dauerfeuer vieler Spieler
    if (this.effects.length >= MAX_EFFECTS) this.remove(0)
    this.scene.add(effect.object)
    this.effects.push(effect)
  }

  private remove(index: number) {
    const [effect] = this.effects.splice(index, 1)
    this.scene.remove(effect.object)
    effect.dispose?.()
  }

  muzzleFlash(position: THREE.Vector3) {
    const material = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: Palette.accentNeon,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.position.copy(position)
    sprite.scale.setScalar(0.45)
    let remaining = MUZZLE_LIFETIME
    this.add({
      object: sprite,
      update: (dt) => {
        remaining -= dt
        material.opacity = Math.max(0, remaining / MUZZLE_LIFETIME)
        return remaining > 0
      },
      dispose: () => material.dispose(),
    })
  }

  impactSparks(position: THREE.Vector3, color: THREE.ColorRepresentation = Palette.accentWarm) {
    const positions = new Float32Array(SPARK_COUNT * 3)
    const velocities: THREE.Vector3[] = []
    for (let i = 0; i < SPARK_COUNT; i++) {
      positions.set([position.x, position.y, position.z], i * 3)
      velocities.push(
        new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5)
          .normalize()
          .multiplyScalar(2 + Math.random() * 3)
      )
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      color,
      size: 0.2,
      map: this.glowTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const points = new THREE.Points(geometry, material)
    let remaining = SPARK_LIFETIME
    this.add({
      object: points,
      update: (dt) => {
        remaining -= dt
        const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
        for (let i = 0; i < SPARK_COUNT; i++) {
          velocities[i].y -= GRAVITY * dt
          attribute.setXYZ(
            i,
            attribute.getX(i) + velocities[i].x * dt,
            attribute.getY(i) + velocities[i].y * dt,
            attribute.getZ(i) + velocities[i].z * dt
          )
        }
        attribute.needsUpdate = true
        material.opacity = Math.max(0, remaining / SPARK_LIFETIME)
        return remaining > 0
      },
      dispose: () => {
        geometry.dispose()
        material.dispose()
      },
    })
  }

  // Figur zerfällt in Teile in Teamfarbe, die fallen, am Boden liegen
  // bleiben und verblassen. groundY = Boden unter der Figur.
  deathBurst(center: THREE.Vector3, groundY: number, color: THREE.ColorRepresentation) {
    const group = new THREE.Group()
    const material = new THREE.MeshStandardMaterial({ color, transparent: true, emissive: color, emissiveIntensity: 0.3 })
    const fragments: { mesh: THREE.Mesh; velocity: THREE.Vector3; spin: THREE.Vector3 }[] = []
    for (let i = 0; i < FRAGMENT_COUNT; i++) {
      const mesh = new THREE.Mesh(this.fragmentGeometry, material)
      mesh.position.set(
        center.x + (Math.random() - 0.5) * 0.5,
        groundY + 0.2 + Math.random() * 1.6,
        center.z + (Math.random() - 0.5) * 0.5
      )
      mesh.scale.setScalar(0.6 + Math.random() * 0.9)
      group.add(mesh)
      fragments.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 3, (Math.random() - 0.5) * 4),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      })
    }
    let remaining = FRAGMENT_LIFETIME
    this.add({
      object: group,
      update: (dt) => {
        remaining -= dt
        for (const f of fragments) {
          f.velocity.y -= GRAVITY * dt
          f.mesh.position.addScaledVector(f.velocity, dt)
          const floor = groundY + 0.08 * f.mesh.scale.x
          if (f.mesh.position.y < floor) {
            f.mesh.position.y = floor
            f.velocity.set(f.velocity.x * 0.4, Math.abs(f.velocity.y) * 0.25, f.velocity.z * 0.4)
            f.spin.multiplyScalar(0.5)
          }
          f.mesh.rotation.x += f.spin.x * dt
          f.mesh.rotation.y += f.spin.y * dt
          f.mesh.rotation.z += f.spin.z * dt
        }
        // Erst in der letzten halben Sekunde ausblenden
        material.opacity = Math.min(1, remaining / 0.5)
        return remaining > 0
      },
      dispose: () => material.dispose(),
    })
  }

  update(deltaSeconds: number) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (!this.effects[i].update(deltaSeconds)) this.remove(i)
    }
  }
}

// Kamera-Ruck: kurzer, abklingender Versatz. Wird nur für das Rendern
// aufgeschlagen und danach wieder abgezogen, damit Bewegung/Blick unberührt bleiben.
export class CameraShake {
  private remaining = 0
  private duration = 0
  private strength = 0
  private readonly offset = new THREE.Vector3()

  shake(strength: number, duration: number) {
    // Stärkeres Wackeln nicht durch schwächeres überschreiben
    if (this.remaining > 0 && strength < this.strength * (this.remaining / this.duration)) return
    this.strength = strength
    this.duration = duration
    this.remaining = duration
  }

  apply(camera: THREE.Camera, deltaSeconds: number) {
    this.remaining = Math.max(0, this.remaining - deltaSeconds)
    const amount = this.duration > 0 ? this.strength * (this.remaining / this.duration) : 0
    this.offset.set((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount)
    camera.position.add(this.offset)
  }

  restore(camera: THREE.Camera) {
    camera.position.sub(this.offset)
    this.offset.set(0, 0, 0)
  }
}

// Rutschen aus eigener Sicht: Kamera leicht zur Seite gekippt, Sichtfeld
// etwas weiter. Die Neigung dreht nur um die Blickachse (Zielpunkt in der
// Bildmitte bleibt) und wird wie der Kamera-Ruck nur fürs Rendern aufgeschlagen.
const SLIDE_ROLL = 0.07 // rad
const SLIDE_FOV_BOOST = 7 // Grad
const SLIDE_BLEND_SPEED = 8 // pro Sekunde

export class SlideView {
  amount = 0
  private readonly baseFov: number
  private appliedRoll = 0

  constructor(camera: THREE.PerspectiveCamera) {
    this.baseFov = camera.fov
  }

  apply(camera: THREE.PerspectiveCamera, sliding: boolean, deltaSeconds: number) {
    const step = SLIDE_BLEND_SPEED * deltaSeconds
    this.amount += THREE.MathUtils.clamp((sliding ? 1 : 0) - this.amount, -step, step)
    const fov = this.baseFov + SLIDE_FOV_BOOST * this.amount
    if (camera.fov !== fov) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    this.appliedRoll = SLIDE_ROLL * this.amount
    camera.rotateZ(this.appliedRoll)
  }

  restore(camera: THREE.Camera) {
    camera.rotateZ(-this.appliedRoll)
    this.appliedRoll = 0
  }
}
