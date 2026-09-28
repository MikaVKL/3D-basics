import * as THREE from 'three'

const HITMARKER_DURATION_MS = 150
const KILLMARKER_DURATION_MS = 400
const DAMAGE_INDICATOR_DURATION_MS = 1000
const DAMAGE_VIGNETTE_DURATION_MS = 250
const DAMAGE_NUMBER_DURATION_MS = 700
const DAMAGE_NUMBER_RISE_PX = 40

interface DamageNumber {
  element: HTMLElement
  position: THREE.Vector3
  camera: THREE.Camera
  createdAt: number
  // Leicht versetzt, damit Zahlen bei Dauerfeuer nicht übereinander liegen
  offsetX: number
}

// Hitmarker (bei Kill rot), Schadenszahlen am Treffpunkt, Richtungsbogen zum
// Angreifer, roter Bildrand bei Schaden
export class HitFeedback {
  private readonly hitmarker: HTMLElement
  private readonly indicatorContainer: HTMLElement
  private readonly vignette: HTMLElement
  private hitmarkerHideAt = 0
  private vignetteHideAt = 0
  private readonly indicators: { element: HTMLElement; expiresAt: number }[] = []
  private readonly damageNumbers: DamageNumber[] = []

  constructor(hitmarker: HTMLElement, indicatorContainer: HTMLElement, vignette: HTMLElement) {
    this.hitmarker = hitmarker
    this.indicatorContainer = indicatorContainer
    this.vignette = vignette
  }

  showHit(kill: boolean) {
    this.hitmarker.classList.add('visible')
    this.hitmarker.classList.toggle('kill', kill)
    this.hitmarkerHideAt =
      performance.now() + (kill ? KILLMARKER_DURATION_MS : HITMARKER_DURATION_MS)
  }

  // Kopftreffer: rot und größer
  showDamageNumber(position: THREE.Vector3, damage: number, headshot: boolean, camera: THREE.Camera) {
    const element = document.createElement('div')
    element.className = headshot ? 'damage-number headshot' : 'damage-number'
    element.textContent = String(damage)
    document.body.appendChild(element)
    this.damageNumbers.push({
      element,
      position: position.clone(),
      camera,
      createdAt: performance.now(),
      offsetX: (Math.random() - 0.5) * 30,
    })
    this.placeDamageNumber(this.damageNumbers[this.damageNumbers.length - 1], 0)
  }

  // Jedes Bild neu aus 3D projiziert, damit die Zahl am Gegner "klebt"
  private placeDamageNumber(number: DamageNumber, progress: number) {
    const projected = number.position.clone().project(number.camera)
    const behind = projected.z > 1
    const x = (projected.x * 0.5 + 0.5) * window.innerWidth + number.offsetX
    const y = (-projected.y * 0.5 + 0.5) * window.innerHeight - progress * DAMAGE_NUMBER_RISE_PX
    number.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
    number.element.style.opacity = behind ? '0' : String(Math.min(1, (1 - progress) * 2.5))
  }

  showDamageFrom(sourcePosition: THREE.Vector3 | null, camera: THREE.Camera) {
    const now = performance.now()
    this.vignette.classList.add('visible')
    this.vignetteHideAt = now + DAMAGE_VIGNETTE_DURATION_MS
    if (!sourcePosition) return

    // Kamera-Koordinaten: -z = vorne, +x = rechts. Winkel fest beim Treffer.
    const local = camera.worldToLocal(sourcePosition.clone())
    const angle = Math.atan2(local.x, -local.z)

    const element = document.createElement('div')
    element.className = 'damage-indicator'
    element.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`
    this.indicatorContainer.appendChild(element)
    this.indicators.push({ element, expiresAt: now + DAMAGE_INDICATOR_DURATION_MS })
  }

  update() {
    const now = performance.now()
    if (now >= this.hitmarkerHideAt) this.hitmarker.classList.remove('visible')
    if (now >= this.vignetteHideAt) this.vignette.classList.remove('visible')
    while (this.indicators.length > 0 && this.indicators[0].expiresAt <= now) {
      this.indicators.shift()!.element.remove()
    }
    while (
      this.damageNumbers.length > 0 &&
      now - this.damageNumbers[0].createdAt >= DAMAGE_NUMBER_DURATION_MS
    ) {
      this.damageNumbers.shift()!.element.remove()
    }
    for (const number of this.damageNumbers) {
      this.placeDamageNumber(number, (now - number.createdAt) / DAMAGE_NUMBER_DURATION_MS)
    }
    for (const indicator of this.indicators) {
      const remaining = (indicator.expiresAt - now) / DAMAGE_INDICATOR_DURATION_MS
      indicator.element.style.opacity = String(Math.min(1, remaining * 2))
    }
  }
}
