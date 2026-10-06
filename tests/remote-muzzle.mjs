// Schüsse anderer Spieler: Strahl und Mündungsfeuer starten am Lauf der Waffe, die man an der Figur sieht
// (nicht an der Ego-Mündung des Schützen); das Laufende sitzt bei jedem Modell an der Vorderkante.
//
//   node tests/remote-muzzle.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, shootAt, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A)
  await play(B)
  await wait(3800)
  await teleport(A, -8, 1.7, 8)
  await teleport(B, -8, 1.7, -2)
  await A.evaluate(() => {
    __dusk.camera.rotation.set(0, 0, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
  })
  await wait(600)

  // 1) Laufende je Modell: Mündung an der Vorderkante der Waffenteile (Figur-Koordinaten)
  const tips = await B.evaluate(() => {
    const avatar = [...__dusk.remotePlayers.players.values()][0].avatar
    const out = {}
    for (const id of ['pistol', 'rifle', 'shotgun', 'sniper', 'heavyPistol', 'smg']) {
      avatar.setWeapon(id)
      avatar.root.updateMatrixWorld(true)
      const group = avatar.weaponModels[id]
      const inv = avatar.root.matrixWorld.clone().invert()
      let minZ = Infinity
      group.traverse((o) => {
        if (!o.isMesh) return
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
        const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv)
        minZ = Math.min(minZ, b.min.z)
      })
      const m = avatar.getMuzzleWorldPosition(group.position.clone())
      const local = m.applyMatrix4(inv)
      out[id] = { tip: +minZ.toFixed(3), muzzle: +local.z.toFixed(3) }
    }
    avatar.setWeapon('pistol')
    return out
  })
  const worst = Math.max(...Object.values(tips).map((t) => Math.abs(t.tip - t.muzzle)))
  check('Laufende: Mündung sitzt bei jedem der 6 Modelle an der Vorderkante (Abweichung < 3 cm)', worst < 0.03, JSON.stringify(tips))

  // 2) Echter Schuss von A: B zeichnet den Strahl ab dem Lauf der Figur, nicht ab A's Ego-Mündung
  await B.evaluate(() => {
    window.__tracers = []
    const w = __dusk.weapon
    const orig = w.showRemoteTracer.bind(w)
    w.showRemoteTracer = (from, to, team, weapon) => {
      const avatar = [...__dusk.remotePlayers.players.values()][0].avatar
      const muzzle = avatar.getMuzzleWorldPosition(from.clone())
      window.__tracers.push({ from: from.toArray(), muzzle: muzzle?.toArray() ?? null, to: to.toArray() })
      orig(from, to, team, weapon)
    }
  })
  await A.evaluate(() => {
    window.__sent = []
    const send = __dusk.network.sendShot.bind(__dusk.network)
    __dusk.network.sendShot = (from, to, hit) => {
      window.__sent.push(from.toArray())
      send(from, to, hit)
    }
  })
  await shootAt(A, [-8, 1.0, -10])
  await wait(900)
  const got = await B.evaluate(() => window.__tracers)
  const sent = await A.evaluate(() => window.__sent)
  check('B bekommt den Schuss', got.length === 1 && sent.length === 1, JSON.stringify({ got: got.length, sent: sent.length }))
  if (got.length && sent.length) {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    const t = got[0]
    check('Strahl startet am Lauf der Figur (< 15 cm vom Laufende)', t.muzzle && d(t.from, t.muzzle) < 0.15, JSON.stringify({ abstand: t.muzzle ? +d(t.from, t.muzzle).toFixed(3) : null }))
    check('... und nicht an A\'s Ego-Mündung (> 10 cm davon entfernt)', d(t.from, sent[0]) > 0.1, JSON.stringify({ abstandZurEgoMuendung: +d(t.from, sent[0]).toFixed(3) }))
  }
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
