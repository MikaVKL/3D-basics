// Zielen (rechte Maustaste halten): Zoom je Waffe, Empfindlichkeit folgt dem
// Zoom, halbe Streuung, langsamer, kein Sprint, Waffe in Bildmitte, Abbruch
// bei Wechsel/Nachladen/Messer/Tod, Einstellungs-Blickfeld bleibt Grundlage.
//
//   node tests/aim.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []

try {
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(500)

  // Simulierte Maus: Event-Handler von DesktopInput hängen am document
  const mouse = (type, button) =>
    page.evaluate(([t, b]) => document.dispatchEvent(new MouseEvent(t, { button: b, bubbles: true })), [type, button])
  const lockFake = () => page.evaluate(() => Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement }))
  await lockFake()
  const frames = (ms) => wait(ms)
  const read = () =>
    page.evaluate(() => ({
      fov: __dusk.camera.fov,
      amount: __dusk.weapon.aimAmount,
      aiming: __dusk.weapon.isAiming,
      gunX: __dusk.weapon.view.group.position.x,
      gunY: __dusk.weapon.view.group.position.y,
      spreadScale: 1,
    }))
  const yaw = () =>
    page.evaluate(() => {
      const look = __dusk.lookControl
      const before = look.euler.y
      look.rotate(100, 0)
      const delta = before - look.euler.y
      look.euler.y = before
      return delta
    })

  const base = await read()
  const yawBase = await yaw()
  check('ohne Zielen: Blickfeld 75°, Waffe rechts', Math.abs(base.fov - 75) < 0.01 && base.gunX > 0.2 && !base.aiming, JSON.stringify(base))

  // --- Pistole zielen ---
  await mouse('mousedown', 2)
  await frames(700)
  const pistol = await read()
  check('Pistole: Blickfeld 60° (75 x 0,8)', Math.abs(pistol.fov - 60) < 0.2 && pistol.amount > 0.99, `${pistol.fov.toFixed(1)}°, ${pistol.amount.toFixed(2)}`)
  check('Waffe wandert in die Bildmitte', Math.abs(pistol.gunX) < 0.01 && pistol.gunY > base.gunY, `x ${pistol.gunX.toFixed(3)}, y ${base.gunY.toFixed(2)} -> ${pistol.gunY.toFixed(2)}`)
  const yawAim = await yaw()
  const expectedScale = Math.tan((60 * Math.PI) / 360) / Math.tan((75 * Math.PI) / 360)
  check('Empfindlichkeit folgt dem Zoom (gleiches Gefühl am Bildschirm)', Math.abs(yawAim / yawBase - expectedScale) < 0.02, `${(yawAim / yawBase).toFixed(3)} statt ${expectedScale.toFixed(3)}`)

  // --- Tempo / Sprint ---
  const speeds = await page.evaluate(() => {
    const P = __dusk.player
    const cam = __dusk.camera
    const DT = 1 / 60
    const run = (sprint) => {
      P.spawn({ x: -8, y: 1.7, z: 8, clone() { return this } })
      cam.rotation.set(0, Math.PI, 0, 'YXZ')
      P.setMoveInput(0, 1)
      P.setSprinting(sprint)
      for (let i = 0; i < 40; i++) P.update(DT)
      const v = P.horizontalSpeed
      P.setMoveInput(0, 0)
      P.setSprinting(false)
      return v
    }
    P.setAiming(true)
    const walk = run(false)
    const sprint = run(true)
    P.setAiming(false)
    const free = run(false)
    return { walk, sprint, free }
  })
  check('beim Zielen 75 % Gehtempo (4,5 m/s)', Math.abs(speeds.walk - 4.5) < 0.05, `${speeds.walk.toFixed(2)} (frei ${speeds.free.toFixed(2)})`)
  check('beim Zielen kein Sprint', Math.abs(speeds.sprint - 4.5) < 0.05, `${speeds.sprint.toFixed(2)} m/s`)

  // --- loslassen ---
  await mouse('mouseup', 2)
  await frames(700)
  const released = await read()
  check('Loslassen: Blickfeld und Waffe zurück', Math.abs(released.fov - 75) < 0.2 && released.gunX > 0.2, JSON.stringify(released))

  // --- Sturmgewehr: stärkerer Zoom, halbe Streuung ---
  await page.evaluate(() => { __dusk.weapon.switchTo('rifle'); __dusk.weapon.switchRemaining = 0 })
  await wait(300)
  await mouse('mousedown', 2)
  await frames(700)
  const rifle = await read()
  check('Sturmgewehr: Blickfeld 48,75° (75 x 0,65)', Math.abs(rifle.fov - 48.75) < 0.3, `${rifle.fov.toFixed(2)}°`)
  const spread = await page.evaluate(() => {
    const w = __dusk.weapon
    w.heat = 12
    const aimed = w.currentSpread
    w.aimAmount = 0
    const hip = w.currentSpread
    w.aimAmount = 1
    return { aimed, hip }
  })
  check('Streuung beim Zielen halbiert', Math.abs(spread.aimed / spread.hip - 0.5) < 0.01 && spread.hip > 0, `${spread.hip.toFixed(4)} -> ${spread.aimed.toFixed(4)} rad`)

  // --- Abbruch durch Nachladen / Wechsel, danach wieder ---
  await page.evaluate(() => { __dusk.weapon.ammo = 10; __dusk.weapon.reload() })
  await wait(400)
  const reloading = await read()
  check('Nachladen unterbricht das Zielen (Blickfeld wieder 75°)', !reloading.aiming && reloading.fov > 70, `${reloading.fov.toFixed(1)}°`)
  await page.evaluate(() => { __dusk.weapon.reloadRemaining = 0 })
  await wait(700)
  check('danach zielt die gehaltene Taste weiter', (await read()).aiming)
  await page.evaluate(() => __dusk.weapon.switchTo('knife'))
  await wait(900)
  const knife = await read()
  check('Messer: kein Zielen, kein Zoom', !knife.aiming && Math.abs(knife.fov - 75) < 0.2, `${knife.fov.toFixed(1)}°`)
  await page.evaluate(() => __dusk.weapon.switchTo('pistol'))
  await wait(900)
  check('zurück zur Pistole: gehaltene Taste zielt wieder', (await read()).aiming)

  // --- Tod/Menü beendet das Zielen ---
  await page.evaluate(() => __dusk.weapon.cancelFire())
  await wait(600)
  check('Tod/Menü (cancelFire): Zielen aus', !(await read()).aiming)
  await mouse('mouseup', 2)

  // --- tote Spieler zielen nicht ---
  await page.evaluate(() => __dusk.player.applyServerVitals(0, 0, false))
  await wait(300)
  await mouse('mousedown', 2)
  await wait(300)
  check('als Toter lässt sich nicht zielen', !(await read()).aiming)
  await mouse('mouseup', 2)
  await page.evaluate(() => __dusk.player.applyServerVitals(100, 25, false))
  await wait(4000) // Respawn-Wartezeit des Singleplayers

  // --- Einstellungs-Blickfeld bleibt die Grundlage ---
  await page.evaluate(() => { __dusk.player.spawn({ x: 0, y: 1.7, z: 8, clone() { return this } }) })
  await page.evaluate(() => { document.querySelector('#setting-fov').value = '100'; document.querySelector('#setting-fov').dispatchEvent(new Event('input', { bubbles: true })) })
  await wait(300)
  await mouse('mousedown', 2)
  await wait(700)
  const wide = await read()
  check('Blickfeld 100° in den Einstellungen: Pistole zielt auf 80°', Math.abs(wide.fov - 80) < 0.3, `${wide.fov.toFixed(1)}°`)
  await mouse('mouseup', 2)
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
