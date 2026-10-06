// Dicht vor einer Wand/Kiste: steckt die Waffenmündung im Hindernis, schlägt der Schuss dort ein,
// statt vom Fadenkreuz aus daran vorbei durch die Wand zu gehen.
//
//   node tests/wall-close.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(800)
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement })
    const A = __dusk.arena
    const V = __dusk.camera.position.constructor
    const R = __dusk.weapon.raycaster.constructor
    // Passende Kante suchen: Hindernis, an dessen rechter Kante (von hinten gesehen) man 5 cm daneben steht
    const spots = []
    for (const s of A.solids) {
      const b = s.box
      if (b.max.y < 2 || b.min.y > 1 || b.max.z - b.min.z < 1.0) continue
      const cam = new V(b.max.x + 0.05, 1.7, b.min.z - 0.31)
      const inAny = A.solids.some((q) => q.box.min.x - 0.3 < cam.x && cam.x < q.box.max.x + 0.3 && q.box.min.z - 0.3 < cam.z && cam.z < q.box.max.z + 0.3 && q.box.min.y < 1.7 && q.box.max.y > 0.5)
      if (inAny) continue
      // Fadenkreuz-Strahl (+z) geht frei an der Kante vorbei
      const free = !new R(cam, new V(0, 0, 1), 0, 6).intersectObjects(A.shootables, false).some((h) => h.object.visible)
      if (free) spots.push({ cam, box: b })
    }
    window.__spots = spots
    window.__shoot = (spot, weaponId) => {
      const W = __dusk.weapon
      W.switchTo(weaponId)
      W.switchRemaining = 0
      for (let i = 0; i < 120; i++) W.update(1 / 60)
      W.ammo = W.getAmmoState().max
      __dusk.player.spawn({ x: spot.cam.x, y: 1.7, z: spot.cam.z, clone() { return this } })
      __dusk.camera.rotation.set(0, Math.PI, 0, 'YXZ') // Blick nach +z
      __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
      __dusk.camera.updateMatrixWorld(true)
      const shots = []
      const old = W.onShot
      W.onShot = (from, to, hit) => shots.push({ length: from.distanceTo(to), hit, toZ: to.z })
      W.cooldownRemaining = 0
      W.tryShoot()
      W.onShot = old
      return shots
    }
  })
  const count = await page.evaluate(() => window.__spots.length)
  check('Testkanten gefunden', count > 0, String(count))

  const result = await page.evaluate(() => {
    const spot = window.__spots[0]
    const crossFree = true
    const out = { box: [spot.box.min.toArray(), spot.box.max.toArray()].map((v) => v.map((n) => +n.toFixed(2))) }
    out.pistol = window.__shoot(spot, 'pistol')
    out.rifle = window.__shoot(spot, 'rifle')
    out.shotgun = window.__shoot(spot, 'shotgun')
    return { ...out, crossFree }
  })
  check('Pistole: Schuss schlägt in der Wand ein (kurzer Strahl, Treffer)', result.pistol.length === 1 && result.pistol[0].hit && result.pistol[0].length < 1.2, JSON.stringify(result.pistol))
  check('Sturmgewehr: ebenso', result.rifle.length === 1 && result.rifle[0].hit && result.rifle[0].length < 1.2, JSON.stringify(result.rifle))
  check('Shotgun: ebenso (nicht durch die Wand)', result.shotgun.length === 1 && result.shotgun[0].hit && result.shotgun[0].length < 1.2, JSON.stringify(result.shotgun))

  // Gegenproben: im Freien bleibt der Schuss unverändert lang, geradeaus gegen die Wand trifft sie wie vorher
  const control = await page.evaluate(() => {
    const W = __dusk.weapon
    W.switchTo('pistol')
    W.switchRemaining = 0
    for (let i = 0; i < 120; i++) W.update(1 / 60)
    W.ammo = 12
    __dusk.player.spawn({ x: -8, y: 1.7, z: 8, clone() { return this } })
    __dusk.camera.rotation.set(0, 0, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    __dusk.camera.updateMatrixWorld(true)
    const shots = []
    const old = W.onShot
    W.onShot = (from, to, hit) => shots.push({ length: from.distanceTo(to), hit })
    W.cooldownRemaining = 0
    W.tryShoot()
    W.onShot = old
    return shots
  })
  check('Im Freien: Schuss geht normal weit (> 5 m)', control.length === 1 && control[0].length > 5, JSON.stringify(control))
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
