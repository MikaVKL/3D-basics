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
import { GADGETS, GADGET_IDS, DEFAULT_GADGET, isGadgetId, type GadgetId } from './shared/gadgets'

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

const GADGET_KEY = 'duskArena.gadget'
const GADGET_DESCRIPTIONS: Record<GadgetId, string> = {
  smoke: 'Sichtschutz für 8 s',
  flash: 'Blendet, wer hinsieht',
}

export function loadStoredGadget(): GadgetId {
  try {
    const stored = localStorage.getItem(GADGET_KEY)
    if (isGadgetId(stored)) return stored
  } catch {
    // gesperrt: Standard
  }
  return DEFAULT_GADGET
}

// Gadget-Wahl (Taste G): eine kleine Karte je Gadget, im Browser gemerkt
export class GadgetPicker {
  gadget: GadgetId
  onChange?: (gadget: GadgetId) => void
  private readonly cards = new Map<GadgetId, HTMLButtonElement>()

  constructor(row: HTMLElement) {
    this.gadget = loadStoredGadget()
    for (const id of GADGET_IDS) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'gadget-card'
      card.dataset.gadget = id
      const name = document.createElement('strong')
      name.textContent = GADGETS[id].label
      const description = document.createElement('span')
      description.className = 'card-description'
      description.textContent = GADGET_DESCRIPTIONS[id]
      card.append(name, description)
      card.addEventListener('click', (event) => {
        event.stopPropagation()
        this.choose(id)
      })
      this.cards.set(id, card)
      row.append(card)
    }
    this.refresh()
  }

  choose(id: GadgetId) {
    if (this.gadget === id) return
    this.gadget = id
    try {
      localStorage.setItem(GADGET_KEY, id)
    } catch {
      // privater Modus: gilt nur für diese Sitzung
    }
    this.refresh()
    this.onChange?.(id)
  }

  private refresh() {
    for (const [id, card] of this.cards) {
      card.classList.toggle('selected', id === this.gadget)
      card.setAttribute('aria-pressed', String(id === this.gadget))
    }
  }
}
