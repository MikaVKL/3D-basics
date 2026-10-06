// Enterhaken (Titanfall-Art): trifft sofort die Fläche im Fadenkreuz, zieht geradlinig hin, Seil sichtbar,
// Abklingzeit, kein Ziel = kein Wurf, Sprung bricht ab, Wand blockiert, Steg erklimmen, Server-Bewegungsprüfung.
//
//   node tests/grapple.mjs
import { startServers, launchBrowser, openGame, pickOption, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await page.setViewportSize({ width: 480, height: 270 })
  await page.click('#start-button')
  await pickOption(page, '.gadget-card[data-gadget="grapple"]')
  await page.click('#loadout-play-button')
  await wait(500)
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement })
    window.__sounds = []
    const play = __dusk.sound.play.bind(__dusk.sound)
    __dusk.sound.play = (n, v) => (window.__sounds.push(n), play(n, v))
    const G = __dusk.gadgets
    window.__real = Object.getPrototypeOf(G).update.bind(G)
    G.update = () => {}
    window.__setup = (x, z, yaw = 0, pitch = 0, eye = 1.7) => {
      __dusk.player.spawn({ x, y: eye, z, clone() { return this } })
      __dusk.camera.rotation.set(pitch, yaw, 0, 'YXZ')
      __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    }
    window.__frame = (dt) => {
      window.__real(dt)
      __dusk.player.update(dt)
    }
    window.__run = (seconds) => { for (let t = 0; t < seconds; t += 1 / 60) window.__frame(1 / 60) }
  })
  const gadget = await page.evaluate(() => __dusk.gadgets.gadget)
  check('Gadget Enterhaken gewählt', gadget === 'grapple', gadget)

  // Kein Ziel: steil in den Himmel -> kein Wurf, Abklingzeit bleibt 0, Hinweis
  const none = await page.evaluate(() => {
    window.__setup(-8, -5, 0, 1.4)
    __dusk.throwGadget()
    return { cd: __dusk.gadgets.cooldownRemaining, pulling: __dusk.player.isGrappling, reason: __dusk.gadgets.rejectReason }
  })
  check('Kein Ziel in Reichweite: kein Zug, Abklingzeit 0, Hinweis', none.cd === 0 && !none.pulling && none.reason.includes('Ziel'), JSON.stringify(none))

  // Gerader Zug nach Norden von (-25, -9)
  const wall = await page.evaluate(() => {
    window.__setup(-25, -9, 0, 0)
    __dusk.throwGadget()
    const anchor = __dusk.gadgets.ropes[0].anchor.clone()
    const dist = __dusk.camera.position.distanceTo(anchor)
    const start = { cd: __dusk.gadgets.cooldownRemaining, pulling: __dusk.player.isGrappling, ropes: __dusk.gadgets.ropes.length, dist: +dist.toFixed(1) }
    let t = 0
    while (__dusk.player.isGrappling && t < 3) { window.__frame(1 / 60); t += 1 / 60 }
    const p = __dusk.camera.position
    const left = +Math.hypot(anchor.x - p.x, anchor.z - p.z).toFixed(2)
    window.__run(0.4)
    return { ...start, time: +t.toFixed(2), left, sounds: window.__sounds.slice(-3) }
  })
  check('Zug zur Wand: Abklingzeit 10 s, Seil da, Hakenton', wall.cd === 10 && wall.pulling && wall.ropes === 1 && wall.sounds.includes('hookShot'), JSON.stringify(wall))
  check('Zug dauert Entfernung / 15 m/s (± 0,3 s) und endet dicht am Haken (< 1,3 m)', Math.abs(wall.time - wall.dist / 15) < 0.3 && wall.left < 1.3, JSON.stringify(wall))
  const ropeShape = await page.evaluate(() => {
    __dusk.gadgets.reset()
    window.__setup(25, -9, 0, Math.atan(0.95 / 8))
    __dusk.throwGadget()
    window.__run(0.2)
    const rope = __dusk.gadgets.ropes[0]
    const start = rope.origin()
    const dist = start.distanceTo(rope.anchor)
    const mid = start.clone().add(rope.anchor).multiplyScalar(0.5)
    return { inScene: !!rope.mesh.parent, lenOk: Math.abs(rope.mesh.scale.z - dist) < 0.5, midOk: rope.mesh.position.distanceTo(mid) < 0.5, dist: +dist.toFixed(1) }
  })
  check('Seil: im Bild, so lang wie Hand-Haken, mittig dazwischen', ropeShape.inScene && ropeShape.lenOk && ropeShape.midOk, JSON.stringify(ropeShape))
  const ropeGone = await page.evaluate(() => { window.__run(0.5); return __dusk.gadgets.ropes.length })
  check('Seil verschwindet nach dem Zug', ropeGone === 0, String(ropeGone))

  // Abklingzeit: sofort nochmal geht nicht
  const again = await page.evaluate(() => {
    window.__setup(-25, -9, 0, 0)
    __dusk.throwGadget()
    return __dusk.player.isGrappling
  })
  check('Abklingzeit: zweiter Wurf direkt danach zieht nicht', !again)

  // Sprung bricht den Zug ab
  const jump = await page.evaluate(() => {
    __dusk.gadgets.reset()
    window.__setup(-25, -9, 0, 0)
    __dusk.throwGadget()
    window.__run(0.3)
    const during = __dusk.player.isGrappling
    __dusk.player.jump()
    return { during, after: __dusk.player.isGrappling }
  })
  check('Sprung beendet den Zug', jump.during && !jump.after, JSON.stringify(jump))

  // Tod beendet den Zug, Spawn auch
  const dead = await page.evaluate(() => {
    __dusk.gadgets.reset()
    window.__setup(-25, -9, 0, 0)
    __dusk.throwGadget()
    window.__run(0.2)
    __dusk.player.takeDamage(999)
    window.__run(0.2)
    return __dusk.player.isGrappling
  })
  check('Tod beendet den Zug', !dead)

  // Nordsteg erklimmen (Boden 2,8 m, Vorderkante z = -17,5): von (25, -9) auf die Kante zielen
  const climb = await page.evaluate(() => {
    __dusk.gadgets.reset()
    window.__setup(25, -9, 0, Math.atan(0.95 / 8))
    __dusk.throwGadget()
    const pulling = __dusk.player.isGrappling
    window.__run(2.5)
    const P = __dusk.player
    return { pulling, feet: +P.feetHeight.toFixed(2), z: +__dusk.camera.position.z.toFixed(2), x: +__dusk.camera.position.x.toFixed(2), grounded: !P.isGrappling }
  })
  check('Steg erklimmen: nach dem Zug steht man oben auf dem Steg (Fußhöhe 2,8 m, hinter der Kante)', climb.pulling && climb.feet > 2.7 && climb.feet < 3 && climb.z < -17.6, JSON.stringify(climb))

  // Boden/Decke: auf die Decke zielen (unter dem Steg): zieht nach oben, bleibt nicht stecken
  const ceil = await page.evaluate(() => {
    __dusk.gadgets.reset()
    window.__setup(0, -19, 0, 1.4, 1.7)
    __dusk.throwGadget()
    const pulling = __dusk.player.isGrappling
    window.__run(2)
    return { pulling, grappling: __dusk.player.isGrappling, feet: +__dusk.player.feetHeight.toFixed(2) }
  })
  check('Zug an die Decke endet sauber (kein Hängenbleiben, kein Zug mehr)', !ceil.grappling, JSON.stringify(ceil))

  // Fuzz: 200 Würfe in zufällige Richtungen von zufälligen Orten; nie außerhalb der Karte, nie ewiger Zug
  const fuzz = await page.evaluate(() => {
    const P = __dusk.player
    let bad = 0, longest = 0, hooks = 0
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < 200; i++) {
      __dusk.gadgets.reset()
      window.__setup(-30 + rnd() * 70, -15 + rnd() * 28, rnd() * 6.28, (rnd() - 0.4) * 1.6)
      __dusk.throwGadget()
      if (!P.isGrappling) continue
      hooks++
      let t = 0
      while (P.isGrappling && t < 4) { window.__frame(1 / 60); t += 1 / 60 }
      longest = Math.max(longest, t)
      window.__run(2)
      const p = __dusk.camera.position
      if (P.isGrappling || Math.abs(p.x) > 60 || Math.abs(p.z) > 40 || p.y > 40 || p.y < -1) bad++
    }
    return { hooks, bad, longest: +longest.toFixed(2) }
  })
  check('Fuzz 200 Würfe: nie außerhalb der Karte, nie länger als 1,9 s', fuzz.hooks > 60 && fuzz.bad === 0 && fuzz.longest < 1.9, JSON.stringify(fuzz))

  // Server-Bewegungsprüfung: gezogene Strecken (steil nach oben und waagerecht) lösen keinen Fehlalarm aus
  const rules = await page.evaluate(async () => {
    const { createMovementCheck, checkMovement } = await import('/3D-basics/src/shared/movementRules.ts')
    const P = __dusk.player
    let bad = 0, states = 0
    for (const [x, z, pitch] of [[10, -8, Math.atan(0.1)], [-8, -5, 0], [-8, 10, 0.5], [20, 0, 0.3], [-25, -10, 0.2]]) {
      __dusk.gadgets.reset()
      window.__setup(x, z, 0, pitch)
      const check = createMovementCheck({ x, y: 1.7, z }, 0, 0)
      __dusk.throwGadget()
      let now = 0
      for (let f = 0; f < 60 * 4; f++) {
        window.__frame(1 / 60)
        if (f % 3 === 0) {
          now += 50
          states++
          const p = __dusk.camera.position
          if (!checkMovement(check, { x: p.x, y: p.y, z: p.z }, now)) bad++
        }
      }
    }
    return { states, bad }
  })
  check('Bewegungsprüfung des Servers: Züge ohne Fehlalarm', rules.states > 200 && rules.bad === 0, JSON.stringify(rules))

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
