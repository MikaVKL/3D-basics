// "Kann Schaden nehmen" - die Waffe findet es über mesh.userData.damageable,
// egal ob Dummy oder fremder Spieler
export interface Damageable {
  readonly isAlive: boolean
  // z.B. Spawn-Schutz
  readonly invulnerable?: boolean
  // pellets: bei Schrot Körner dieses Schusses, die getroffen haben (headPellets am Kopf)
  takeDamage(amount: number, headshot: boolean, pellets?: { hit: number; head: number }): void
}
