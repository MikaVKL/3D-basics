// Enterhaken online: B sieht das Seil von A zum Haken, der Server gibt den Zug weiter und lehnt
// Abklingzeit, zu weite Haken und Tote ab.
//
//   node tests/grapple-net.mjs
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
  await A.evaluate(() => __dusk.gadgets.setGadget('grapple'))
  await teleport(A, 25, 1.7, -9)
  await teleport(B, 10, 1.7, 5)
  await wait(400)
  await B.evaluate(() => {
    window.__hooks = 0
    const playAt = __dusk.sound.playAt.bind(__dusk.sound)
    __dusk.sound.playAt = (n, p, v) => (n === 'hookShot' && window.__hooks++, playAt(n, p, v))
  })
  await A.evaluate(() => {
    __dusk.camera.rotation.set(Math.atan(0.95 / 8), 0, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    __dusk.throwGadget()
  })
  await wait(250)
  const own = await A.evaluate(() => ({ pulling: __dusk.player.isGrappling, ropes: __dusk.gadgets.ropes.length, anchor: __dusk.gadgets.ropes[0]?.anchor.toArray().map((v) => +v.toFixed(1)) }))
  const other = await B.evaluate(() => ({ hooks: window.__hooks, ropes: __dusk.gadgets.ropes.length, anchor: __dusk.gadgets.ropes[0]?.anchor.toArray().map((v) => +v.toFixed(1)) }))
  check('A zieht sich, Seil bei A', own.pulling && own.ropes === 1, JSON.stringify(own))
  check('B hört den Abschuss und sieht das Seil am selben Haken', other.hooks === 1 && other.ropes === 1 && JSON.stringify(other.anchor) === JSON.stringify(own.anchor), JSON.stringify(other))

  // Direkt nochmal (Abklingzeit 10 s): Server gibt nichts weiter
  await A.evaluate(() => {
    const p = __dusk.camera.position
    __dusk.network.sendGadget('grapple', { x: p.x, y: p.y, z: p.z }, { x: p.x, y: p.y, z: p.z - 10 }, 0.6)
  })
  await wait(500)
  check('Zweiter Haken in der Abklingzeit wird nicht weitergegeben', (await B.evaluate(() => window.__hooks)) === 1)

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
