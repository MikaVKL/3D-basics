// Waffen-Balance: rechnet Schadensleistung und Zeit bis zum Tod (TTK) aus den Waffenwerten und prüft
// die gewollten Verhältnisse (jede Waffe hat einen Grund, gewählt zu werden). Reine Rechnung, kein Browser.
//
//   node tests/balance.mjs
import { WEAPONS, damageFactor, PRIMARY_WEAPONS, SECONDARY_WEAPONS } from '../src/shared/weapons.ts'
import { MAX_HEALTH, MAX_SHIELD, HEADSHOT_MULTIPLIER } from '../src/shared/gameRules.ts'
import { createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const HP = MAX_HEALTH + MAX_SHIELD

// Zeit bis zum Tod bei lauter Körpertreffern auf Entfernung d (ohne Nachladen, jeder Schuss trifft)
function ttk(id, distance, perShotMultiplier = 1) {
  const w = WEAPONS[id]
  const perShot = w.damage * w.pellets * damageFactor(w, distance) * perShotMultiplier
  const shots = Math.ceil(HP / perShot)
  return { shots, seconds: (shots - 1) * w.fireInterval, magazineOk: shots <= w.magazine }
}
const dps = (id, distance) => {
  const w = WEAPONS[id]
  return (w.damage * w.pellets * damageFactor(w, distance)) / w.fireInterval
}

console.log('Waffe          Schaden/Schuss  Schuss/s  DPS 5 m  DPS 20 m  TTK 5 m  TTK 20 m  Kopf-TTK 5 m')
for (const id of [...PRIMARY_WEAPONS, ...SECONDARY_WEAPONS]) {
  const w = WEAPONS[id]
  const t5 = ttk(id, 5)
  const t20 = ttk(id, 20)
  const h5 = ttk(id, 5, HEADSHOT_MULTIPLIER)
  console.log(
    `${id.padEnd(14)} ${String(w.damage * w.pellets).padStart(8)}        ${(1 / w.fireInterval).toFixed(1).padStart(6)}   ${dps(id, 5).toFixed(0).padStart(6)}   ${dps(id, 20).toFixed(0).padStart(7)}   ${t5.seconds.toFixed(2).padStart(6)}   ${t20.seconds.toFixed(2).padStart(7)}   ${h5.seconds.toFixed(2).padStart(8)}`
  )
}

const pistol = ttk('pistol', 5)
const smg = ttk('smg', 5)
const heavy = ttk('heavyPistol', 5)
check('Maschinenpistole nah nicht schneller als die Pistole (Pistole spricht durch Präzision)', smg.seconds >= pistol.seconds, `MP ${smg.seconds.toFixed(2)} s / Pistole ${pistol.seconds.toFixed(2)} s`)
check('MP-Dauerfeuer verliert auf 20 m deutlich (Falloff): DPS 20 m <= 70 % von 5 m', dps('smg', 20) <= dps('smg', 5) * 0.7, `${dps('smg', 20).toFixed(0)} / ${dps('smg', 5).toFixed(0)}`)
check('Auf 20 m schlägt die Pistole die MP deutlich (DPS)', dps('pistol', 20) > dps('smg', 20) * 1.4, `${dps('pistol', 20).toFixed(0)} vs ${dps('smg', 20).toFixed(0)}`)
check('Kopftreffer: Pistole tötet mit weniger Treffern als die MP', ttk('pistol', 5, 2).shots < ttk('smg', 5, 2).shots, `${ttk('pistol', 5, 2).shots} gegen ${ttk('smg', 5, 2).shots}`)
check('MP: Magazin reicht für einen Kill (25 Schuss), aber nicht für zwei auf 20 m', ttk('smg', 5).magazineOk && ttk('smg', 20).shots * 2 > WEAPONS.smg.magazine, `${ttk('smg', 5).shots} / ${ttk('smg', 20).shots} Schuss`)
check('MP-Streuung größer als die des Sturmgewehrs (Hitze und Maximum)', WEAPONS.smg.spreadPerHeat > WEAPONS.rifle.spreadPerHeat && WEAPONS.smg.maxSpread > WEAPONS.rifle.maxSpread)
check('Schwere Pistole: 3 Treffer töten (nur mit Präzision), Magazin klein', heavy.shots === 3 && WEAPONS.heavyPistol.magazine <= 7, `${heavy.shots} Treffer`)
check('Keine Secondary tötet nah schneller als das Sturmgewehr minus 25 %', [pistol, smg, heavy].every((t) => t.seconds >= ttk('rifle', 5).seconds * 0.75), `Gewehr ${ttk('rifle', 5).seconds.toFixed(2)} s`)
check('Shotgun nah (5 m) tötet mit 2 Schüssen, auf 20 m nicht', ttk('shotgun', 5).shots === 2 && ttk('shotgun', 20).shots > 6, `${ttk('shotgun', 5).shots} / ${ttk('shotgun', 20).shots}`)
check('Sniper: Körper 2 Treffer, Kopf 1 Treffer', ttk('sniper', 50).shots === 2 && ttk('sniper', 50, 2).shots === 1)
finish()
