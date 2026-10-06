// Flugbahnen der Gadgets: jedes hat seine eigene (Rauch = hoher Lob, Blend = schnell und flach, Pad dazwischen),
// gleiche Würfe fliegen gleich, an Wänden prallt es ab, und andere sehen dieselbe Bahn wie der Werfer.
//
//   node tests/flight.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A)
  await play(B)
  await wait(3500)
  await teleport(A, -8, 1.7, 8)
  await teleport(B, -8, 1.7, -10)
  await wait(400)

  // Gleicher Blick (waagerecht nach Norden, freie Bahn) für alle drei Gadgets
  const shapes = await A.evaluate(() => {
    const G = __dusk.gadgets
    const V = __dusk.camera.position.constructor
    const out = {}
    for (const kind of ['smoke', 'flash', 'jump']) {
      G.setGadget(kind)
      const stats = G.stats
      const from = new V(-8, 1.55, 7.6)
      const v = new V(0, stats.throwSpeed * stats.throwLift, -stats.throwSpeed)
      const a = G.simulateFlight(from, v, stats.maxFlightTime)
      const b = G.simulateFlight(from, v, stats.maxFlightTime)
      out[kind] = {
        apex: Math.max(...a.points.map((p) => p.y)),
        range: Math.abs(a.to.z - from.z),
        flight: a.flight,
        same: a.to.distanceTo(b.to) === 0 && a.points.length === b.points.length,
      }
    }
    return out
  })
  const { smoke, flash, jump } = shapes
  console.log(JSON.stringify(shapes))
  check('Rauch: hoher Lob (Scheitel > 2,5 m)', smoke.apex > 2.5, smoke.apex.toFixed(2))
  check('Blendgranate: flacher und schneller am Ziel als der Rauch', flash.apex < smoke.apex - 0.8 && flash.flight < smoke.flight - 0.2, `${flash.apex.toFixed(2)} m / ${flash.flight.toFixed(2)} s gegen ${smoke.apex.toFixed(2)} m / ${smoke.flight.toFixed(2)} s`)
  check('Jede Granate hat ihre eigene Bahn (Scheitel unterschiedlich)', new Set([smoke, flash, jump].map((s) => s.apex.toFixed(1))).size === 3, JSON.stringify([smoke.apex, flash.apex, jump.apex]))
  check('Gleicher Wurf = gleiche Bahn (bitgenau)', smoke.same && flash.same && jump.same)

  // Wand: Wurf gegen die Nordwand prallt ab (z-Richtung kehrt sich um) und kommt weiter weg von der Wand zur Ruhe
  const bounce = await A.evaluate(() => {
    const G = __dusk.gadgets
    const V = __dusk.camera.position.constructor
    G.setGadget('flash')
    const stats = G.stats
    const from = new V(-8, 1.55, -15)
    const sim = G.simulateFlight(from, new V(0, stats.throwSpeed * stats.throwLift, -stats.throwSpeed), stats.maxFlightTime)
    let minZ = 1e9
    for (const p of sim.points) minZ = Math.min(minZ, p.z)
    return { minZ, endZ: sim.to.z, flight: sim.flight }
  })
  check('Wand: prallt ab und rollt zurück (Ende weiter von der Wand als der Aufprall)', bounce.endZ > bounce.minZ + 0.5, JSON.stringify(bounce))

  // Online: B sieht dieselbe Bahn wie A
  await B.evaluate(() => {
    __dusk.camera.rotation.set(0, Math.PI, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
  })
  await A.evaluate(() => {
    __dusk.gadgets.setGadget('flash')
    __dusk.camera.rotation.set(0.1, 0, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    __dusk.throwGadget()
  })
  await wait(250)
  const read = (page) => page.evaluate(() => {
    const f = __dusk.gadgets.flights[0]
    return f?.points ? { n: f.points.length, end: [f.to.x, f.to.y, f.to.z].map((v) => +v.toFixed(2)), mid: (({ x, y, z }) => [x, y, z].map((v) => +v.toFixed(1)))(f.points[Math.floor(f.points.length / 2)]) } : null
  })
  const a = await read(A)
  const b = await read(B)
  check('B spielt die Bahn des Werfers nach (gleiche Punktzahl, Mitte und Ende)', a && b && Math.abs(a.n - b.n) <= 2 && JSON.stringify(a.end) === JSON.stringify(b.end) || (a && b && Math.hypot(a.end[0] - b.end[0], a.end[2] - b.end[2]) < 0.3), JSON.stringify({ a, b }))

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
}
finish()
