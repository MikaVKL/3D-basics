// Lehnen und Schüsse: Strahl und Mündungsfeuer starten genau am Lauf, wie er gezeichnet wird (die Kamera
// kippt beim Zeichnen, die Waffe kippt mit), und der Treffer-Strahl geht von der gelehnten Kamera aus.
//
//   node tests/lean-muzzle.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(700)
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement })
    window.__setup = (x, z) => {
      __dusk.player.spawn({ x, y: 1.7, z, clone() { return this } })
      __dusk.camera.rotation.set(0, 0, 0, 'YXZ')
      __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    }
    // Wie die Hauptschleife: Lehn-Wert an die Waffe, Kippen wie beim Zeichnen
    window.__measure = (leanDirection, weaponId) => {
      const P = __dusk.player, W = __dusk.weapon, C = __dusk.camera
      W.switchTo(weaponId)
      W.switchRemaining = 0
      for (let i = 0; i < 120; i++) W.update(1 / 60)
      W.ammo = W.getAmmoState().max
      window.__setup(-8, 8)
      P.setLean(leanDirection)
      for (let i = 0; i < 60; i++) P.update(1 / 60)
      W.leanAmount = P.lean
      C.updateMatrixWorld(true)
      // Strahl-Start, den tryShoot verwendet
      const starts = []
      const spawn = W.spawnTracer.bind(W)
      W.spawnTracer = (from, to, team, id) => { starts.push(from.clone()); spawn(from, to, team, id) }
      W.cooldownRemaining = 0
      const leanedPos = C.position.clone()
      W.tryShoot()
      W.spawnTracer = spawn
      // So, wie es gezeichnet würde: Kamera kippen, Matrizen aktualisieren, Lauf lesen
      const SLIDE = 0
      const roll = -P.lean * 0.21
      C.rotateZ(roll)
      C.updateMatrixWorld(true)
      const drawn = W.view.getMuzzleWorldPosition(C.position.clone())
      C.rotateZ(-roll)
      C.updateMatrixWorld(true)
      return { start: starts[0]?.toArray(), drawn: drawn.toArray(), cam: leanedPos.toArray(), lean: P.lean }
    }
  })
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const out = {}
  for (const [name, dir] of [['rechts', 1], ['links', -1], ['gerade', 0]]) {
    out[name] = {}
    for (const weaponId of ['pistol', 'rifle', 'sniper']) {
      const r = await page.evaluate(([dir, id]) => window.__measure(dir, id), [dir, weaponId])
      out[name][weaponId] = { lean: r.lean, abstand: +d(r.start, r.drawn).toFixed(3) }
    }
  }
  const worst = (name) => Math.max(...Object.values(out[name]).map((v) => v.abstand))
  check('Gerade: Strahl startet am gezeichneten Lauf (< 1 cm)', worst('gerade') < 0.01, JSON.stringify(out.gerade))
  check('Nach rechts gelehnt: Strahl startet am gezeichneten Lauf (< 1 cm)', worst('rechts') < 0.01 && Math.abs(out.rechts.pistol.lean - 1) < 1e-6, JSON.stringify(out.rechts))
  check('Nach links gelehnt: Strahl startet am gezeichneten Lauf (< 1 cm)', worst('links') < 0.01 && Math.abs(out.links.pistol.lean + 1) < 1e-6, JSON.stringify(out.links))
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
