// Touch-Steuerung (iPad/Handy): Ducken-Button wird gehalten - Ducken und
// Rutschen nur, solange der Finger drauf ist, danach steht man selbst auf.
//
//   node tests/touch.mjs
import { startServers, launchBrowser, wait, createChecks, GAME_URL } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${GAME_URL}?server=${encodeURIComponent('ws://localhost:1')}`)
  await page.waitForFunction(() => typeof window.__dusk !== 'undefined')
  check('Touch-Steuerung aktiv', await page.evaluate(() => !document.querySelector('#touch-controls').classList.contains('hidden')))
  await page.tap('#overlay', { position: { x: 5, y: 5 } })
  await wait(300)

  // Finger auf dem Button halten / loslassen (echte Touch-Ereignisse per CDP)
  const cdp = await context.newCDPSession(page)
  const box = await page.locator('#crouch-button').boundingBox()
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }
  const press = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  const release = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const state = () =>
    page.evaluate(() => ({
      eye: __dusk.camera.position.y - __dusk.player.bodyY,
      sliding: __dusk.player.isSliding,
      active: document.querySelector('#crouch-button').classList.contains('active'),
    }))

  await press()
  await wait(600)
  const held = await state()
  check('Halten: geduckt, Button leuchtet', Math.abs(held.eye - 1.0) < 0.01 && held.active, JSON.stringify(held))
  await release()
  await wait(600)
  const released = await state()
  check('Loslassen: steht von selbst auf', Math.abs(released.eye - 1.7) < 0.01 && !released.active, JSON.stringify(released))

  // Rutschen: Sprint (volle Joystick-Auslenkung) + Button halten, früh loslassen
  await page.evaluate(() => {
    // Freie Bahn (bei x = 0 steht die Deckung vor dem Süd-Spawn)
    __dusk.player.spawn({ x: -8, y: 1.7, z: 20, clone() { return this } })
    __dusk.camera.lookAt(-8, 1.7, 0)
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    __dusk.player.setSprinting(true)
    __dusk.player.setMoveInput(0, 1)
  })
  await wait(400)
  await press()
  await wait(150)
  const sliding = await state()
  await release()
  await wait(100)
  const afterRelease = await state()
  await page.evaluate(() => {
    __dusk.player.setMoveInput(0, 0)
    __dusk.player.setSprinting(false)
  })
  await wait(400)
  const standing = await state()
  check('Halten im Sprint: rutscht', sliding.sliding, JSON.stringify(sliding))
  check('Loslassen beendet das Rutschen sofort', !afterRelease.sliding)
  check('danach wieder aufrecht', Math.abs(standing.eye - 1.7) < 0.01, `Augenhöhe ${standing.eye.toFixed(2)}`)
  // Zielen-Button: halten = zielen (Zoom, Waffe mittig), loslassen = Hüftfeuer
  const aimBox = await page.locator('#aim-button').boundingBox()
  const aimPoint = { x: aimBox.x + aimBox.width / 2, y: aimBox.y + aimBox.height / 2, id: 3 }
  await page.evaluate(() => {
    __dusk.player.spawn({ x: -8, y: 1.7, z: 12, clone() { return this } })
    __dusk.weapon.switchTo('pistol')
    __dusk.weapon.switchRemaining = 0
  })
  await wait(400)
  const aimState = () => page.evaluate(() => ({ aiming: __dusk.weapon.isAiming, fov: __dusk.camera.fov, gunX: __dusk.weapon.view.group.position.x, active: document.querySelector('#aim-button').classList.contains('active') }))
  const beforeAim = await aimState()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [aimPoint] })
  await wait(700)
  const aimed = await aimState()
  check('Zielen halten: Zoom 75 -> 60°, Waffe mittig, Button leuchtet', aimed.aiming && Math.abs(aimed.fov - 60) < 0.5 && Math.abs(aimed.gunX) < 0.01 && aimed.active && !beforeAim.aiming, JSON.stringify(aimed))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(700)
  const unaimed = await aimState()
  check('Zielen loslassen: Blickfeld und Waffe zurück, Button aus', !unaimed.aiming && Math.abs(unaimed.fov - 75) < 0.5 && unaimed.gunX > 0.2 && !unaimed.active, JSON.stringify(unaimed))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [aimPoint] })
  await wait(400)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await wait(500)
  check('Touch-Abbruch beendet das Zielen', !(await aimState()).aiming)

  // Schießen-Button: gedrückt halten und wischen = schießen und zielen
  const shootBox = await page.locator('#shoot-button').boundingBox()
  const shootPoint = { x: shootBox.x + shootBox.width / 2, y: shootBox.y + shootBox.height / 2, id: 2 }
  await page.evaluate(() => {
    __dusk.player.spawn({ x: 0, y: 1.7, z: 12, clone() { return this } })
    __dusk.weapon.switchTo('rifle')
    __dusk.weapon.switchRemaining = 0
    window.__yaw0 = __dusk.lookControl.euler.y
  })
  const ammo0 = await page.evaluate(() => __dusk.weapon.ammo)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [shootPoint] })
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...shootPoint, x: shootPoint.x - i * 8 }] })
    await wait(40)
  }
  const during = await page.evaluate(() => ({ turned: __dusk.lookControl.euler.y - window.__yaw0, ammo: __dusk.weapon.ammo }))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(300)
  const ammoAfter = await page.evaluate(() => __dusk.weapon.ammo)
  await wait(300)
  check('Wischen auf Schießen dreht die Sicht', Math.abs(during.turned - 80 * 0.0025) < 0.02, `${during.turned.toFixed(3)} rad`)
  check('dabei wird geschossen, Loslassen stoppt', during.ammo < ammo0 && (await page.evaluate(() => __dusk.weapon.ammo)) === ammoAfter, `${ammo0} -> ${during.ammo} -> ${ammoAfter}`)

  // Sprung-Button halten: hüpft weiter (wie gehaltene Leertaste), Loslassen stoppt
  const jumpBox = await page.locator('#jump-button').boundingBox()
  const jumpPoint = { x: jumpBox.x + jumpBox.width / 2, y: jumpBox.y + jumpBox.height / 2, id: 3 }
  await page.evaluate(() => {
    window.__jumps = 0
    const onJump = __dusk.player.onJump
    __dusk.player.onJump = () => {
      window.__jumps++
      onJump?.()
    }
  })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [jumpPoint] })
  await wait(2500)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const jumpsHeld = await page.evaluate(() => window.__jumps)
  await wait(1500)
  const jumpsAfter = await page.evaluate(() => window.__jumps)
  check('Sprung halten: hüpft mehrfach', jumpsHeld >= 3, `${jumpsHeld} Sprünge in 2,5 s`)
  check('Loslassen: keine weiteren Sprünge', jumpsAfter - jumpsHeld <= 1, `${jumpsAfter - jumpsHeld} danach`)
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
