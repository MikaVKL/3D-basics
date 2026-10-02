// Sniper: Zielfernrohr (Zoom, Linsenbild statt Waffe, Fadenkreuz weg), Hüftfeuer streut stark,
// gezielt exakt, 70 Körper / 140 Kopf (Ein-Schuss-Kill), Töne, Server-Schaden auf große Entfernung.
//
//   node tests/sniper.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, shootAt, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page, { primary: 'sniper' })
  await wait(500)
  const mouse = (type, button) =>
    page.evaluate(([t, b]) => document.dispatchEvent(new MouseEvent(t, { button: b, bubbles: true })), [type, button])
  await page.evaluate(() => Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement }))

  await page.keyboard.press('Digit2')
  await wait(600)
  const read = () =>
    page.evaluate(() => ({
      weapon: __dusk.weapon.current,
      slot: document.querySelector('.weapon-slot.active')?.dataset.weapon,
      max: __dusk.weapon.getAmmoState().max,
      fov: __dusk.camera.fov,
      spread: __dusk.weapon.currentSpread,
      scopeOpacity: Number(document.querySelector('#scope').style.opacity || 0),
      gunVisible: __dusk.weapon.view.group.visible,
      crosshair: getComputedStyle(document.querySelector('#crosshair')).visibility,
    }))
  const hip = await read()
  check('Auswahl: Sniper auf Taste 2, 5er-Magazin, Slot aktiv', hip.weapon === 'sniper' && hip.slot === 'sniper' && hip.max === 5, JSON.stringify(hip))
  check('Hüftfeuer: große Streuung, kein Linsenbild, Waffe sichtbar, Fadenkreuz da', Math.abs(hip.spread - 0.05) < 0.002 && hip.scopeOpacity === 0 && hip.gunVisible && hip.crosshair === 'visible', JSON.stringify(hip))

  await mouse('mousedown', 2)
  await wait(900)
  const scoped = await read()
  check('Zielen: Blickfeld 18,75° (75 x 0,25)', Math.abs(scoped.fov - 18.75) < 0.3, scoped.fov.toFixed(2))
  check('Zielen: Streuung ~0, Linsenbild voll, Waffe und Fadenkreuz weg', scoped.spread < 0.001 && scoped.scopeOpacity > 0.98 && !scoped.gunVisible && scoped.crosshair === 'hidden', JSON.stringify(scoped))
  await mouse('mouseup', 2)
  await wait(600)
  const released = await read()
  check('Loslassen: Linsenbild weg, Waffe wieder da, Blickfeld 75°', released.scopeOpacity === 0 && released.gunVisible && Math.abs(released.fov - 75) < 0.3, JSON.stringify(released))

  // Zielen ist träge: bis zum vollen Linsenbild dauert es > 0,25 s (Pistole ~0,11 s)
  const times = await page.evaluate(() => {
    const W = __dusk.weapon
    const measure = (id) => {
      W.switchTo(id)
      W.switchRemaining = 0
      W.setAiming(false)
      for (let i = 0; i < 60; i++) W.update(1 / 60)
      W.setAiming(true)
      let frames = 0
      while (W.aimAmount < 0.99 && frames < 120) {
        W.update(1 / 60)
        frames++
      }
      const t = frames / 60
      W.setAiming(false)
      for (let i = 0; i < 60; i++) W.update(1 / 60)
      return t
    }
    const result = { sniper: measure('sniper'), pistol: measure('pistol') }
    W.switchTo('sniper')
    W.switchRemaining = 0
    return result
  })
  check('Sniper zielt träge (0,3-0,5 s), Pistole schnell (< 0,15 s)', times.sniper >= 0.3 && times.sniper <= 0.5 && times.pistol < 0.15, JSON.stringify(times))

  // Treffer auf den Dummy (3, 0.8, -6) aus 5 m: 70
  await page.evaluate(() => {
    window.__dmg = []
    __dusk.weapon.onEnemyHit = (kill, point, damage) => window.__dmg.push(damage)
    window.__sounds = []
    const play = __dusk.sound.play.bind(__dusk.sound)
    __dusk.sound.play = (name, volume) => {
      window.__sounds.push(name)
      play(name, volume)
    }
    __dusk.weapon.setAiming(true)
  })
  await wait(700)
  await teleport(page, 3, 1.7, -3)
  await wait(200)
  await shootAt(page, [3, 1.0, -6])
  const hit = await page.evaluate(() => ({ dmg: window.__dmg.slice(), sounds: window.__sounds.slice() }))
  check('Treffer aus 3 m: 70 Schaden, Knall-Ton', hit.dmg.join() === '70' && hit.sounds.includes('shotgunShot') === false && hit.sounds.includes('sniperShot'), JSON.stringify(hit))
  await wait(900)
  check('Repetiergriff-Ton nach dem Schuss', (await page.evaluate(() => window.__sounds)).includes('sniperBolt'))

  // Mehrspieler: Server rechnet 70 / 140 auch auf große Entfernung
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A, { primary: 'sniper' })
  await play(B)
  await wait(3800)
  const vitals = () => B.evaluate(() => ({ ...__dusk.player.vitals, alive: __dusk.player.isAlive }))
  await teleport(B, -30, 1.7, 0)
  await teleport(A, 30, 1.7, 0)
  await A.keyboard.press('Digit2')
  await wait(800)
  await A.evaluate(() => {
    const id = [...__dusk.network.remotePlayers][0]
    __dusk.network.sendHit(id, false)
  })
  await wait(500)
  const body = await vitals()
  // 60 m: 125 - 70 = Schild 0, Leben 55
  check('Server: Körpertreffer aus 60 m = 70 (Schild 0, Leben 55)', body.shield === 0 && body.health === 55 && body.alive, JSON.stringify(body))
  await wait(1400)
  await A.evaluate(() => {
    const id = [...__dusk.network.remotePlayers][0]
    __dusk.network.sendHit(id, true)
  })
  await wait(500)
  check('Server: Kopftreffer = 140, ein Schuss tötet', !(await vitals()).alive)

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
