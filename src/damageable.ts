// Gemeinsame Schnittstelle für "kann Schaden nehmen" - aktuell von Target
// und Player implementiert. Der Sinn: weapon.ts muss beim Raycast-Treffer
// nicht wissen, OB es ein Ziel-Dummy oder (später) ein anderer Spieler war -
// beide werden über mesh.userData.damageable gefunden und gleich behandelt.
// Das ist genau die Stelle, an der später Multiplayer-Gegner andocken:
// ein Server müsste nur noch echte Spieler-Avatare mit demselben Muster
// ("Mesh trägt userData.damageable") in die Szene stellen.
export interface Damageable {
  readonly isAlive: boolean
  takeDamage(amount: number): void
}
