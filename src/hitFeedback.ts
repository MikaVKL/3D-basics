import * as THREE from 'three'

const HITMARKER_DURATION_MS = 150
const KILLMARKER_DURATION_MS = 400
const DAMAGE_INDICATOR_DURATION_MS = 1000
const DAMAGE_VIGNETTE_DURATION_MS = 250

// Hitmarker (bei Kill rot), Richtungsbogen zum Angreifer, roter Bildrand bei Schaden
export class HitFeedback {
  private readonly hitmarker: HTMLElement
  private readonly indicatorContainer: HTMLElement
  private readonly vignette: HTMLElement
  private hitmarkerHideAt = 0
  private vignetteHideAt = 0
  private readonly indicators: { element: HTMLElement; expiresAt: number }[] = []

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
    for (const indicator of this.indicators) {
      const remaining = (indicator.expiresAt - now) / DAMAGE_INDICATOR_DURATION_MS
      indicator.element.style.opacity = String(Math.min(1, remaining * 2))
    }
  }
}
