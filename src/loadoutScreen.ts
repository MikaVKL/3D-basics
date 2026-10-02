// Waffenauswahl (Fenster nach "Starten"): je eine Primary- und Secondary-Waffe als Karten,
// das Messer ist immer dabei. Die Wahl wird im Browser gemerkt.

import {
  DEFAULT_LOADOUT,
  PRIMARY_WEAPONS,
  SECONDARY_WEAPONS,
  WEAPONS,
  isLoadout,
  type Loadout,
  type WeaponId,
} from './shared/weapons'
import { weaponIcon } from './weaponIcons'

const STORAGE_KEY = 'duskArena.loadout'

const DESCRIPTIONS: Record<WeaponId, string> = {
  rifle: 'Allrounder, Dauerfeuer',
  shotgun: 'Nah: 8 Schrotkörner',
  sniper: 'Fern: Kopftreffer tötet',
  pistol: 'Zuverlässig, präzise',
  heavyPistol: 'Wuchtig, langsam',
  smg: 'Schnell, streut stark',
  knife: '',
}

// Balken 0..1, relativ zu den stärksten Werten aller Waffen
function statBars(id: WeaponId): Array<[string, number]> {
  const w = WEAPONS[id]
  const clamp = (v: number) => Math.min(1, Math.max(0.05, v))
  return [
    ['Schaden', clamp((w.damage * w.pellets) / 70)],
    ['Feuerrate', clamp(1 / w.fireInterval / 14)],
    ['Reichweite', clamp((w.falloff?.end ?? w.range) / 150)],
    ['Tempo', clamp((w.moveSpeed - 0.8) / 0.3)],
  ]
}

export function loadStoredLoadout(): Loadout {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (isLoadout(parsed)) return { primary: parsed.primary, secondary: parsed.secondary }
  } catch {
    // gesperrt oder kaputt: Standard
  }
  return { ...DEFAULT_LOADOUT }
}

function saveLoadout(loadout: Loadout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadout))
  } catch {
    // privater Modus: gilt nur für diese Sitzung
  }
}

export class LoadoutScreen {
  loadout: Loadout
  private readonly cards = new Map<WeaponId, HTMLButtonElement>()
  onChange?: (loadout: Loadout) => void

  constructor(primaryRow: HTMLElement, secondaryRow: HTMLElement) {
    this.loadout = loadStoredLoadout()
    this.fill(primaryRow, PRIMARY_WEAPONS, 'primary')
    this.fill(secondaryRow, SECONDARY_WEAPONS, 'secondary')
    this.refresh()
  }

  private fill(row: HTMLElement, ids: WeaponId[], slot: keyof Loadout) {
    for (const id of ids) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'weapon-card'
      card.dataset.weapon = id
      const name = document.createElement('strong')
      name.textContent = WEAPONS[id].label
      const description = document.createElement('span')
      description.className = 'card-description'
      description.textContent = DESCRIPTIONS[id]
      const bars = document.createElement('div')
      bars.className = 'card-bars'
      for (const [label, value] of statBars(id)) {
        const line = document.createElement('div')
        line.className = 'card-bar'
        line.title = label
        const fill = document.createElement('i')
        fill.style.width = `${Math.round(value * 100)}%`
        line.append(fill)
        bars.append(line)
      }
      card.append(weaponIcon(id, 1.4), name, description, bars)
      // Klick bleibt in der Auswahl (sonst würde der Overlay-Klick das Spiel starten)
      card.addEventListener('click', (event) => {
        event.stopPropagation()
        this.choose(slot, id)
      })
      this.cards.set(id, card)
      row.append(card)
    }
  }

  choose(slot: keyof Loadout, id: WeaponId) {
    if (this.loadout[slot] === id) return
    this.loadout = { ...this.loadout, [slot]: id }
    saveLoadout(this.loadout)
    this.refresh()
    this.onChange?.(this.loadout)
  }

  private refresh() {
    for (const [id, card] of this.cards) {
      const selected = id === this.loadout.primary || id === this.loadout.secondary
      card.classList.toggle('selected', selected)
      card.setAttribute('aria-pressed', String(selected))
    }
  }
}
