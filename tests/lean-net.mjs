// Lehnen online: andere sehen die gelehnte Figur (Oberkörper schief, Kopf seitlich), der Kopf-
// Treffer-Kasten wandert mit, der Server begrenzt gefälschte Werte.
//
//   node tests/lean-net.mjs
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
  await wait(3800)
  await teleport(A, -8, 1.7, 8)
  await teleport(B, -8, 1.7, -2)
  // A schaut nach Norden (rechts = +x), B nach Süden
  await A.evaluate(() => {
    __dusk.camera.rotation.set(0, 0, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
  })
  await B.evaluate(() => {
    __dusk.camera.rotation.set(0, Math.PI, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
  })
  await wait(600)

  const avatarOf = (page) =>
    page.evaluate(() => {
      const entry = [...__dusk.remotePlayers.players.values()][0]
      const a = entry.avatar
      const head = a.headMesh.getWorldPosition(new a.root.position.constructor())
      return { rootX: a.root.position.x, headX: Number(head.x.toFixed(3)), headY: Number(head.y.toFixed(3)) }
    })
  const stateLean = (page) => page.evaluate(() => {
    const entry = [...__dusk.remotePlayers.players.values()][0]
    return Number(entry.samples.at(-1).state.lean.toFixed(2))
  })

  const straight = await avatarOf(B)
  check('Gerade: Kopf-Kasten mittig über dem Körper', Math.abs(straight.headX - straight.rootX) < 0.02, JSON.stringify(straight))

  // A lehnt nach rechts (E gehalten); B sieht es nach Netz + Interpolation
  await A.keyboard.press('KeyE')
  await A.evaluate(() => {
    const P = __dusk.player
    for (let t = 0; t < 0.5; t += 1 / 60) P.update(1 / 60)
  })
  await wait(900)
  const sent = await stateLean(B)
  check('B bekommt den Lehnwert 1 von A', sent === 1, String(sent))
  if (process.env.LEAN_SHOT) {
    await B.setViewportSize({ width: 900, height: 560 })
    await B.evaluate(() => { __dusk.camera.position.set(-8.5, 1.5, 3.5) })
    await wait(500)
    await B.screenshot({ path: `${process.env.LEAN_SHOT}/lean-right.png` })
    await B.setViewportSize({ width: 480, height: 270 })
    await teleport(B, -8, 1.7, -2)
  }
  const leaned = await avatarOf(B)
  check('Kopf-Kasten rückt etwa 0,45 m nach rechts (A\'s +x)', leaned.headX - leaned.rootX > 0.35 && leaned.headX - leaned.rootX < 0.55, JSON.stringify(leaned))
  check('Körperposition bleibt (Server/andere sehen A nicht verschoben)', Math.abs(leaned.rootX - -8) < 0.05, JSON.stringify(leaned))

  // Treffer-Kasten: ein Strahl auf die alte Kopfmitte geht jetzt vorbei, auf die neue trifft Kopf
  const rays = await B.evaluate(() => {
    const W = __dusk.weapon
    const entry = [...__dusk.remotePlayers.players.values()][0]
    const head = entry.avatar.headMesh.getWorldPosition(__dusk.camera.position.clone())
    const eye = __dusk.camera.position.clone()
    const shoot = (target) => {
      const dir = target.clone().sub(eye).normalize()
      const ray = new W.raycaster.constructor(eye, dir)
      const hit = ray.intersectObjects(__dusk.arena.shootables.concat(__dusk.remotePlayers.hitMeshes?.() ?? [...__dusk.remotePlayers.players.values()].flatMap((p) => [p.avatar.mesh, p.avatar.headMesh])), false)[0]
      return hit ? { head: Boolean(hit.object.userData.headshot), isPlayer: hit.object.userData.team !== undefined } : null
    }
    const oldHead = head.clone()
    oldHead.x = entry.avatar.root.position.x
    return { atLeanedHead: shoot(head), atOldHead: shoot(oldHead) }
  })
  check('Strahl auf den gelehnten Kopf: Kopftreffer', rays.atLeanedHead?.head === true, JSON.stringify(rays))
  check('Strahl auf die alte Kopfstelle: kein Kopftreffer mehr', rays.atOldHead?.head !== true, JSON.stringify(rays))

  // Loslassen: zurück
  await A.keyboard.press('KeyE')
  await A.evaluate(() => {
    const P = __dusk.player
    for (let t = 0; t < 0.5; t += 1 / 60) P.update(1 / 60)
  })
  await wait(900)
  const back = await avatarOf(B)
  check('Loslassen: Kopf wieder mittig', Math.abs(back.headX - back.rootX) < 0.03, JSON.stringify(back))

  // Q: nach links
  await A.keyboard.press('KeyQ')
  await A.evaluate(() => {
    const P = __dusk.player
    for (let t = 0; t < 0.5; t += 1 / 60) P.update(1 / 60)
  })
  await wait(900)
  const left = await avatarOf(B)
  check('Q: Kopf rückt nach links (-x)', left.headX - left.rootX < -0.35, JSON.stringify(left))
  await A.keyboard.press('KeyQ')
  await A.evaluate(() => {
    for (let t = 0; t < 0.5; t += 1 / 60) __dusk.player.update(1 / 60)
  })

  // Gefälschter Wert: Server begrenzt auf -1..1 (A schickt dauernd 99 zwischen den echten Zuständen)
  await B.evaluate(() => {
    window.__leans = []
    window.__poll = setInterval(() => {
      const entry = [...__dusk.remotePlayers.players.values()][0]
      for (const s of entry.samples) window.__leans.push(s.state.lean)
    }, 25)
  })
  await A.evaluate(() => {
    const n = __dusk.network
    window.__forge = setInterval(() => {
      n.socket.send(JSON.stringify({ t: 'state', state: { ...__dusk.player.getNetworkState(), lean: 99 }, time: Math.round(performance.now()), life: n.life }))
    }, 40)
  })
  await wait(1200)
  const seen = await B.evaluate(() => {
    clearInterval(window.__poll)
    return { max: Math.max(...window.__leans), min: Math.min(...window.__leans), n: window.__leans.length }
  })
  await A.evaluate(() => clearInterval(window.__forge))
  check('Gefälschter Lehnwert 99 kommt bei B höchstens als 1 an (und kam an)', seen.max === 1 && seen.min >= -1, JSON.stringify(seen))

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
