// Blendgranate: Auswahl im Menü, Wirkung nach Blickwinkel/Abstand/Sichtlinie, Ausblenden,
// Wurf per G (Knall-Ton), online sieht der andere den Wurf und wird geblendet.
//
//   node tests/flash.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, createChecks, pickOption } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })

  // Menü: Gadget-Karten, Wahl wird gemerkt
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.click('#start-button')
  // Auswahlfenster passt auch auf kleine Bildschirme (Laptop, Handy quer) ganz hinein
  for (const [w, h] of [[1280, 720], [1366, 640], [1024, 576], [844, 390], [667, 375]]) {
    await page.setViewportSize({ width: w, height: h })
    const fit = await page.evaluate(() => {
      const r = document.querySelector('#loadout-play-button').getBoundingClientRect()
      const c = document.querySelector('#loadout-gadget').getBoundingClientRect()
      return { bottom: Math.round(r.bottom), top: Math.round(c.top), innerHeight, right: Math.round(c.right), innerWidth }
    })
    check(`Auswahl passt in ${w}x${h} (Spielen-Knopf sichtbar)`, fit.bottom <= fit.innerHeight && fit.right <= fit.innerWidth, JSON.stringify(fit))
    await page.click('#loadout-primary .dropdown-trigger')
    const list = await page.evaluate(() => {
      const r = document.querySelector('#loadout-primary .dropdown-list').getBoundingClientRect()
      return { bottom: Math.round(r.bottom), innerHeight }
    })
    check(`Offene Liste liegt in ${w}x${h} im Bild`, list.bottom <= list.innerHeight, JSON.stringify(list))
    await page.click('#loadout-primary .dropdown-trigger')
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  const cards = await page.evaluate(() => ({
    ids: [...document.querySelectorAll('#loadout-gadget .gadget-card')].map((c) => c.dataset.gadget).join(),
    selected: document.querySelector('#loadout-gadget .gadget-card.selected')?.dataset.gadget,
    weaponSelected: document.querySelectorAll('.weapon-card.selected').length,
  }))
  check('Gadget-Auswahl: Rauch-, Blendgranate, Sprungpad, Standard Rauch; Waffenkarten unberührt', cards.ids === 'smoke,flash,jump' && cards.selected === 'smoke' && cards.weaponSelected === 2, JSON.stringify(cards))
  await pickOption(page, '.gadget-card[data-gadget="flash"]')
  check('Blendgranate gewählt und im Browser gemerkt', (await page.evaluate(() => localStorage.getItem('duskArena.gadget'))) === 'flash')
  await page.click('#loadout-play-button')
  await wait(500)
  await page.setViewportSize({ width: 480, height: 270 })
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement })
    window.__sounds = []
    const playAt = __dusk.sound.playAt.bind(__dusk.sound)
    __dusk.sound.playAt = (name, position, volume) => {
      window.__sounds.push('@' + name)
      playAt(name, position, volume)
    }
  })
  const ui = await page.evaluate(() => ({
    gadget: __dusk.gadgets.gadget,
    name: document.querySelector('#gadget-name').textContent,
    label: document.querySelector('#gadget-button').getAttribute('aria-label'),
  }))
  check('Im Spiel: Blendgranate, Anzeige und Button-Beschriftung folgen', ui.gadget === 'flash' && ui.name === 'Blendgranate' && ui.label === 'Blendgranate werfen', JSON.stringify(ui))

  // Rechenregel: nach Blickwinkel (Dauer und Stärke) und Abstand
  const rule = await page.evaluate(async () => {
    const { GADGETS, blindDuration, blindStrength } = await import('/3D-basics/src/shared/gadgets.ts')
    const s = GADGETS.flash
    const r = (d, a) => Number(blindDuration(s, d, a).toFixed(2))
    const q = (a) => Number(blindStrength(s, a).toFixed(2))
    return {
      front: r(1, 0), near15: r(1, 15), mid: r(10, 0), a30: r(1, 30), a45: r(1, 45), a60: r(1, 60), a90: r(1, 90), behind: r(1, 130), far: r(30, 0),
      s0: q(0), s15: q(15), s30: q(30), s45: q(45), s60: q(60), s70: q(70),
    }
  })
  check('Dauer: direkt davor ~2,9 s (auch bei 15° daneben), 10 m ~2,3 s', rule.front > 2.8 && rule.near15 === rule.front && rule.mid > 2.2 && rule.mid < rule.front, JSON.stringify(rule))
  check('Je mehr man hinsieht, desto länger: 30° ~1,6 s, 45° ~0,6 s, 60° kaum (< 0,2 s)', rule.a30 > 1.2 && rule.a30 < 2 && rule.a45 > 0.4 && rule.a45 < 0.8 && rule.a60 < 0.2 && rule.front > rule.a30 && rule.a30 > rule.a45 && rule.a45 > rule.a60, JSON.stringify(rule))
  check('Außerhalb des Bildes (90°, Rücken, zu weit): keine Wirkung', rule.a90 === 0 && rule.behind === 0 && rule.far === 0, JSON.stringify(rule))
  check('Stärke des Schleiers: direkt 1, 30° ~0,6, 45° ~0,4, 60° ~0,2, 70° 0', rule.s0 === 1 && rule.s15 === 1 && rule.s30 > 0.5 && rule.s30 < 0.8 && rule.s45 > 0.3 && rule.s45 < 0.5 && rule.s60 > 0.15 && rule.s60 < 0.3 && rule.s70 === 0, JSON.stringify(rule))

  // Wirkung im Spiel: Kamera direkt setzen und im selben evaluate knallen lassen
  const burst = (spec) =>
    page.evaluate((s) => {
      const G = __dusk.gadgets
      const cam = __dusk.camera
      G.reset()
      const V = cam.position.constructor
      cam.position.set(s.eye[0], s.eye[1], s.eye[2])
      cam.lookAt(new V(...s.look))
      cam.updateMatrixWorld(true)
      G.spawnBurst('flash', new V(...s.at))
      return { remaining: G.blindRemaining, level: G.blindLevel, opacity: Number(G.blindOpacity.toFixed(2)) }
    }, spec)

  const ahead = await burst({ eye: [-8, 1.7, 8], look: [-8, 1.7, 0], at: [-8, 0.5, 0] })
  check('Blick zum Knall (8 m): geblendet, volle Stärke', ahead.remaining > 2 && ahead.level === 1, JSON.stringify(ahead))
  await wait(250)
  check('Weißer Schleier liegt über dem Bild (direkt hingesehen: voll)', Number(await page.evaluate(() => getComputedStyle(document.querySelector('#flash-overlay')).opacity)) > 0.95)
  check('Knall-Ton', (await page.evaluate(() => window.__sounds)).includes('@flashBang'))
  const fade = await page.evaluate(() => {
    const G = __dusk.gadgets
    const levels = []
    const total = G.blindRemaining
    for (let i = 0; i < 6; i++) {
      G.update(total / 6)
      levels.push(Number(G.blindLevel.toFixed(2)))
    }
    return levels
  })
  check('Danach weiches Ausblenden bis 0', fade[0] === 1 && fade.at(-1) === 0 && fade.every((v, i) => i === 0 || v <= fade[i - 1]), fade.join())

  const away = await burst({ eye: [-8, 1.7, 8], look: [-8, 1.7, 16], at: [-8, 0.5, 0] })
  check('Knall im Rücken: nichts', away.remaining === 0, JSON.stringify(away))
  const far = await burst({ eye: [-8, 1.7, 20], look: [-8, 1.7, 0], at: [-8, 0.5, -8] })
  check('Zu weit weg (28 m): nichts', far.remaining === 0, JSON.stringify(far))
  // Schräg: Winkel 35° bei 8 m Tiefe (x-Versatz = tan(35°) * 8 = 5,6 m)
  const side = await burst({ eye: [-8, 1.7, 8], look: [-8, 1.7, 0], at: [-8 - 5.6, 0.5, 0] })
  check('Knall schräg im Bild (~35°): mittellang geblendet, Schleier nur teilweise', side.remaining > 0.5 && side.remaining < 1.4 && side.opacity > 0.4 && side.opacity < 0.85, JSON.stringify(side))
  const off = await burst({ eye: [-8, 1.7, 8], look: [-8, 1.7, 0], at: [-8 + 14, 0.5, 8 - 3] })
  check('Knall außerhalb des Bildes (~78°): kein Effekt', off.remaining === 0 && off.opacity === 0, JSON.stringify(off))
  const edge = await burst({ eye: [-8, 1.7, 8], look: [-8, 1.7, 0], at: [-8 + 13.9, 0.5, 0] })
  check('Knall am Bildrand (~60°): höchstens ein kurzer, schwacher Hauch', edge.remaining < 0.2 && edge.opacity < 0.3, JSON.stringify(edge))

  // Wand dazwischen
  const wall = await page.evaluate(() => {
    const G = __dusk.gadgets
    const cam = __dusk.camera
    const V = cam.position.constructor
    const thin = __dusk.arena.solids.filter((s) => s.kind === 'wall').map((s) => {
      const size = s.box.getSize(new V())
      return { s, size }
    }).find(({ size }) => size.y > 3 && ((size.x < 1.5 && size.z > 6) || (size.z < 1.5 && size.x > 6)) && s0(size))
    function s0() { return true }
    if (!thin) return null
    const c = thin.s.box.getCenter(new V())
    const alongX = thin.size.x < thin.size.z
    const off = (d) => (alongX ? [c.x + d, 1.7, c.z] : [c.x, 1.7, c.z + d])
    const open = (d) => (alongX ? [c.x + d, 0.5, c.z] : [c.x, 0.5, c.z + d])
    G.reset()
    cam.position.set(...off(-4))
    cam.lookAt(new V(...off(4)))
    cam.updateMatrixWorld(true)
    G.spawnBurst('flash', new V(...open(4)))
    const blocked = G.blindRemaining
    G.reset()
    G.spawnBurst('flash', new V(...open(-0.5 - 0.001 + 0)))
    return { blocked }
  })
  check('Wand zwischen Spieler und Knall schützt', wall && wall.blocked === 0, JSON.stringify(wall))

  // Wurf per G: Flug, dann Knall
  await page.evaluate(() => {
    __dusk.gadgets.reset()
    window.__sounds.length = 0
    __dusk.player.spawn({ x: -8, y: 1.7, z: 8, clone() { return this } })
    __dusk.camera.rotation.set(0, 0, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
  })
  await page.keyboard.press('KeyG')
  const cooldown = await page.evaluate(() => __dusk.gadgets.cooldownRemaining)
  check('Wurf: Abklingzeit 30 s', cooldown > 29.5 && cooldown <= 30, String(cooldown))
  await wait(3500)
  const sounds = await page.evaluate(() => window.__sounds)
  check('Knall nach dem Flug (genau einmal)', sounds.filter((s) => s === '@flashBang').length === 1, sounds.join())

  // Online: B sieht A's Wurf, A und B stehen so, dass B zum Knall blickt
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A)
  await play(B)
  await A.evaluate(() => localStorage.setItem('duskArena.gadget', 'flash'))
  await wait(3800)
  await A.evaluate(() => __dusk.gadgets.setGadget('flash'))
  await teleport(A, -8, 1.7, 8)
  await teleport(B, -8, 1.7, -10)
  await wait(400)
  // B blickt nach Süden (zu A / zum Knall), A wirft nach Norden
  await B.evaluate(() => {
    __dusk.camera.rotation.set(0, Math.PI, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
  })
  await A.evaluate(() => {
    __dusk.camera.rotation.set(0, 0, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    __dusk.throwGadget()
  })
  await wait(2600)
  const blinded = await B.evaluate(() => ({ remaining: __dusk.gadgets.blindRemaining, total: __dusk.gadgets.blindLevel }))
  check('Online: B sieht den Wurf und ist geblendet (blickt zum Knall)', blinded.remaining > 0, JSON.stringify(blinded))

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
