// Schadenszahlen auf Distanz (offline, Dummy bei (-14, 0.8, -6), Bahn x = -14): die Zahl zeigt, was der Server
// abzieht - mit Schadensabfall (MP, Shotgun) und als ganze Zahl; nah bleibt der volle Wert.
//
//   node tests/damage-numbers.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page, { primary: 'shotgun', secondary: 'smg' })
  await wait(600)
  // Schuss auf den Dummy aus z = 8 (14 m) bzw. z = -3 (3 m); liefert die neuen Schadenszahlen als Text
  const shoot = (weapon, z) =>
    page.evaluate(
      ([weapon, z]) => {
        const d = __dusk
        d.player.spawn({ x: -14, y: 1.7, z, clone() { return this } })
        document.querySelectorAll('.damage-number').forEach((e) => e.remove())
        d.weapon.weaponId = weapon
        d.weapon.switchRemaining = 0
        d.weapon.reloadRemaining = 0
        d.weapon.cooldownRemaining = 0
        d.weapon.heat = 0
        d.weapon.aimAmount = 1 // kein Zufall durch Hüftstreuung, enger Schrotkegel
        d.weapon.ammo = 5
        d.camera.lookAt(-14, 0.9, -6)
        d.lookControl.euler.setFromQuaternion(d.camera.quaternion)
        d.weapon.tryShoot()
        return [...document.querySelectorAll('.damage-number')].map((e) => e.textContent)
      },
      [weapon, z]
    )
  const stats = await page.evaluate(async () => {
    const w = await import('/3D-basics/src/shared/weapons.ts')
    return { smg: w.WEAPONS.smg.damage * w.damageFactor(w.WEAPONS.smg, 13.7) }
  })

  const smgNear = await shoot('smg', -3)
  check('MP nah (3 m): voller Schaden 7', smgNear.join() === '7', smgNear.join())
  await wait(3000) // Dummy erholt sich / respawnt
  const smgFar = await shoot('smg', 8)
  check(`MP auf 14 m: Zahl mit Schadensabfall (${Math.round(stats.smg)}, nicht 7)`, smgFar.join() === String(Math.round(stats.smg)), smgFar.join())
  await wait(3000)
  const shotgunFar = await shoot('shotgun', 8)
  check('Shotgun auf 14 m: eine ganze Zahl', shotgunFar.length === 1 && /^\d+$/.test(shotgunFar[0]) && Number(shotgunFar[0]) >= 1, shotgunFar.join())
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
