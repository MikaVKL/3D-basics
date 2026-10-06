// Lehnen (Q links, E rechts): Kamera seitlich versetzt und gekippt, Körper bleibt stehen, Wand stoppt
// die Kamera, kein Lehnen im Sprint/Rutschen, langsamer, Netzwerk-Position ohne Versatz.
//
//   node tests/lean.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(600)
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement })
    // Kamerakippen beim Zeichnen mitschreiben
    window.__roll = 0
    const render = __dusk.renderer.render.bind(__dusk.renderer)
    __dusk.renderer.render = (scene, camera) => {
      window.__roll = camera.rotation.z // Kippen, das gerade gezeichnet wird
      render(scene, camera)
    }
    window.__setup = (x, z, yaw = 0) => {
      __dusk.player.spawn({ x, y: 1.7, z, clone() { return this } })
      __dusk.camera.rotation.set(0, yaw, 0, 'YXZ')
      __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    }
    window.__run = (seconds) => {
      for (let t = 0; t < seconds; t += 1 / 60) __dusk.player.update(1 / 60)
    }
  })
  const read = () =>
    page.evaluate(() => {
      const P = __dusk.player
      const net = P.getNetworkState()
      return { lean: Number(P.lean.toFixed(3)), camX: Number(__dusk.camera.position.x.toFixed(3)), camZ: Number(__dusk.camera.position.z.toFixed(3)), netX: Number(net.position.x.toFixed(3)), roll: window.__roll }
    })

  // Freier Platz, Blick nach Norden (-z): rechts = +x
  await page.evaluate(() => window.__setup(-8, 8))
  await page.evaluate(() => window.__run(0.1))
  const rest = await read()
  check('Ohne Taste: gerade, Kamera auf der Körperposition', rest.lean === 0 && rest.camX === -8 && rest.netX === -8, JSON.stringify(rest))

  await page.keyboard.down('KeyE')
  await page.evaluate(() => window.__run(0.5))
  const right = await read()
  check('E: ganz nach rechts gelehnt (+0,45 m seitlich), Netzwerk-Position bleibt am Körper', right.lean === 1 && Math.abs(right.camX - (-8 + 0.45)) < 0.01 && right.netX === -8, JSON.stringify(right))
  await wait(250)
  const tilted = await read()
  check('Kamera kippt im Bild nach rechts (Uhrzeigersinn, ~12°)', tilted.roll < -0.15 && tilted.roll > -0.3, `Roll ${tilted.roll}`)
  await page.keyboard.up('KeyE')
  await page.evaluate(() => window.__run(0.5))
  const back = await read()
  check('E loslassen: zurück auf die Körperposition', back.lean === 0 && back.camX === -8, JSON.stringify(back))
  await wait(250)
  check('Kippen wieder weg', Math.abs((await read()).roll) < 0.02)

  await page.keyboard.down('KeyQ')
  await page.evaluate(() => window.__run(0.5))
  const left = await read()
  check('Q: ganz nach links (-0,45 m)', left.lean === -1 && Math.abs(left.camX - (-8 - 0.45)) < 0.01 && left.netX === -8, JSON.stringify(left))
  await page.keyboard.down('KeyE')
  await page.evaluate(() => window.__run(0.5))
  check('Q und E zusammen: gerade', (await read()).lean === 0)
  await page.keyboard.up('KeyE')
  await page.keyboard.up('KeyQ')

  // Weich: nicht in einem Frame
  await page.keyboard.down('KeyE')
  const soft = await page.evaluate(() => {
    window.__run(0.5 * 0) // nichts
    __dusk.player.update(1 / 60)
    return Number(__dusk.player.lean.toFixed(2))
  })
  check('Lehnen läuft weich ein (nach 1 Frame erst ein Teil, nie sofort ganz)', soft > 0 && soft < 0.5, String(soft))
  await page.keyboard.up('KeyE')
  await page.evaluate(() => window.__run(0.5))

  // Wand: dicht neben einer Wand stoppt die Kamera davor
  const wall = await page.evaluate(() => {
    const V = __dusk.camera.position.constructor
    const found = __dusk.arena.solids
      .filter((s) => s.kind === 'wall')
      .map((s) => ({ s, size: s.box.getSize(new V()), c: s.box.getCenter(new V()) }))
      .find(({ size, s }) => size.y > 3 && size.x < 1.5 && size.z > 8 && s.box.min.y < 0.5 && Math.abs(s.box.getCenter(new V()).x) < 30)
    if (!found) return null
    const x = found.s.box.min.x - 0.31
    window.__setup(x, found.c.z)
    return { wallX: found.s.box.min.x, x, z: found.c.z }
  })
  if (!wall) check('Wand zum Testen gefunden', false)
  else {
    await page.keyboard.down('KeyE')
    await page.evaluate(() => window.__run(0.6))
    const nearWall = await read()
    const gap = wall.wallX - nearWall.camX
    check('Dicht an der Wand (rechts): Kamera stoppt davor, nicht durch die Wand', gap >= 0.1 && nearWall.camX - wall.x < 0.25 && nearWall.lean > 0 && nearWall.lean < 0.5, JSON.stringify({ gap: Number(gap.toFixed(3)), ...nearWall }))
    await page.keyboard.up('KeyE')
    await page.keyboard.down('KeyQ')
    await page.evaluate(() => window.__run(0.6))
    const awayFromWall = await read()
    check('Zur freien Seite (links) volles Lehnen', awayFromWall.lean === -1, JSON.stringify(awayFromWall))
    await page.keyboard.up('KeyQ')
  }

  // Tempo und Sprint
  const speeds = await page.evaluate(() => {
    const P = __dusk.player
    const walk = (lean) => {
      window.__setup(-8, 10)
      P.setLean(lean)
      P.setMoveInput(0, 1)
      window.__run(0.6)
      const v = P.horizontalSpeed
      P.setMoveInput(0, 0)
      P.setLean(0)
      window.__run(0.3)
      return v
    }
    const straight = walk(0)
    const leaning = walk(1)
    // Beim Lehnen gibt es keinen Sprint: man läuft mit 75 % Tempo weiter, gelehnt (Shift/Joystick voll ändern daran nichts)
    window.__setup(-8, 12)
    P.setLean(1)
    P.setSprinting(true)
    P.setMoveInput(0, 1)
    window.__run(0.8)
    const sprintLean = P.lean
    const sprintSpeed = P.horizontalSpeed
    P.setSprinting(false)
    P.setMoveInput(0, 0)
    P.setLean(0)
    window.__run(0.3)
    return { straight: Number(straight.toFixed(2)), leaning: Number(leaning.toFixed(2)), sprintLean: Number(sprintLean.toFixed(2)), sprintSpeed: Number(sprintSpeed.toFixed(2)) }
  })
  check('Gelehnt gehen: 75 % des Tempos', Math.abs(speeds.leaning / speeds.straight - 0.75) < 0.03, JSON.stringify(speeds))
  check('Lehnen + Sprint-Eingabe: bleibt gelehnt und läuft mit Geh-Tempo x 0,75 (kein Sprint)', speeds.sprintLean === 1 && Math.abs(speeds.sprintSpeed - speeds.leaning) < 0.1, JSON.stringify(speeds))

  // Tod und Neu-Spawn: gerade
  const dead = await page.evaluate(() => {
    window.__setup(-8, 8)
    __dusk.player.setLean(1)
    window.__run(0.4)
    __dusk.player.takeDamage(999)
    window.__run(0.2)
    return { lean: __dusk.player.lean, camX: Number(__dusk.camera.position.x.toFixed(2)) }
  })
  check('Tot: Lehnen aus, Kamera wieder am Körper', dead.lean === 0 && dead.camX === -8, JSON.stringify(dead))

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
