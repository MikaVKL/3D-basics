// Testkarte Skyline (?map=skyline, nur offline): 8 freie Spawns in den Hallen, Rampe Halle -> Dach, Skybridge,
// Stege (Rampe 18 -> 20 m), Atrium (Sprung in die Mitte), Absturz in den Nebel, Flugmodus, Draw Calls.
//
//   node tests/skyline.mjs
import { startServers, launchBrowser, GAME_URL, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${GAME_URL}?map=skyline`)
  await page.waitForFunction(() => 'undefined' !== typeof window.__dusk)
  await play(page)
  await wait(800)
  check('Offline: kein Server, Status ohne Verbindung', await page.evaluate(() => !__dusk.network.hasServer))
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement })
    const G = __dusk.gadgets
    window.__real = Object.getPrototypeOf(G).update.bind(G)
    G.update = () => {}
    // yaw 0 = Norden (-z), +PI/2 = Westen, -PI/2 = Osten, PI = Süden
    window.__setup = (x, z, yaw = 0, pitch = 0, feet = 0) => {
      __dusk.player.spawn({ x, y: feet + 1.7, z, clone() { return this } })
      __dusk.player.bodyY = feet
      __dusk.camera.rotation.set(pitch, yaw, 0, 'YXZ')
      __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    }
    window.__aim = (yaw) => { __dusk.camera.rotation.set(0, yaw, 0, 'YXZ'); __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion) }
    window.__run = (seconds) => { for (let t = 0; t < seconds; t += 1 / 60) __dusk.player.update(1 / 60) }
    window.__walk = (x, z, feet, yaw, seconds, sprint = false) => {
      window.__setup(x, z, yaw, 0, feet)
      __dusk.player.setMoveInput(0, 1)
      __dusk.player.setSprinting(sprint)
      window.__run(seconds)
      __dusk.player.setMoveInput(0, 0)
      __dusk.player.setSprinting(false)
      const p = __dusk.camera.position
      return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), feet: +__dusk.player.feetHeight.toFixed(2) }
    }
  })
  const E = -Math.PI / 2, W = Math.PI / 2

  // Spawns
  const spawns = await page.evaluate(() => {
    const R = 0.4
    return __dusk.arena.spawnPoints.map((s) => {
      const bad = __dusk.arena.solids.some(({ box }) => {
        const ox = Math.min(s.x + R, box.max.x) - Math.max(s.x - R, box.min.x)
        const oz = Math.min(s.z + R, box.max.z) - Math.max(s.z - R, box.min.z)
        const oy = Math.min(s.y + 0.3, box.max.y) - Math.max(s.y - 1.55, box.min.y)
        return ox > 0.02 && oz > 0.02 && oy > 0.02
      })
      return { x: s.x, z: s.z, y: s.y, bad }
    })
  })
  check('8 Spawns, alle frei und in einer Halle (Boden 12 m)', spawns.length === 8 && spawns.every((s) => !s.bad && Math.abs(s.y - 13.7) < 0.01), JSON.stringify(spawns.filter((s) => s.bad)))
  const stand = await page.evaluate(() => { __setup(-26, -5.5, 0, 0, 12); __run(1); return __dusk.player.feetHeight })
  check('Spawn: man steht auf dem Hallenboden (12 m)', Math.abs(stand - 12) < 0.05, String(stand))

  // Rampe Halle A -> Dach A (Boden 12 -> Dach 18)
  const up = await page.evaluate((E) => __walk(-27, 6.2, 12, E, 2.05), E)
  check('Rampe führt aus der Halle A aufs Dach (18 m)', Math.abs(up.feet - 18) < 0.1 && up.x > -16, JSON.stringify(up))
  const upB = await page.evaluate((W) => __walk(27, -6.2, 12, W, 2.05), W)
  check('Gespiegelt: Rampe aus Halle B aufs Dach B', Math.abs(upB.feet - 18) < 0.1 && upB.x < 16, JSON.stringify(upB))

  // Rampenfuß: die Rampe hinunter, am Fuß nach rechts (Norden) abbiegen - muss mit Platz zum Drehen gehen
  const turn = await page.evaluate((W) => {
    __setup(-24, 6.2, W, 0, 13.16) // auf der Rampe, Blick nach Westen
    __dusk.player.setMoveInput(0, 1)
    __run(1.0) // hinunter und ein Stück in die Halle
    const foot = { x: __dusk.camera.position.x, feet: __dusk.player.feetHeight }
    __aim(0) // nach rechts (Norden)
    __run(0.7)
    __dusk.player.setMoveInput(0, 0)
    const p = __dusk.camera.position
    return { footX: +foot.x.toFixed(2), footFeet: +foot.feet.toFixed(2), x: +p.x.toFixed(2), z: +p.z.toFixed(2), feet: +__dusk.player.feetHeight.toFixed(2) }
  }, W)
  check('Rampenfuß: hinunter und nach rechts abbiegen geht ohne Hängen (vorher 1 m Platz)', turn.footFeet < 12.1 && turn.z < 3.5 && Math.abs(turn.feet - 12) < 0.05, JSON.stringify(turn))

  // Kein Hineinglitschen in die Rampe: der Streifen hinter dem oberen Rampenende muss zu sein
  const slip = await page.evaluate((W) => {
    __setup(-15.2, 3.2, Math.PI, 0, 12) // Blick nach Süden, neben dem Rampenende
    __dusk.player.setMoveInput(0, 1)
    __run(0.7) // nach Süden in Richtung hinter die Rampe
    __aim(W)
    __run(1.0) // dann nach Westen unter die Rampe
    __dusk.player.setMoveInput(0, 0)
    const p = __dusk.camera.position
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), feet: +__dusk.player.feetHeight.toFixed(2) }
  }, W)
  const insideRamp = slip.x < -15.7 && slip.z > 4.5
  check('Rampe A: man kommt von hinten/seitlich nicht in die Rampe hinein', !insideRamp, JSON.stringify(slip))
  const slipB = await page.evaluate((E) => {
    __setup(15.2, -3.2, 0, 0, 12)
    __dusk.player.setMoveInput(0, 1)
    __run(0.7)
    __aim(E)
    __run(1.0)
    __dusk.player.setMoveInput(0, 0)
    const p = __dusk.camera.position
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2) }
  }, E)
  check('Rampe B (gespiegelt): ebenso', !(slipB.x > 15.7 && slipB.z < -4.5), JSON.stringify(slipB))

  // Außenterrasse A -> C (offen, Nordseite): durch die Nordtür hinaus, an der Außenseite entlang, durch die Nordtür der Mitte hinein
  const terrace = await page.evaluate((E) => {
    __setup(-16.5, -5, 0, 0, 12) // in Halle A, Blick nach Norden zur Tür
    __dusk.player.setMoveInput(0, 1)
    __run(1.0)
    const out = { x: __dusk.camera.position.x, z: __dusk.camera.position.z, feet: __dusk.player.feetHeight }
    __aim(E) // an der Außenseite nach Osten
    __run(2.2) // ~13 m bis vor die Tür der Mitte
    const mid = { x: __dusk.camera.position.x, z: __dusk.camera.position.z, feet: __dusk.player.feetHeight }
    __aim(Math.PI) // nach Süden durch die Tür der Mitte
    __run(0.9)
    __dusk.player.setMoveInput(0, 0)
    const p = __dusk.camera.position
    return { out: [+out.x.toFixed(1), +out.z.toFixed(1), out.feet], mid: [+mid.x.toFixed(1), +mid.z.toFixed(1), mid.feet], end: [+p.x.toFixed(1), +p.z.toFixed(1), +__dusk.player.feetHeight.toFixed(2)] }
  }, E)
  check('Terrasse: aus Halle A hinaus (z < -9,5), draußen entlang (12 m), in Halle C hinein (z > -7)', terrace.out[1] < -9.5 && terrace.mid[0] > -4.5 && terrace.mid[2] === 12 && terrace.end[1] > -7 && terrace.end[2] === 12, JSON.stringify(terrace))
  const rail = await page.evaluate(() => {
    __setup(-10, -10.2, 0, 0, 12)
    __dusk.player.setMoveInput(0, 1)
    __run(0.6) // nach Norden gegen die Reling
    const north = { z: __dusk.camera.position.z, feet: __dusk.player.feetHeight }
    __aim(Math.PI)
    __run(0.8) // nach Süden zur Lücke hin
    __dusk.player.setMoveInput(0, 0)
    return { north: +north.z.toFixed(2), south: +__dusk.camera.position.z.toFixed(2), feet: +__dusk.player.feetHeight.toFixed(2) }
  })
  check('Reling hält: man fällt auf der Terrasse nicht von selbst hinunter', rail.north > -11.5 && rail.south < -8.9 && rail.feet === 12, JSON.stringify(rail))
  const terraceB = await page.evaluate(() => {
    __setup(16.5, 5, Math.PI, 0, 12)
    __dusk.player.setMoveInput(0, 1)
    __run(1.0)
    const out = __dusk.camera.position.z
    __aim(Math.PI / 2) // nach Westen an der Außenseite
    __run(2.2)
    const x = __dusk.camera.position.x
    __dusk.player.setMoveInput(0, 0)
    return { out: +out.toFixed(1), x: +x.toFixed(1), feet: +__dusk.player.feetHeight.toFixed(2) }
  })
  check('Gespiegelt: Terrasse C -> B auf der Südseite', terraceB.out > 9.5 && terraceB.x < 4.5 && terraceB.feet === 12, JSON.stringify(terraceB))

  // Skybridge A -> C -> B (auf 12 m, drinnen)
  const bridge = await page.evaluate((E) => __walk(-20, 0, 12, E, 4.2), E)
  check('Skybridge: von Halle A in die Mitte (Boden 12 m)', Math.abs(bridge.feet - 12) < 0.05 && bridge.x > -5, JSON.stringify(bridge))
  const bridge2 = await page.evaluate((E) => __walk(-4, 0, 12, E, 4.5), E)
  check('Skybridge: von der Mitte weiter in Halle B', Math.abs(bridge2.feet - 12) < 0.05 && bridge2.x > 15.5, JSON.stringify(bridge2))

  // Stege auf den Dächern: A -> C (18 -> 20), C -> B
  const steg = await page.evaluate((E) => __walk(-16, -5, 18, E, 2.2), E)
  check('Steg Nord: Rampe von Dach A (18 m) auf Dach C (20 m)', Math.abs(steg.feet - 20) < 0.1 && steg.x > -6, JSON.stringify(steg))
  const steg2 = await page.evaluate((E) => __walk(6.5, 5, 20, E, 2.2), E)
  check('Steg Süd: von Dach C (20 m) hinunter auf Dach B (18 m)', Math.abs(steg2.feet - 18) < 0.1 && steg2.x > 14, JSON.stringify(steg2))

  // Atrium: vom Dach C ins Loch -> Hallenboden der Mitte
  const atrium = await page.evaluate(() => { __setup(0, 0, 0, 0, 20); __run(2); return { feet: __dusk.player.feetHeight } })
  check('Atrium: Sprung ins Loch führt in die Halle C (12 m)', Math.abs(atrium.feet - 12) < 0.05, JSON.stringify(atrium))

  // Absturz: Lücke zwischen A und C außerhalb von Steg/Skybridge -> neu an einem Spawn
  await page.evaluate(() => __setup(-10, -8, 0, 0, 30))
  await wait(9000)
  const afterFall = await page.evaluate(() => ({ feet: __dusk.player.feetHeight, alive: __dusk.player.isAlive }))
  check('Absturz in den Nebel: neu in einer Halle (12 m)', afterFall.alive && afterFall.feet > 11, JSON.stringify(afterFall))

  // Flugmodus: H, durch die Wand fliegen, aus: wieder Schwerkraft
  const fly = await page.evaluate((E) => {
    __setup(-26, 0, E, 0, 12)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH' }))
    const on = __dusk.player.flying
    __dusk.player.setMoveInput(0, 1)
    __run(2)
    const p = __dusk.camera.position.clone()
    __dusk.player.setMoveInput(0, 0)
    __dusk.player.setJumpHeld(true)
    __run(1.5)
    const high = __dusk.camera.position.y
    __dusk.player.setJumpHeld(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH' }))
    return { on, x: p.x, y: p.y, high, off: !__dusk.player.flying }
  }, E)
  check('Flugmodus (H): 2 s geradeaus ~32 m, durch Wände, Leertaste steigt', fly.on && fly.x > 0 && fly.high > fly.y + 15 && fly.off, JSON.stringify(fly))
  await page.evaluate(() => { __setup(-26, -5.5, 0, 0, 12); __run(0.5) })

  // Fenster (Entwurf: 14 Fenster, 2 m breit, Brüstung 1 m; Öffnung 1,2 m hoch, damit man nicht hindurchkriecht)
  const windows = await page.evaluate(() => {
    const boxes = __dusk.arena.solids.map((s) => s.box)
    // Strahl entlang der Achse von (x,y,z) um len Meter; Abstand bis zur ersten Box (Infinity = frei)
    const cast = (x, y, z, dx, dz, len) => {
      let hit = Infinity
      for (const b of boxes) {
        let t0 = 0, t1 = 1
        const o = [x, y, z], d = [dx * len, 0, dz * len]
        const lo = [b.min.x, b.min.y, b.min.z], hi = [b.max.x, b.max.y, b.max.z]
        for (let i = 0; i < 3; i++) {
          if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) { t0 = 2; break } }
          else {
            let ta = (lo[i] - o[i]) / d[i], tb = (hi[i] - o[i]) / d[i]
            if (ta > tb) [ta, tb] = [tb, ta]
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb)
          }
        }
        if (t0 <= t1 && t1 > 0 && t0 < 1) hit = Math.min(hit, Math.max(0, t0) * len)
      }
      return hit
    }
    const eye = 13.7 // stehendes Auge in der Halle
    return {
      a1: cast(-27.5, eye, -6, 0, -1, 30), // durch Fenster 1 (Nordwand A) nach draußen
      a1wall: cast(-25.5, eye, -6, 0, -1, 30), // zwischen den Fenstern: Wand
      a3: cast(-28, eye, 6, 0, 1, 30), // Fenster 3 (Südwand A)
      a4: cast(-17, eye, -6.7, 1, 0, 30), // Fenster 4 (Ostwand A) zur Lücke: dahinter die Westwand der Mitte
      bridge: cast(-12.5, eye, 0, 0, -1, 40), // Skybridge-Scheibe 1: freier Blick nach Norden
      bridgeWall: cast(-8.7, eye, 0, 0, -1, 40), // zwischen den Scheiben: Wand
      c13: cast(2.5, eye, 0, 0, -1, 30), // Fenster 13 in der Nordwand der Mitte
      b8: cast(27.5, eye, 6, 0, 1, 30), // gespiegelt: Fenster 8 (Südwand B)
      below: cast(-27.5, 12.5, -6, 0, -1, 30), // unter der Brüstung: Wand
      above: cast(-27.5, 14.6, -6, 0, -1, 30), // über dem Fenster: Wand
    }
  })
  check('Fenster: Strahl durch Fenster 1 (Nordwand A) bis nach draußen frei, daneben, darunter und darüber Wand', windows.a1 > 20 && windows.a1wall < 4 && windows.below < 4 && windows.above < 4, JSON.stringify({ a1: windows.a1, a1wall: windows.a1wall, below: windows.below, above: windows.above }))
  check('Fenster 3 (Südwand A) und gespiegelt Fenster 8 (Südwand B) frei', windows.a3 > 20 && windows.b8 > 20, JSON.stringify({ a3: windows.a3, b8: windows.b8 }))
  check('Fenster 4 (Ostwand A): Blick über die Lücke endet an der Westwand der Mitte (nicht in Halle C)', windows.a4 > 8 && windows.a4 < 14, String(windows.a4))
  check('Fenster 13 (Nordwand der Mitte) frei', windows.c13 > 20, String(windows.c13))
  check('Skybridge: Scheibenöffnung frei, zwischen den Scheiben Wand', windows.bridge > 20 && windows.bridgeWall < 4, JSON.stringify({ bridge: windows.bridge, bridgeWall: windows.bridgeWall }))
  const through = await page.evaluate(() => {
    const P = __dusk.player
    // Gehen: nach Norden gegen Fenster 1 - die Brüstung stoppt
    __setup(-27.5, -6, 0, 0, 12)
    P.update(1 / 60)
    P.setMoveInput(0, 1)
    for (let f = 0; f < 60; f++) P.update(1 / 60)
    const walked = __dusk.camera.position.z
    // Auf die Brüstung steigen und geduckt weiter: die 1,2 m hohe Öffnung lässt den Kopf (1,3 m) nicht durch
    __setup(-27.5, -7.4, 0, 0, 13)
    P.update(1 / 60)
    P.setCrouching(true)
    P.setMoveInput(0, 1)
    for (let f = 0; f < 90; f++) P.update(1 / 60)
    P.setMoveInput(0, 0)
    P.setCrouching(false)
    return { walked: +walked.toFixed(2), crawl: +__dusk.camera.position.z.toFixed(2) }
  })
  check('Man kommt durch kein Fenster (gehen: Brüstung, geduckt auf der Brüstung: zu niedrig)', through.walked > -8 && through.crawl > -8.5, JSON.stringify(through))

  // Draw Calls an vier Blickpunkten (Budget wie Nexus)
  let worst = 0
  for (const [x, y, z] of [[-26, 12, -5.5], [0, 20, 0], [-24, 18, 0], [10, 21, -9]]) {
    const calls = await page.evaluate(([x, y, z]) => {
      __setup(x, z, 0, 0, y - 1.7)
      __dusk.renderer.info.reset()
      __dusk.renderer.render(__dusk.arena.group.parent, __dusk.camera)
      return __dusk.renderer.info.render.calls
    }, [x, y, z])
    worst = Math.max(worst, calls)
  }
  check('Draw Calls <= 60 an allen Blickpunkten', worst <= 60, String(worst))
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
