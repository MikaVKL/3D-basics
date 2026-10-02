// Maschinenpistole: Taste 7, 25er-Magazin, 14 Schuss/s im Dauerfeuer, 8 Schaden, Streuung wächst
// schneller als beim Sturmgewehr, schnell beim Laufen, Töne, Server-Schaden und Ratenlimit.
//
//   node tests/smg.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page, { secondary: 'smg' })
  await wait(500)
  await page.evaluate(() => {
    window.__sounds = []
    const play = __dusk.sound.play.bind(__dusk.sound)
    __dusk.sound.play = (name, volume) => {
      window.__sounds.push(name)
      play(name, volume)
    }
  })
  await page.keyboard.press('Digit1')
  await wait(600)
  const hud = await page.evaluate(() => ({
    weapon: __dusk.weapon.current,
    slot: document.querySelector('.weapon-slot.active')?.dataset.weapon,
    max: __dusk.weapon.getAmmoState().max,
    name: document.querySelector('#weapon-name')?.textContent,
  }))
  check('Auswahl: Maschinenpistole auf Taste 1, 25er-Magazin, Slot aktiv', hud.weapon === 'smg' && hud.slot === 'smg' && hud.max === 25, JSON.stringify(hud))

  // Feuerrate: Dauerfeuer über simulierte Zeit (Headless rendert zu langsam für echte Bilder)
  const burst = await page.evaluate(() => {
    const W = __dusk.weapon
    W.setTrigger(true)
    let shots = 0
    const before = W.ammo
    for (let i = 0; i < 60; i++) W.update(1 / 60) // 1 s
    W.setTrigger(false)
    shots = before - W.ammo
    return { shots, spread: W.currentSpread }
  })
  check('Dauerfeuer: ~14 Schuss in 1 s', burst.shots >= 13 && burst.shots <= 15, String(burst.shots))
  const rifleMax = await page.evaluate(async () => (await import('/3D-basics/src/shared/weapons.ts')).WEAPONS.rifle.maxSpread)
  check('Streuung nach 1 s Dauerfeuer: MP über dem Maximum des Sturmgewehrs (0,035), höchstens 0,06', burst.spread > rifleMax && burst.spread <= 0.0601, `MP ${burst.spread.toFixed(3)}`)

  const speeds = await page.evaluate(() => {
    const P = __dusk.player
    const run = (id) => {
      P.spawn({ x: 0, y: 1.7, z: 12, clone() { return this } })
      __dusk.camera.lookAt(0, 1.7, 0)
      P.weapon = id
      P.setMoveInput(0, 1)
      for (let i = 0; i < 30; i++) P.update(1 / 60)
      P.setMoveInput(0, 0)
      return 12 - __dusk.camera.position.z
    }
    const pistol = run('pistol')
    const smg = run('smg')
    P.weapon = __dusk.weapon.current
    return smg / pistol
  })
  check('läuft 105 % so schnell wie mit der Pistole', Math.abs(speeds - 1.05) < 0.01, speeds.toFixed(3))
  check('Schusston', (await page.evaluate(() => window.__sounds)).includes('smgShot'))

  await page.evaluate(() => {
    window.__sounds.length = 0
    __dusk.weapon.switchTo('smg')
    __dusk.weapon.switchRemaining = 0
    __dusk.weapon.ammo = 3
    __dusk.weapon.reload()
  })
  await wait(1900)
  const reload = await page.evaluate(() => ({ sounds: window.__sounds.filter((s) => s.startsWith('smgReload')), ammo: __dusk.weapon.ammo }))
  check('Nachladen (1,6 s): Töne raus/rein, 25 Schuss', reload.sounds.join() === 'smgReloadOut,smgReloadIn' && reload.ammo === 25, JSON.stringify(reload))

  // Mehrspieler: Server rechnet 8 je Treffer, Ratenlimit greift
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A, { secondary: 'smg' })
  await play(B)
  await wait(3800)
  const vitals = () => B.evaluate(() => ({ ...__dusk.player.vitals }))
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 12)
  await A.keyboard.press('Digit1')
  await wait(800)
  const held = await B.evaluate((id) => __dusk.remotePlayers.players.get(id).avatar.heldWeapon, await A.evaluate(() => __dusk.network.localId))
  check('B sieht A mit der Maschinenpistole', held === 'smg', held)
  await A.evaluate(() => {
    const id = [...__dusk.network.remotePlayers][0]
    __dusk.network.sendHit(id, false)
  })
  await wait(400)
  check('Server: ein Treffer = 8 (Schild 17)', (await vitals()).shield === 17, JSON.stringify(await vitals()))
  // Manipuliert: 40 Meldungen auf einmal - höchstens Burst (3 Token) plus kleiner Nachschub zählt
  await A.evaluate(() => {
    const id = [...__dusk.network.remotePlayers][0]
    for (let i = 0; i < 40; i++) __dusk.network.sendHit(id, false)
  })
  await wait(500)
  const spam = await vitals()
  const dealt = 125 - (spam.shield + spam.health)
  check('Server begrenzt Trefferflut (höchstens ~6 von 41 Treffern)', dealt >= 8 * 2 && dealt <= 8 * 7, `${dealt / 8} Treffer`)

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
