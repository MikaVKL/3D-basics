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
  // Zielen: Tempo des Ein-/Ausblendens (1/s; 9 = ~0,11 s, kleiner = träger)
  aimSpeed: number
  // Waffe ziehen (Wechsel): Dauer des Hochkommens in s, nach dem Absenken der alten Waffe (LOWER_TIME)
  drawTime: number
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
    aimSpeed: 9,
    drawTime: 0.15,
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
    aimSpeed: 8,
    drawTime: 0.2,
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
    aimSpeed: 9,
    drawTime: 0.2,
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
    aimSpeed: 8,
    drawTime: 0.3,
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
    aimSpeed: 3,
    drawTime: 0.4,
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
    aimSpeed: 7,
    drawTime: 0.25,
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
    aimSpeed: 10,
    drawTime: 0.15,
    pellets: 1,
    pelletSpread: 0,
  },
}

// Reihenfolge = Tasten 1, 2, ...
// Auswahl vor dem Beitritt: eine Primary- und eine Secondary-Waffe, das Messer ist immer dabei.
// Tasten wie bisher: 1 = Secondary (Pistole), 2 = Primary (Sturmgewehr), 3 = Messer.
export interface Loadout {
  primary: WeaponId
  secondary: WeaponId
}
export const PRIMARY_WEAPONS: WeaponId[] = ['rifle', 'shotgun', 'sniper']
export const SECONDARY_WEAPONS: WeaponId[] = ['pistol', 'heavyPistol', 'smg']
export const DEFAULT_LOADOUT: Loadout = { primary: 'rifle', secondary: 'pistol' }
// Waffe nach dem Spawn: die Secondary (bisher immer die Pistole)
export const DEFAULT_WEAPON: WeaponId = DEFAULT_LOADOUT.secondary

export function isLoadout(value: unknown): value is Loadout {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return PRIMARY_WEAPONS.includes(v.primary as WeaponId) && SECONDARY_WEAPONS.includes(v.secondary as WeaponId)
}

export function loadoutSlots(loadout: Loadout): WeaponId[] {
  return [loadout.secondary, loadout.primary, 'knife']
}

export const ALL_WEAPONS = Object.keys(WEAPONS) as WeaponId[]
export const LOWER_TIME = 0.15 // Sekunden: alte Waffe sinkt
// Gesamtdauer eines Wechsels auf diese Waffe
export function switchTime(id: WeaponId): number {
  return LOWER_TIME + WEAPONS[id].drawTime
}

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
