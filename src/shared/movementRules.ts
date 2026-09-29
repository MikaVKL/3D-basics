// Plausibilitätsprüfung der Bewegung (Server): Teleport und Speedhack.
// Kein Three.js/DOM - der Server läuft direkt als TypeScript.

// Höchste legale Geschwindigkeiten (player.ts): Rutschen max. 13 m/s,
// Bunny-Hop 12 m/s, Sprung hoch 7,6 m/s, Fall aus 6 m ~14,7 m/s.
// Die Toleranz deckt Ping-Schwankungen und Rundung ab.
const TOLERANCE = 1.25
export const MAX_HORIZONTAL_SPEED = 13 * TOLERANCE
export const MAX_RISE_SPEED = 7.6 * TOLERANCE
export const MAX_FALL_SPEED = 30

// Wie viel Zeit (Sekunden) sich als Guthaben ansammeln darf: Pakete kommen
// gebündelt an (Ping, Hintergrund-Tab mit 1 Zustand/s), dürfen aber keine
// beliebig große Strecke erlauben
const MAX_BUDGET_SECONDS = 1.5

export interface MovementCheck {
  x: number
  y: number
  z: number
  life: number
  at: number // Serverzeit (ms) der letzten Prüfung
  budgetH: number // erlaubte Strecke waagerecht (m)
  budgetUp: number
  budgetDown: number
}

interface Position {
  x: number
  y: number
  z: number
}

// Neue Basis: Beitritt und Respawn (der Server setzt den Spieler selbst um)
export function createMovementCheck(position: Position, life: number, now: number): MovementCheck {
  return {
    ...position,
    life,
    at: now,
    budgetH: MAX_HORIZONTAL_SPEED * MAX_BUDGET_SECONDS,
    budgetUp: MAX_RISE_SPEED * MAX_BUDGET_SECONDS,
    budgetDown: MAX_FALL_SPEED * MAX_BUDGET_SECONDS,
  }
}

// true = plausibel (Basis rückt vor). false = zu weit in zu kurzer Zeit: die
// Basis bleibt an der letzten gültigen Stelle, das Guthaben füllt sich weiter.
export function checkMovement(check: MovementCheck, position: Position, now: number): boolean {
  const seconds = Math.max(0, (now - check.at) / 1000)
  check.at = now
  check.budgetH = Math.min(MAX_HORIZONTAL_SPEED * MAX_BUDGET_SECONDS, check.budgetH + MAX_HORIZONTAL_SPEED * seconds)
  check.budgetUp = Math.min(MAX_RISE_SPEED * MAX_BUDGET_SECONDS, check.budgetUp + MAX_RISE_SPEED * seconds)
  check.budgetDown = Math.min(MAX_FALL_SPEED * MAX_BUDGET_SECONDS, check.budgetDown + MAX_FALL_SPEED * seconds)

  const horizontal = Math.hypot(position.x - check.x, position.z - check.z)
  const vertical = position.y - check.y
  const needUp = Math.max(0, vertical)
  const needDown = Math.max(0, -vertical)
  if (horizontal > check.budgetH || needUp > check.budgetUp || needDown > check.budgetDown) return false

  check.budgetH -= horizontal
  check.budgetUp -= needUp
  check.budgetDown -= needDown
  check.x = position.x
  check.y = position.y
  check.z = position.z
  return true
}
