// Schwere Pistole: Taste 6, 7er-Magazin, 45 Schaden (Kopf 90), langsamere Feuerrate als die
// Pistole, eigene Töne, Server rechnet nach der gehaltenen Waffe.
//
//   node tests/heavy-pistol.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, shootAt, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page, { secondary: 'heavyPistol' })
  await wait(500)
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
  await page.keyboard.press('Digit1')
  await wait(600)
  const hud = await page.evaluate(() => ({
    weapon: __dusk.weapon.current,
    slot: document.querySelector('.weapon-slot.active')?.dataset.weapon,
    max: __dusk.weapon.getAmmoState().max,
    name: document.querySelector('#weapon-name')?.textContent,
  }))
  check('Auswahl: Schwere Pistole auf Taste 1, 7er-Magazin, Slot aktiv', hud.weapon === 'heavyPistol' && hud.slot === 'heavyPistol' && hud.max === 7, JSON.stringify(hud))

  await teleport(page, 3, 1.7, -3)
  await wait(200)
  await shootAt(page, [3, 1.0, -6])
  const shot = await page.evaluate(() => ({ dmg: window.__dmg.slice(), sounds: window.__sounds.slice() }))
  check('Treffer: 45 Schaden, eigener Knall', shot.dmg.join() === '45' && shot.sounds.includes('heavyShot'), JSON.stringify(shot))

  const interval = await page.evaluate(async () => {
    const { WEAPONS } = await import('/3D-basics/src/shared/weapons.ts')
    return [WEAPONS.heavyPistol.fireInterval, WEAPONS.pistol.fireInterval]
  })
  check('Feuerpause 0,5 s (Pistole 0,2 s): zweiter Schuss sofort kommt nicht', interval[0] === 0.5 && interval[1] === 0.2)
  const second = await page.evaluate(() => {
    __dusk.weapon.ammo = 7
    return __dusk.weapon.tryShoot()
  })
  check('zweiter Schuss unmittelbar danach wird gesperrt', second === false)

  await page.evaluate(() => {
    window.__sounds.length = 0
    __dusk.weapon.ammo = 3
    __dusk.weapon.reload()
  })
  await wait(2100)
  const reload = await page.evaluate(() => ({ sounds: window.__sounds.slice(), ammo: __dusk.weapon.ammo }))
  check('Nachladen (1,8 s): Magazin raus/rein-Töne, 7 Schuss', reload.sounds.join() === 'heavyReloadOut,heavyReloadIn' && reload.ammo === 7, JSON.stringify(reload))

  // Mehrspieler: Server rechnet 45 / 90
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A, { secondary: 'heavyPistol' })
  await play(B)
  await wait(3800)
  const vitals = () => B.evaluate(() => ({ ...__dusk.player.vitals, alive: __dusk.player.isAlive }))
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 12)
  await A.keyboard.press('Digit1')
  await wait(800)
  const held = await B.evaluate((id) => __dusk.remotePlayers.players.get(id).avatar.heldWeapon, await A.evaluate(() => __dusk.network.localId))
  check('B sieht A mit der schweren Pistole', held === 'heavyPistol', held)
  const hit = (headshot) =>
    A.evaluate((h) => {
      const id = [...__dusk.network.remotePlayers][0]
      __dusk.network.sendHit(id, h)
    }, headshot)
  await hit(false)
  await wait(400)
  const body = await vitals()
  // 125 - 45: Schild 0, Leben 80
  check('Server: Körpertreffer = 45 (Schild 0, Leben 80)', body.shield === 0 && body.health === 80, JSON.stringify(body))
  await wait(700)
  await hit(true)
  await wait(400)
  check('Server: Kopftreffer = 90 tötet (80 Leben)', !(await vitals()).alive)

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
