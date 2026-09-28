import type { PlayerId } from './shared/protocol'
import { WEAPONS, type WeaponId } from './shared/weapons'

const ENTRY_LIFETIME_MS = 6000
const MAX_ENTRIES = 5

// Umriss-Symbole (feste Strings, kein Nutzerinhalt)
const WEAPON_ICONS: Record<WeaponId, string> = {
  pistol: 'M2 2h17v4h-8l-1.5 6h-4l1.5-6H2z',
  rifle: 'M1 4h20V2h7v3h3v2H19l-2.5 5h-3l1.5-5H9l-2.5 4H2l1-3H1z',
  knife: 'M1 4.5h8v3H1zM9.5 3h1.5v6H9.5zM11 4.5h13l6 1.5-6 1.5H11z',
}

function weaponIcon(weapon: WeaponId): HTMLElement {
  const icon = document.createElement('span')
  icon.className = 'weapon-icon'
  icon.dataset.weapon = weapon
  icon.title = WEAPONS[weapon].label
  icon.innerHTML = `<svg viewBox="0 0 32 12" width="32" height="12"><path d="${WEAPON_ICONS[weapon]}" fill="currentColor"/></svg>`
  return icon
}

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
