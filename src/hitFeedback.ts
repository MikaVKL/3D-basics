import * as THREE from 'three'

const HITMARKER_DURATION_MS = 150
const KILLMARKER_DURATION_MS = 400
const DAMAGE_INDICATOR_DURATION_MS = 1000
const DAMAGE_VIGNETTE_DURATION_MS = 250

// Rückmeldung rund ums Fadenkreuz:
// - Hitmarker (weiß, bei Kill rot und größer): "mein Schuss hat gesessen"
// - Schadens-Richtungsanzeiger: roter Bogen zeigt, aus welcher Richtung man
//   getroffen wurde - sonst sinkt nur der Lebensbalken und man weiß nicht,
//   wohin man sich drehen soll
// - kurzer roter Bildschirmrand beim eigenen Treffer
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

  // sourcePosition = wo der Angreifer (laut eigener Darstellung) steht
  showDamageFrom(sourcePosition: THREE.Vector3 | null, camera: THREE.Camera) {
    const now = performance.now()
    this.vignette.classList.add('visible')
    this.vignetteHideAt = now + DAMAGE_VIGNETTE_DURATION_MS
    if (!sourcePosition) return

    // In Kamera-Koordinaten umrechnen: -z ist "vor mir", +x ist "rechts".
    // Der Winkel wird fest beim Treffer berechnet, wie in den meisten
    // Shootern - der Bogen zeigt auf die Stelle, von der geschossen wurde.
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
