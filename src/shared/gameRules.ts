// Spielregeln für Client und Server

export const MAX_HEALTH = 100
export const MAX_SHIELD = 25
export const SHIELD_REGEN_DELAY = 3 // Sekunden ohne Treffer
export const SHIELD_REGEN_RATE = 10 // pro Sekunde
export const RESPAWN_DELAY = 3 // Sekunden
// Sekunden unverwundbar nach dem Spawn (endet, sobald man schießt)
export const SPAWN_PROTECTION = 2

export const KILLS_TO_WIN = 20
export const ROUND_END_PAUSE = 6 // Sekunden

export const HIT_DAMAGE = 15
export const FIRE_COOLDOWN = 0.15 // Sekunden

export interface Vitals {
  health: number
  shield: number
  shieldRegenCooldown: number
}

// Schild zuerst, Rest aufs Leben. true = tödlich.
export function applyDamage(vitals: Vitals, amount: number): boolean {
  if (vitals.health <= 0) return false

  vitals.shieldRegenCooldown = SHIELD_REGEN_DELAY

  let remaining = amount
  if (vitals.shield > 0) {
    const absorbed = Math.min(vitals.shield, remaining)
    vitals.shield -= absorbed
    remaining -= absorbed
  }
  if (remaining <= 0) return false

  vitals.health = Math.max(0, vitals.health - remaining)
  return vitals.health === 0
}

export function regenerateShield(vitals: Vitals, deltaSeconds: number) {
  if (vitals.shieldRegenCooldown > 0) {
    vitals.shieldRegenCooldown = Math.max(0, vitals.shieldRegenCooldown - deltaSeconds)
  } else if (vitals.shield < MAX_SHIELD) {
    vitals.shield = Math.min(MAX_SHIELD, vitals.shield + SHIELD_REGEN_RATE * deltaSeconds)
  }
}
