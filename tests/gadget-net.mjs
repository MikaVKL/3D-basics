// Rauchgranate online: andere sehen Wurf und Wolke am selben Ort, Server lehnt Wurf in der
// Abklingzeit, zu weite Ziele, falsche Startpunkte und Würfe Toter ab; neues Leben = wieder bereit.
//
//   node tests/gadget-net.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A)
  await play(B, { primary: 'sniper' })
  await wait(3800)
  await teleport(A, -8, 1.7, 8)
  await wait(300)
  await B.evaluate(() => {
    window.__throws = 0
    const playAt = __dusk.sound.playAt.bind(__dusk.sound)
    __dusk.sound.playAt = (name, position, volume) => {
      if (name === 'throw') window.__throws++
      playAt(name, position, volume)
    }
  })
  const clouds = (page) => page.evaluate(() => __dusk.gadgets.clouds.map((c) => c.position ?? c.group?.position).filter(Boolean).map((p) => ({ x: p.x, y: p.y, z: p.z })))

  // Echter Wurf von A
  const thrown = await A.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true }))
    return __dusk.gadgets.clouds.length
  })
  await wait(3500)
  const own = await clouds(A)
  const other = await clouds(B)
  check('B hört den Wurf und sieht eine Wolke', (await B.evaluate(() => window.__throws)) === 1 && other.length === 1, `${thrown} ${JSON.stringify(other)}`)
  const dist = own.length && other.length ? Math.hypot(own[0].x - other[0].x, own[0].z - other[0].z) : 99
  check('Wolke bei B am selben Ort wie bei A (< 0,5 m)', dist < 0.5, dist.toFixed(2))

  // Zweiter Wurf direkt danach: Server lehnt ab (Abklingzeit 25 s)
  await A.evaluate(() => {
    const p = __dusk.camera.position
    __dusk.network.sendGadget('smoke', { x: p.x, y: p.y, z: p.z }, { x: p.x + 5, y: 0, z: p.z }, 0.8)
  })
  await wait(600)
  check('Wurf in der Abklingzeit wird nicht weitergegeben', (await B.evaluate(() => window.__throws)) === 1)

  // Neues Leben: wieder bereit. B (Sniper) erledigt A mit einem Kopfschuss
  const killA = async () => {
    await B.keyboard.press('Digit2')
    await wait(700)
    await B.evaluate(() => __dusk.network.sendHit([...__dusk.network.remotePlayers][0], true))
    await wait(500)
  }
  await killA()
  await A.waitForFunction(() => __dusk.player.isAlive, null, { timeout: 15000 }).catch(() => {})
  await wait(500)
  await teleport(A, -8, 1.7, 8)
  await wait(400)
  const send = (from, to, flight) =>
    A.evaluate(([f, t, fl]) => __dusk.network.sendGadget('smoke', f, t, fl), [from, to, flight])
  const p = { x: -8, y: 1.7, z: 8 }
  await send(p, { x: p.x + 80, y: 0, z: p.z }, 1)
  await wait(400)
  check('Zu weites Ziel (80 m) wird abgelehnt', (await B.evaluate(() => window.__throws)) === 1)
  await send({ x: 30, y: 1.7, z: -10 }, { x: 32, y: 0, z: -10 }, 1)
  await wait(400)
  check('Startpunkt weit weg vom Spieler wird abgelehnt', (await B.evaluate(() => window.__throws)) === 1)
  await send(p, { x: p.x + 5, y: 0, z: p.z }, 30)
  await wait(400)
  check('Unmögliche Flugzeit (30 s) wird abgelehnt', (await B.evaluate(() => window.__throws)) === 1)
  await send(p, { x: p.x + 5, y: 0, z: p.z }, 0.8)
  await wait(500)
  check('Neues Leben: Wurf wieder erlaubt, B bekommt ihn', (await B.evaluate(() => window.__throws)) === 2)

  // Toter wirft nicht
  await wait(1500)
  await killA()
  const before = await B.evaluate(() => window.__throws)
  await send(p, { x: p.x + 5, y: 0, z: p.z }, 0.8)
  await wait(400)
  check('Wurf eines Toten wird abgelehnt', (await B.evaluate(() => window.__throws)) === before)

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
