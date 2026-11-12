// Shotgun: 8 Körner je Schuss (Strahlen, Schaden je Gegner zusammengefasst), Schaden
// fällt mit der Entfernung, Server rechnet Körner/Entfernung nach und begrenzt gefälschte Meldungen.
//
//   node tests/shotgun.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, shootAt, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  // --- Einzelspieler: Dummy bei (-14, 0.8, -6) ---
  const page = await openGame(browser, { online: false, errors })
  await play(page, { primary: 'shotgun' })
  await wait(500)

  const factors = await page.evaluate(async () => {
    const { WEAPONS, damageFactor } = await import('/3D-basics/src/shared/weapons.ts')
    const s = WEAPONS.shotgun
    return [3, 5, 10.5, 16, 40].map((d) => Number(damageFactor(s, d).toFixed(3)))
  })
  check('Schadensfaktor: voll bis 7 m, 10,5 m 0,785, ab 20 m 0,2', factors.join() === '1,1,0.785,0.446,0.2', factors.join())

  await page.keyboard.press('Digit2')
  await wait(500)
  const hud = await page.evaluate(() => ({
    weapon: __dusk.weapon.current,
    slot: document.querySelector('.weapon-slot.active')?.dataset.weapon,
    ammo: __dusk.weapon.getAmmoState().max,
  }))
  check('Auswahl: Shotgun auf Taste 2, 6er-Magazin, Slot aktiv', hud.weapon === 'shotgun' && hud.slot === 'shotgun' && hud.ammo === 6, JSON.stringify(hud))

  await page.evaluate(() => {
    window.__dmg = []
    __dusk.weapon.onEnemyHit = (kill, point, damage) => window.__dmg.push(damage)
    window.__sounds = []
    const play = __dusk.sound.play.bind(__dusk.sound)
    __dusk.sound.play = (name, volume) => {
      window.__sounds.push(name)
      play(name, volume)
    }
  })
  const dummyReset = () =>
    page.evaluate(() => {
      const t = (window.__dummy ??= __dusk.arena.shootables.find((m) => m.userData.damageable && m.position.x === -14 && m.position.z === -6))
      const d = t.userData.damageable
      d.vitals = { health: 100, shield: 25, shieldRegenCooldown: 0 }
      d.respawnRemaining = 0
      t.visible = true
    })

  // Nah: alle 8 Körner treffen, 8 Strahlen, 80 Schaden in EINER Meldung
  await dummyReset()
  await teleport(page, -14, 1.7, -4.5)
  await wait(200)
  await shootAt(page, [-14, 1.1, -6])
  const near = await page.evaluate(() => ({ tracers: __dusk.weapon.tracers.length, dmg: window.__dmg.slice(), sounds: window.__sounds.slice(), ammo: __dusk.weapon.ammo }))
  check('Schuss: 8 Strahlen', near.tracers === 8, String(near.tracers))
  check('Nah (1,5 m): ein Treffer mit 80 Schaden', near.dmg.length === 1 && Math.abs(near.dmg[0] - 80) < 0.01, JSON.stringify(near.dmg))
  check('Knall-Ton', near.sounds.includes('shotgunShot'), near.sounds.join())

  await wait(700)
  check('Pumpgriff-Ton nach dem Schuss', (await page.evaluate(() => window.__sounds)).includes('shotgunPump'))

  // Fern (~12 m): Streuung + Abfall - deutlich weniger Schaden im Mittel
  await page.evaluate(() => (window.__dmg.length = 0))
  // Freie Bahn (x = -14): Dummy dorthin, 12 m Abstand
  await page.evaluate(() => window.__dummy.position.set(-14, 0.8, -6))
  let total = 0
  const runs = 20
  for (let i = 0; i < runs; i++) {
    await dummyReset()
    await teleport(page, -14, 1.7, 6)
    await page.evaluate(() => (window.__dmg.length = 0))
    await shootAt(page, [-14, 0.9, -6])
    total += await page.evaluate(() => window.__dmg.reduce((a, b) => a + b, 0))
  }
  const average = total / runs
  check('Fern (12 m): im Mittel deutlich unter 80 und über 0', average > 1 && average < 45, `Ø ${average.toFixed(1)}`)

  // --- Mehrspieler: Server rechnet nach ---
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A, { primary: 'shotgun' })
  await play(B)
  await wait(3800)
  const vitals = () => B.evaluate(() => ({ ...__dusk.player.vitals }))
  await B.evaluate(() => {
    window.__sounds = []
    const playAt = __dusk.sound.playAt.bind(__dusk.sound)
    __dusk.sound.playAt = (name, position, volume) => {
      window.__sounds.push(name)
      playAt(name, position, volume)
    }
  })
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 8)
  await A.keyboard.press('Digit2')
  await wait(800)
  const held = await B.evaluate((id) => __dusk.remotePlayers.players.get(id).avatar.heldWeapon, await A.evaluate(() => __dusk.network.localId))
  check('B sieht A mit Shotgun', held === 'shotgun', held)
  await shootAt(A, [0, 1.0, 5])
  await wait(700)
  const near2 = await vitals()
  // 8 Körner x 10 = 80: Schild 25 weg, 55 aufs Leben
  check('Server: 3 m, 8 Körner = 80 Schaden (Schild 0, Leben 45)', near2.shield === 0 && near2.health === 45, JSON.stringify(near2))
  check('B hört den Knall', (await B.evaluate(() => window.__sounds)).includes('shotgunShot'))

  // Frische Runde für B: zweiter Nahschuss tötet (45 Leben < 80), Respawn abwarten (Spawn-Schutz 2 s)
  await shootAt(A, [0, 1.0, 5])
  await wait(700)
  check('Zweiter Schuss (80) tötet B', !(await B.evaluate(() => __dusk.player.isAlive)))
  await wait(6500)
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 18)
  await wait(1200)

  // Gefälschte Meldung: 99 Körner aus ~13 m - Server begrenzt auf 8 und mindert nach Entfernung
  await A.evaluate(() => {
    const id = [...__dusk.network.remotePlayers][0]
    __dusk.network.sendHit(id, false, { hit: 99, head: 0 })
  })
  await wait(500)
  const far = await vitals()
  // 80 x Faktor(12,5 m = 0,66) ~ 53: Schild 25 weg, Leben ~ 72 (ungebremst wäre B tot)
  check('Server: 99 gemeldete Körner begrenzt, Entfernung mindert (13 m)', far.health > 65 && far.health < 80 && (await B.evaluate(() => __dusk.player.isAlive)), JSON.stringify(far))

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
