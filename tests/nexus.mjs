// Karte "Nexus": Spawns, Rampen auf den Laufsteg-Ring, Ring und Brücken begehbar, Turmtüren, Dach nur per
// Sprungpad (vom Sims) oder Enterhaken, Bunker-Dächer, Außenwände nach oben unbegrenzt (nie hinaus).
//
//   node tests/nexus.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await page.setViewportSize({ width: 480, height: 270 })
  await play(page)
  await wait(500)
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement })
    const G = __dusk.gadgets
    window.__real = Object.getPrototypeOf(G).update.bind(G)
    G.update = () => {}
    // yaw 0 = Norden (-z), +PI/2 = Westen, -PI/2 = Osten, PI = Süden
    window.__setup = (x, z, yaw = 0, pitch = 0, eye = 1.7, feet = 0) => {
      __dusk.player.spawn({ x, y: feet + eye, z, clone() { return this } })
      __dusk.player.bodyY = feet
      __dusk.camera.rotation.set(pitch, yaw, 0, 'YXZ')
      __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    }
    window.__frame = (dt) => {
      window.__real(dt)
      const P = __dusk.player
      const pad = G.padAt(__dusk.camera.position.x, __dusk.camera.position.z, P.feetHeight, P.team)
      if (pad && P.launchFromPad()) pad.pulse = 1
      P.update(dt)
    }
    window.__run = (seconds) => { for (let t = 0; t < seconds; t += 1 / 60) window.__frame(1 / 60) }
    window.__walk = (x, z, yaw, seconds, sprint = false) => {
      window.__setup(x, z, yaw)
      __dusk.player.setMoveInput(0, 1)
      __dusk.player.setSprinting(sprint)
      window.__run(seconds)
      __dusk.player.setMoveInput(0, 0)
      __dusk.player.setSprinting(false)
      const p = __dusk.camera.position
      return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), feet: +__dusk.player.feetHeight.toFixed(2) }
    }
  })

  // Spawns: im Spielfeld, am Boden, nicht in einem Hindernis, 8 Stück
  const spawns = await page.evaluate(() => {
    const R = 0.4
    return __dusk.arena.spawnPoints.map((s) => {
      const bad = __dusk.arena.solids.some(({ box }) => {
        const ox = Math.min(s.x + R, box.max.x) - Math.max(s.x - R, box.min.x)
        const oz = Math.min(s.z + R, box.max.z) - Math.max(s.z - R, box.min.z)
        const oy = Math.min(2, box.max.y) - Math.max(0.16, box.min.y)
        return ox > 0.02 && oz > 0.02 && oy > 0.02
      })
      return { x: s.x, z: s.z, bad, inside: Math.abs(s.x) < 27 && Math.abs(s.z) < 27 }
    })
  })
  check('8 Spawns, alle im Spielfeld und frei von Hindernissen', spawns.length === 8 && spawns.every((s) => !s.bad && s.inside), JSON.stringify(spawns.filter((s) => s.bad || !s.inside)))

  // Rampen auf den Ring (Fußhöhe 2,8 m) und Ring begehbar
  const rampNW = await page.evaluate(() => window.__walk(-23, -13, 0, 4))
  check('Rampe Nordwest führt auf den Nordsteg (Fußhöhe 2,8 m)', rampNW.feet === 2.8 && rampNW.z < -24.6, JSON.stringify(rampNW))
  const rampSE = await page.evaluate(() => window.__walk(23, 13, Math.PI, 4))
  check('Rampe Südost führt auf den Südsteg (punktgespiegelt)', rampSE.feet === 2.8 && rampSE.z > 24.6, JSON.stringify(rampSE))
  const ringE = await page.evaluate(() => { window.__setup(-23, -26, -Math.PI / 2, 0, 1.7, 2.8); __dusk.player.setMoveInput(0, 1); window.__run(9); __dusk.player.setMoveInput(0, 0); const p = __dusk.camera.position; return { x: +p.x.toFixed(1), z: +p.z.toFixed(1), feet: +__dusk.player.feetHeight.toFixed(2) } })
  check('Nordsteg entlang: über die ganze Länge begehbar (auch an der Brückenlücke)', ringE.x > 24 && ringE.feet === 2.8, JSON.stringify(ringE))

  // Brücke vom Steg zum Sims (Norden, Mitte): endet am Turm
  const bridge = await page.evaluate(() => { window.__setup(0, -26, Math.PI, 0, 1.7, 2.8); __dusk.player.setMoveInput(0, 1); window.__run(4); __dusk.player.setMoveInput(0, 0); const p = __dusk.camera.position; return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), feet: +__dusk.player.feetHeight.toFixed(2) } })
  check('Brücke Nord: vom Steg bis an den Turm (Sims, Fußhöhe 2,8 m)', bridge.feet === 2.8 && bridge.z > -7 && bridge.z < -6, JSON.stringify(bridge))

  // Turmtür: von außen hinein bis an den Mittelblock
  const door = await page.evaluate(() => window.__walk(0, -14, Math.PI, 3.2))
  check('Turmtür (Nord) ist passierbar: man steht innen vor dem Mittelblock', door.z > -3 && door.z < -1 && door.feet === 0, JSON.stringify(door))
  const doorW = await page.evaluate(() => window.__walk(-14, 0, -Math.PI / 2, 3.2))
  check('Tür West ebenso', doorW.x > -3 && doorW.x < -1 && doorW.feet === 0, JSON.stringify(doorW))

  // Dach: vom Boden und vom Sims zu Fuß unerreichbar; per Sprungpad vom Sims in Reichweite
  const noRoof = await page.evaluate(() => {
    let best = 0
    for (const [x, z, yaw] of [[0, -10, Math.PI], [10, 0, Math.PI / 2], [3, 10, 0], [-10, 3, -Math.PI / 2]]) {
      window.__setup(x, z, yaw)
      __dusk.player.setMoveInput(0, 1)
      for (let i = 0; i < 20; i++) { if (i % 3 === 0) __dusk.player.jump(); window.__run(0.25) }
      best = Math.max(best, __dusk.player.feetHeight)
    }
    __dusk.player.setMoveInput(0, 0)
    return best
  })
  check('Dach ist ohne Fähigkeit nicht erreichbar (Hüpfen am Turm: höchstens Sims)', noRoof < 3.5, String(noRoof))

  const padRoof = await page.evaluate(() => {
    const G = __dusk.gadgets
    const V = __dusk.camera.position.constructor
    G.pads.length = 0
    G.spawnPad(new V(7.4, 3.05, 3), __dusk.player.team)
    G.pads[0].age = 1
    window.__setup(7.4, 3, Math.PI / 2, 0, 1.7, 2.8) // blickt nach Westen, zum Turm
    __dusk.player.setMoveInput(0, 1)
    window.__run(2.5)
    __dusk.player.setMoveInput(0, 0)
    window.__run(1)
    const p = __dusk.camera.position
    G.pads.length = 0
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), feet: +__dusk.player.feetHeight.toFixed(2) }
  })
  check('Sprungpad auf dem Sims bringt aufs Dach (Fußhöhe 6,0 m, über dem Turm)', padRoof.feet === 6 && Math.abs(padRoof.x) < 6 && Math.abs(padRoof.z) < 6, JSON.stringify(padRoof))

  // Haken: von außen auf das Dach (Kante der Dachplatte anvisieren)
  const hookRoof = await page.evaluate(() => {
    const V = __dusk.camera.position.constructor
    const G = __dusk.gadgets
    G.setGadget('grapple')
    G.reset()
    const target = new V(3, 5.75, -6)
    const eye = new V(3, 1.7, -14)
    const pitch = Math.atan2(target.y - eye.y, eye.distanceTo(new V(target.x, eye.y, target.z)))
    window.__setup(3, -14, Math.PI, 0)
    __dusk.camera.rotation.set(pitch, Math.PI, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    __dusk.throwSlot('move')
    const pulling = __dusk.player.isGrappling
    window.__run(2.5)
    const p = __dusk.camera.position
    return { pulling, x: +p.x.toFixed(2), z: +p.z.toFixed(2), feet: +__dusk.player.feetHeight.toFixed(2) }
  })
  check('Enterhaken von außen auf die Dachkante: man landet auf dem Dach', hookRoof.pulling && hookRoof.feet === 6 && Math.abs(hookRoof.z) < 6, JSON.stringify(hookRoof))

  // Bunker-Dach (4 m): per Haken vom Boden
  const hookBunker = await page.evaluate(() => {
    const V = __dusk.camera.position.constructor
    const G = __dusk.gadgets
    G.reset()
    // Bunker Nordost (16, -16): Dachkante zur Mitte hin, x = 12,25
    const target = new V(12.25, 3.85, -16)
    const eye = new V(5, 1.7, -16)
    const pitch = Math.atan2(target.y - eye.y, eye.distanceTo(new V(target.x, eye.y, target.z)))
    window.__setup(5, -16, -Math.PI / 2, 0)
    __dusk.camera.rotation.set(pitch, -Math.PI / 2, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    __dusk.throwSlot('move')
    const pulling = __dusk.player.isGrappling
    window.__run(2.5)
    const p = __dusk.camera.position
    return { pulling, x: +p.x.toFixed(2), feet: +__dusk.player.feetHeight.toFixed(2) }
  })
  check('Enterhaken auf das Bunker-Dach (4 m)', hookBunker.pulling && hookBunker.feet === 4 && hookBunker.x > 12, JSON.stringify(hookBunker))

  // Hinaus kommt man nie: 150 Sprungpad-/Haken-/Sprint-Läufe von zufälligen Orten, auch am Rand
  const escape = await page.evaluate(() => {
    const V = __dusk.camera.position.constructor
    const G = __dusk.gadgets
    const P = __dusk.player
    let seed = 11
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    let outside = 0, runs = 0, maxFeet = 0
    for (let i = 0; i < 150; i++) {
      const x = -26 + rnd() * 52, z = -26 + rnd() * 52
      G.reset()
      G.pads.length = 0
      window.__setup(x, z, rnd() * 6.28)
      if (i % 2 === 0) {
        G.setGadget('jump')
        G.spawnPad(new V(x, 0.25, z), P.team)
        if (G.pads[0]) G.pads[0].age = 1 // ohne Platz darüber (Steg, Sims, Dach) gibt es kein Pad
      } else {
        G.setGadget('grapple')
        __dusk.camera.rotation.set((rnd() - 0.3) * 1.2, rnd() * 6.28, 0, 'YXZ')
        __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
        __dusk.throwSlot('move')
      }
      P.setMoveInput(rnd() < 0.5 ? 0 : (rnd() < 0.5 ? -1 : 1), 1)
      P.setSprinting(true)
      for (let f = 0; f < 60 * 6; f++) {
        if (f % 40 === 0) P.jump()
        window.__frame(1 / 60)
        maxFeet = Math.max(maxFeet, P.feetHeight)
      }
      P.setMoveInput(0, 0)
      P.setSprinting(false)
      const p = __dusk.camera.position
      runs++
      if (Math.abs(p.x) > 28 || Math.abs(p.z) > 28 || p.y > 60 || p.y < -2) outside++
    }
    G.pads.length = 0
    return { runs, outside, maxFeet: +maxFeet.toFixed(1) }
  })
  check('150 Läufe mit Pad/Haken/Sprint: nie außerhalb der Karte', escape.outside === 0, JSON.stringify(escape))

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
