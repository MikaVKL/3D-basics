// Waffenwerte für Client und Server (Server rechnet den Schaden selbst)

export type WeaponId = 'pistol' | 'rifle'

export interface WeaponStats {
  label: string
  damage: number // Körpertreffer; Kopf x HEADSHOT_MULTIPLIER
  fireInterval: number // Sekunden zwischen zwei Schüssen
  automatic: boolean // Dauerfeuer bei gehaltener Taste
  magazine: number
  reloadTime: number // Sekunden
  moveSpeed: number // Faktor auf die Laufgeschwindigkeit
  // Streuung (rad) wächst mit der "Hitze" des Dauerfeuers
  spreadPerHeat: number
  maxSpread: number
}

export const WEAPONS: Record<WeaponId, WeaponStats> = {
  pistol: {
    label: 'Pistole',
    damage: 20,
    fireInterval: 0.2,
    automatic: false,
    magazine: 12,
    reloadTime: 1.2,
    moveSpeed: 1,
    spreadPerHeat: 0,
    maxSpread: 0,
  },
  rifle: {
    label: 'Sturmgewehr',
    damage: 12,
    fireInterval: 0.1,
    automatic: true,
    magazine: 30,
    reloadTime: 2,
    moveSpeed: 0.92,
    spreadPerHeat: 0.006,
    maxSpread: 0.035,
  },
}

// Reihenfolge = Tasten 1, 2, ...
export const WEAPON_SLOTS: WeaponId[] = ['pistol', 'rifle']
export const DEFAULT_WEAPON: WeaponId = 'pistol'
export const SWITCH_TIME = 0.3 // Sekunden

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === 'string' && Object.hasOwn(WEAPONS, value)
}
