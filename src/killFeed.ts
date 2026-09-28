import type { PlayerId } from './shared/protocol'
import type { WeaponId } from './shared/weapons'
import { weaponIcon } from './weaponIcons'

const ENTRY_LIFETIME_MS = 6000
const MAX_ENTRIES = 5

// Kill-Anzeige oben rechts, eigene Kills/Tode hervorgehoben
export class KillFeed {
  private readonly container: HTMLElement
  private readonly entries: { element: HTMLElement; expiresAt: number }[] = []

  constructor(container: HTMLElement) {
    this.container = container
  }

  add(
    killer: PlayerId,
    victim: PlayerId,
    weapon: WeaponId,
    headshot: boolean,
    localId: PlayerId | null,
    nameOf: (id: PlayerId) => string
  ) {
    const name = (id: PlayerId) => (id === localId ? 'Du' : nameOf(id))
    const element = document.createElement('div')
    element.className = 'kill-entry'
    if (killer === localId) element.classList.add('own-kill')
    if (victim === localId) element.classList.add('own-death')
    element.append(name(killer), weaponIcon(weapon), name(victim))
    if (headshot) {
      const badge = document.createElement('span')
      badge.className = 'headshot-badge'
      badge.textContent = 'Kopftreffer'
      element.append(badge)
    }
    this.container.prepend(element)
    this.entries.push({ element, expiresAt: performance.now() + ENTRY_LIFETIME_MS })

    while (this.entries.length > MAX_ENTRIES) this.entries.shift()!.element.remove()
  }

  update() {
    const now = performance.now()
    while (this.entries.length > 0 && this.entries[0].expiresAt <= now) {
      this.entries.shift()!.element.remove()
    }
  }
}
