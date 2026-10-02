// Waffenwerte für Client und Server (Server rechnet den Schaden selbst)

export type WeaponId = 'pistol' | 'rifle' | 'knife' | 'shotgun' | 'sniper' | 'heavyPistol' | 'smg'

export interface WeaponStats {
  label: string
  damage: number // Körpertreffer; Kopf x HEADSHOT_MULTIPLIER
  fireInterval: number // Sekunden zwischen zwei Schüssen
  automatic: boolean // Dauerfeuer bei gehaltener Taste
  magazine: number // 0 = Nahkampf, keine Munition
  reloadTime: number // Sekunden
  range: number // Meter
  moveSpeed: number // Faktor auf die Laufgeschwindigkeit
  // Streuung (rad) wächst mit der "Hitze" des Dauerfeuers
  spreadPerHeat: number
  maxSpread: number
  // Zielen (rechte Maustaste): Faktor auf das Blickfeld, 1 = kein Zielen (Messer)
  aimZoom: number
  // Schrot: Anzahl Körner je Schuss (damage gilt je Korn) und Kegelradius (rad)
  pellets: number
  pelletSpread: number
  // Schaden fällt zwischen start und end (Meter) linear auf den Faktor min
  falloff?: { start: number; end: number; min: number }
  // Zielfernrohr: beim Zielen Linsenbild statt Waffenmodell; hipSpread = Streuung (rad) ohne Zielen,
  // sie schwindet mit dem Zielen auf 0
  scoped?: boolean
  hipSpread?: number
}

export const WEAPONS: Record<WeaponId, WeaponStats> = {
  pistol: {
    label: 'Pistole',
    damage: 20,
    fireInterval: 0.2,
    automatic: false,
    magazine: 12,
    reloadTime: 1.2,
    range: 100,
    moveSpeed: 1,
    spreadPerHeat: 0,
    maxSpread: 0,
    aimZoom: 0.8,
    pellets: 1,
    pelletSpread: 0,
  },
  rifle: {
    label: 'Sturmgewehr',
    damage: 12,
    fireInterval: 0.1,
    automatic: true,
    magazine: 30,
    reloadTime: 2,
    range: 100,
    moveSpeed: 0.92,
    spreadPerHeat: 0.006,
    maxSpread: 0.035,
    aimZoom: 0.65,
    pellets: 1,
    pelletSpread: 0,
  },
  knife: {
    label: 'Messer',
    damage: 50,
    fireInterval: 0.5,
    automatic: true,
    magazine: 0,
    reloadTime: 0,
    range: 2.5,
    moveSpeed: 1.15,
    spreadPerHeat: 0,
    maxSpread: 0,
    aimZoom: 1,
    pellets: 1,
    pelletSpread: 0,
  },
  shotgun: {
    label: 'Shotgun',
    damage: 8, // je Korn, 8 Körner = 64 aus nächster Nähe
    fireInterval: 0.83,
    automatic: false,
    magazine: 6,
    reloadTime: 2.4,
    range: 30,
    moveSpeed: 0.95,
    spreadPerHeat: 0,
    maxSpread: 0,
    aimZoom: 0.85,
    pellets: 8,
    pelletSpread: 0.07,
    falloff: { start: 5, end: 16, min: 0.15 },
  },
  sniper: {
    label: 'Sniper',
    damage: 70, // Kopf x2 = 140 = Ein-Schuss-Kill
    fireInterval: 1.25,
    automatic: false,
    magazine: 5,
    reloadTime: 3,
    range: 150,
    moveSpeed: 0.85,
    spreadPerHeat: 0,
    maxSpread: 0,
    aimZoom: 0.25,
    pellets: 1,
    pelletSpread: 0,
    scoped: true,
    hipSpread: 0.05,
  },
  heavyPistol: {
    label: 'Schwere Pistole',
    damage: 45, // zwei Treffer + Schild, Kopf x2 = 90
    fireInterval: 0.5,
    automatic: false,
    magazine: 7,
    reloadTime: 1.8,
    range: 100,
    moveSpeed: 0.97,
    spreadPerHeat: 0,
    maxSpread: 0,
    aimZoom: 0.78,
    pellets: 1,
    pelletSpread: 0,
  },
  smg: {
    label: 'Maschinenpistole',
    damage: 8,
    fireInterval: 1 / 14,
    automatic: true,
    magazine: 25,
    reloadTime: 1.6,
    range: 60,
    moveSpeed: 1.05,
    spreadPerHeat: 0.009, // schneller viel Streuung als das Sturmgewehr
    maxSpread: 0.06,
    aimZoom: 0.85,
    pellets: 1,
    pelletSpread: 0,
  },
}

// Reihenfolge = Tasten 1, 2, ...
// Vorübergehend alle Waffen auf Tasten 1.. (bis die Auswahl vor dem Beitritt kommt)
export const WEAPON_SLOTS: WeaponId[] = ['pistol', 'rifle', 'knife', 'shotgun', 'sniper', 'heavyPistol', 'smg']
export const DEFAULT_WEAPON: WeaponId = 'pistol'
export const SWITCH_TIME = 0.3 // Sekunden

export function isMelee(id: WeaponId): boolean {
  return WEAPONS[id].magazine === 0
}

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === 'string' && Object.hasOwn(WEAPONS, value)
}

// Schadensfaktor nach Entfernung (Schrot verliert auf Distanz stark)
export function damageFactor(weapon: WeaponStats, distance: number): number {
  const falloff = weapon.falloff
  if (!falloff || distance <= falloff.start) return 1
  if (distance >= falloff.end) return falloff.min
  const t = (distance - falloff.start) / (falloff.end - falloff.start)
  return 1 - t * (1 - falloff.min)
}
