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
    __dusk.player.spawn({ x: 0, y: 1.7, z: 20, clone() { return this } })
    __dusk.camera.lookAt(0, 1.7, 0)
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
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
