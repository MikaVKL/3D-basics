// Spielregeln, die Client (Spieler, Ziel-Dummies) und Server identisch
// anwenden müssen. Im Multiplayer entscheidet der Server über Schaden und
// Tod - der Client nutzt dieselben Werte nur noch für HUD und Singleplayer.

export const MAX_HEALTH = 100
export const MAX_SHIELD = 25
export const SHIELD_REGEN_DELAY = 3 // Sekunden ohne Treffer, bevor das Schild wieder auflädt
export const SHIELD_REGEN_RATE = 10 // pro Sekunde (volles Schild in 2.5s nach der Regen-Verzögerung)
export const RESPAWN_DELAY = 3 // Sekunden bis ein Spieler nach dem Tod wieder auftaucht
// Unverwundbar direkt nach dem (Re-)Spawn, damit niemand am Spawn-Punkt
// abgefangen wird - endet vorzeitig, sobald man selbst schießt
export const SPAWN_PROTECTION = 2

export const HIT_DAMAGE = 15 // fester Schaden pro Treffer (25 Schild absorbiert zuerst)
export const FIRE_COOLDOWN = 0.15 // Sekunden zwischen zwei Schüssen (verhindert Spam)

export interface Vitals {
  health: number
  shield: number
  shieldRegenCooldown: number
}

// Schild absorbiert Schaden zuerst, komplett bis es leer ist, erst der
// Rest geht auf die Lebenspunkte (klassisches Shield-vor-Health-Modell).
// Jeder Treffer setzt außerdem die Regenerations-Verzögerung zurück.
// Gibt true zurück, wenn dieser Treffer tödlich war.
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
