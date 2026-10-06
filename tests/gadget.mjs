// Rauchgranate (Taste G): Wurf, Flug, Wolke, Sichtsperre, Abklingzeit, Anzeige.
//
//   node tests/gadget.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(500)
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement })
    window.__sounds = []
    const play = __dusk.sound.play.bind(__dusk.sound)
    __dusk.sound.play = (name, volume) => {
      window.__sounds.push(name)
      play(name, volume)
    }
    const playAt = __dusk.sound.playAt.bind(__dusk.sound)
    __dusk.sound.playAt = (name, position, volume) => {
      window.__sounds.push('@' + name)
      playAt(name, position, volume)
    }
    // Spiel-Update anhalten, Zeit selbst steuern (Headless rendert zu langsam)
    const G = __dusk.gadgets
    window.__real = Object.getPrototypeOf(G).update.bind(G)
    G.update = () => {}
    window.__face = (yaw) => {
      __dusk.player.spawn({ x: -8, y: 1.7, z: 8, clone() { return this } })
      __dusk.camera.rotation.set(0, yaw, 0, 'YXZ')
      __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    }
    window.__step = (seconds) => {
      for (let t = 0; t < seconds; t += 1 / 60) window.__real(1 / 60)
    }
  })
  const hudText = () => page.evaluate(() => ({ status: document.querySelector('#gadget-status').textContent, ready: document.querySelector('#gadget-hud').classList.contains('ready') }))

  await page.evaluate(() => window.__face(0))
  await wait(300)
  const start = await page.evaluate(() => ({ ready: __dusk.gadgets.ready, cooldown: __dusk.gadgets.cooldownRemaining }))
  check('Am Anfang bereit, Anzeige "bereit"', start.ready && (await hudText()).status === 'bereit', JSON.stringify(start))

  // Wurf per Taste G
  await page.keyboard.press('KeyG')
  const thrown = await page.evaluate(() => ({ cooldown: __dusk.gadgets.cooldownRemaining, clouds: __dusk.gadgets.clouds.length, sounds: window.__sounds.slice() }))
  check('Taste G wirft: Abklingzeit 25 s, Wurf-Ton, noch keine Wolke', thrown.cooldown === 25 && thrown.clouds === 0 && thrown.sounds.includes('throw'), JSON.stringify(thrown))
  await wait(300)
  const hud = await hudText()
  check('Anzeige zeigt die Abklingzeit', !hud.ready && /^\d+ s$/.test(hud.status), JSON.stringify(hud))

  // Flug: nach der Flugzeit entsteht die Wolke am Landepunkt, mit Landeton
  await page.evaluate(() => window.__step(3.5))
  const landed = await page.evaluate(() => ({
    clouds: __dusk.gadgets.clouds.length,
    pos: __dusk.gadgets.clouds[0]?.group.position.toArray(),
    pop: window.__sounds.filter((s) => s === '@smokePop').length,
  }))
  check('Wolke entsteht nach dem Flug, genau ein Landeton', landed.clouds === 1 && landed.pop === 1, JSON.stringify(landed))
  check('Landepunkt liegt vor dem Werfer auf dem Boden (nach Norden, z < 8)', landed.pos && landed.pos[2] < 4 && landed.pos[1] < 0.5, JSON.stringify(landed.pos))

  // Zweiter Wurf wird durch die Abklingzeit gesperrt
  await page.keyboard.press('KeyG')
  check('Zweiter Wurf in der Abklingzeit: nichts', await page.evaluate(() => __dusk.gadgets.cooldownRemaining > 20 && __dusk.gadgets.clouds.length === 1))

  // Sichtsperre: Blick durch die Wolke trifft ihre Körper; Blick daneben nicht
  const sight = await page.evaluate(() => {
    const G = __dusk.gadgets
    const cloud = G.clouds[0]
    window.__step(1) // ausgewachsen
    const origin = cloud.group.position.clone().add({ x: 0, y: 1.3, z: 7, clone() { return this } })
    const THREE_Vector3 = cloud.group.position.constructor
    const from = new THREE_Vector3(cloud.group.position.x, 1.3, cloud.group.position.z + 7)
    const ray = new (__dusk.weapon.raycaster.constructor)()
    const meshes = [cloud.mesh]
    ray.set(from, new THREE_Vector3(0, 0, -1))
    const through = ray.intersectObjects(meshes, false).length
    ray.set(from.clone().setX(from.x + 9), new THREE_Vector3(0, 0, -1))
    const beside = ray.intersectObjects(meshes, false).length
    return { through, beside }
  })
  check('Wolke blockiert die Sicht: Strahl hindurch trifft sie, daneben nicht', sight.through > 0 && sight.beside === 0, JSON.stringify(sight))

  // Rauch aus Würfeln; mitten drin ist das Bild zu, draußen frei
  const look = await page.evaluate(() => {
    const G = __dusk.gadgets
    const cloud = G.clouds[0]
    const V = cloud.group.position.constructor
    const c = cloud.group.position
    const at = (x, y, z) => G.smokeDensity(new V(c.x + x, y, c.z + z))
    return {
      cubes: cloud.mesh.count,
      isBox: cloud.mesh.geometry.type,
      centre: Number(at(0, 1.5, 0).toFixed(2)),
      edge: Number(at(2.2, 1.5, 0).toFixed(2)),
      outside: Number(at(6, 1.5, 0).toFixed(2)),
    }
  })
  check('Rauch besteht aus 640 Würfeln', look.cubes === 640 && look.isBox === 'BoxGeometry', JSON.stringify(look))
  // Sichtdichte: waagerechte Strahlen durch die ausgewachsene Wolke auf Augenhöhe müssen (fast) immer einen Würfel treffen
  const seeThrough = await page.evaluate(() => {
    const G = __dusk.gadgets
    const cloud = G.clouds[0]
    const V = cloud.group.position.constructor
    const R = __dusk.weapon.raycaster.constructor
    cloud.group.updateMatrixWorld(true)
    const c = cloud.group.position
    const rad = cloud.radius
    let blocked = 0
    const n = 300
    for (let i = 0; i < n; i++) {
      const from = new V(c.x + (Math.random() * 2 - 1) * 0.6 * rad, 0.3 + Math.random() * 1.9, c.z + rad + 4)
      if (new R(from, new V(0, 0, -1), 0, rad * 2 + 8).intersectObject(cloud.mesh, false).length > 0) blocked++
    }
    return { radius: rad, blocked: blocked / n }
  })
  check('Rauch: Radius 5 m, Strahlen auf Augenhöhe zu >= 98 % geblockt', seeThrough.radius === 5 && seeThrough.blocked >= 0.98, JSON.stringify(seeThrough))
  check('Dichte: in der Mitte voll, am Rand dünner, außerhalb 0', look.centre > 0.95 && look.edge < look.centre && look.outside === 0, JSON.stringify(look))
  await page.evaluate(() => {
    const c = __dusk.gadgets.clouds[0].group.position
    __dusk.player.spawn({ x: c.x, y: 1.7, z: c.z, clone() { return this } })
  })
  await wait(500)
  const inside = Number(await page.evaluate(() => getComputedStyle(document.querySelector('#smoke-overlay')).opacity))
  check('Kamera im Rauch: grauer Schleier fast deckend', inside > 0.85, String(inside))
  await page.evaluate(() => window.__face(0))
  await wait(400)
  check('Wieder draußen: Schleier weg', Number(await page.evaluate(() => getComputedStyle(document.querySelector('#smoke-overlay')).opacity)) < 0.05)

  // Auflösen: außen zuerst und einzeln, nicht alles gleichzeitig in die Mitte
  const fade = await page.evaluate(() => {
    const G = __dusk.gadgets
    const cloud = G.clouds[0]
    const sizes = () => {
      const e = cloud.mesh.instanceMatrix.array
      const out = []
      for (let i = 0; i < cloud.cubes.length; i++) {
        const o = i * 16
        out.push({ s: Math.hypot(e[o], e[o + 1], e[o + 2]), r: Math.hypot(cloud.cubes[i].x, cloud.cubes[i].z) })
      }
      return out
    }
    const early = sizes()
    window.__step(6.5 - cloud.age) // Alter 6,5 s von 8
    const mid = sizes()
    const outer = mid.filter((c) => c.r > 2.2)
    const inner = mid.filter((c) => c.r < 1)
    const avg = (a) => a.reduce((x, c) => x + c.s, 0) / Math.max(1, a.length)
    return { age: cloud.age, outerGone: outer.filter((c) => c.s < 0.02).length / Math.max(1, outer.length), innerKept: inner.filter((c) => c.s > 0.2).length / Math.max(1, inner.length), outerAvg: avg(outer), innerAvg: avg(inner), startSizes: early.length }
  })
  check('Auflösen von außen: bei 6,5 s sind viele äußere Würfel weg, innere noch da', fade.outerGone > 0.3 && fade.innerKept > 0.7, JSON.stringify(fade))

  // Dauer: nach 8 s weg, nach 25 s wieder bereit
  await page.evaluate(() => window.__step(7.5))
  check('Wolke verschwindet nach 8 s', (await page.evaluate(() => __dusk.gadgets.clouds.length)) === 0)
  await page.evaluate(() => window.__step(15))
  const again = await page.evaluate(() => ({ ready: __dusk.gadgets.ready }))
  await wait(300)
  check('Nach 25 s wieder bereit (Anzeige "bereit")', again.ready && (await hudText()).status === 'bereit')

  // Wurf gegen eine nahe Wand: landet davor, nicht dahinter
  const wall = await page.evaluate(() => {
    __dusk.player.spawn({ x: -8, y: 1.7, z: -19, clone() { return this } })
    __dusk.camera.rotation.set(0, 0, 0, 'YXZ') // Blick nach Norden auf die Nordwand (z = -21)
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    __dusk.throwGadget()
    window.__step(3.5)
    return __dusk.gadgets.clouds[0].group.position.toArray()
  })
  check('Wurf gegen die Wand: prallt ab und fällt davor auf den Boden', wall[2] > -20.99 && wall[2] < -19 && wall[1] < 0.5, JSON.stringify(wall))

  // Tot: kein Wurf; Respawn: wieder bereit
  const dead = await page.evaluate(() => {
    window.__step(30)
    __dusk.player.takeDamage(999)
    const before = __dusk.gadgets.cooldownRemaining
    __dusk.throwGadget()
    return { before, after: __dusk.gadgets.cooldownRemaining }
  })
  check('Tot: kein Wurf', dead.before === 0 && dead.after === 0, JSON.stringify(dead))
  await page.evaluate(() => (window.__face(0), __dusk.player.spawn({ x: -8, y: 1.7, z: 8, clone() { return this } })))
  await wait(3800)
  await page.evaluate(() => __dusk.throwGadget())
  await wait(3800)
  // Nach dem Respawn ist die Granate wieder bereit
  const respawn = await page.evaluate(() => {
    __dusk.player.takeDamage(999)
    return __dusk.gadgets.cooldownRemaining
  })
  await page.waitForFunction(() => __dusk.player.isAlive, null, { timeout: 15000 })
  await wait(400)
  check('Nach dem Respawn wieder bereit (Abklingzeit zurückgesetzt)', respawn > 0 && (await page.evaluate(() => __dusk.gadgets.ready)), String(respawn))

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
