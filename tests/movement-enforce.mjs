// Bewegungsprüfung im Spiel (Server MOVEMENT_CHECK=enforce): normales Spiel
// bleibt unberührt, ein Teleport wird zurückgesetzt und für andere nicht
// sichtbar, wiederholtes Teleportieren wirft zurück ins Menü.
//
//   node tests/movement-enforce.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const browser = await launchBrowser()
const errors = []
const servers = await startServers({ serverEnv: { MOVEMENT_CHECK: process.env.MOVEMENT_CHECK_TEST ?? 'enforce' } })
try {
  const a = await openGame(browser, { name: 'Ada', errors })
  const b = await openGame(browser, { name: 'Bob', errors })
  await play(a)
  await play(b)
  await wait(3000)

  let corrections = 0
  // Bereits offene Verbindung: Frames über CDP mitzählen
  const cdp = await a.context().newCDPSession(a)
  await cdp.send('Network.enable')
  cdp.on('Network.webSocketFrameReceived', (e) => { if (String(e.response.payloadData).includes('"t":"correct"')) corrections++ })

  const position = (page) => page.evaluate(() => {
    const p = __dusk.camera.position
    return { x: p.x, z: p.z }
  })

  // 1) Normales Spiel: laufen, rutschen, springen - keine Korrektur
  // (kein Teleport zur Bahn: der Server wählt den Spawn zufällig, und ein
  // Sprung quer durch die Arena wäre genau das, was er sperrt)
  await a.evaluate(() => {
    __dusk.player.setMoveInput(0, 1)
    __dusk.player.setSprinting(true)
  })
  await wait(700)
  await a.evaluate(() => __dusk.player.setCrouching(true))
  await wait(700)
  await a.evaluate(() => { __dusk.player.setCrouching(false); __dusk.player.jump() })
  await wait(1500)
  await a.evaluate(() => { __dusk.player.setMoveInput(0, 0); __dusk.player.setSprinting(false) })
  check('normales Spiel: keine Korrektur', corrections === 0, `${corrections} Korrekturen`)

  // 2) Teleport 30 m: zurückgesetzt, für Bob nie an der Fake-Stelle
  await wait(500)
  const before = await position(a)
  const fake = { x: before.x > 0 ? before.x - 30 : before.x + 30, z: before.z }
  await a.evaluate((f) => __dusk.player.spawn({ x: f.x, y: 1.7, z: f.z, clone() { return this } }), fake)
  let bobSawFake = false
  for (let i = 0; i < 8; i++) {
    await wait(150)
    const seen = await b.evaluate(() => {
      const [remote] = __dusk.remotePlayers.players.values()
      return remote ? remote.avatar.root.position.x : null
    })
    if (seen !== null && Math.abs(seen - fake.x) < 5) bobSawFake = true
  }
  const after = await position(a)
  check('Teleport: Server setzt zurück (correct empfangen)', corrections >= 1, `${corrections} Korrekturen`)
  check('Teleport: Spieler wieder nahe der alten Stelle', Math.abs(after.x - before.x) < 8, `vorher x ${before.x.toFixed(1)}, jetzt x ${after.x.toFixed(1)}`)
  check('Teleport: andere sehen den Spieler nie an der Fake-Stelle', !bobSawFake)

  // 3) Dauerhaftes Teleportieren: Rauswurf ins Menü
  for (let i = 0; i < 14; i++) {
    await a.evaluate(() => {
      const p = __dusk.camera.position
      __dusk.player.spawn({ x: p.x > 0 ? p.x - 35 : p.x + 35, y: 1.7, z: p.z, clone() { return this } })
    })
    await wait(300)
  }
  await wait(800)
  const kicked = await a.evaluate(() => ({
    notice: document.querySelector('#overlay-notice')?.textContent ?? '',
    status: __dusk.network.status,
  }))
  check('wiederholter Teleport: zurück zum Startbildschirm', kicked.notice.includes('Ungültige Bewegung'), kicked.notice)
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
