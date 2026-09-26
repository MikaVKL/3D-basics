// "Kann Schaden nehmen" - die Waffe findet es über mesh.userData.damageable,
// egal ob Dummy oder fremder Spieler
export interface Damageable {
  readonly isAlive: boolean
  // z.B. Spawn-Schutz
  readonly invulnerable?: boolean
  takeDamage(amount: number): void
}
