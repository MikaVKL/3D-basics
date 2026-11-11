// Schwinghaken (Prototyp, nur Testkarte ?map=skyline): Pendel am Seil, Schwung bleibt beim Loslassen, Landung und
// Sprung in der Luft lösen das Seil, keine Abklingzeit, Tempo gedeckelt, kein Fehlalarm der Server-Bewegungsprüfung.
//
//   node tests/swing.mjs
import { startServers, launchBrowser, GAME_URL, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${GAME_URL}?map=skyline`)
  await page.waitForFunction(() => 'undefined' !== typeof window.__dusk)
  await play(page)
  await wait(800)
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement })
    const G = __dusk.gadgets
    G.update = () => {}
    window.__setup = (x, z, yaw = 0, pitch = 0, feet = 0) => {
      __dusk.player.spawn({ x, y: feet + 1.7, z, clone() { return this } })
      __dusk.player.bodyY = feet
      __dusk.camera.rotation.set(pitch, yaw, 0, 'YXZ')
      __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    }
    window.__V = (x, y, z) => ({ x, y, z, clone() { return this } })
  })
  const V = (x, y, z) => [x, y, z]

  // Auswahl: Prototyp im Bewegungs-Platz nur auf der Testkarte
  const picker = await page.evaluate(() => [...document.querySelectorAll('#loadout-gadget-move .gadget-card')].map((c) => c.dataset.gadget).join())
  check('Bewegungs-Auswahl auf der Testkarte: Sprungpad, Enterhaken, Schwinghaken', picker === 'jump,grapple,swing', picker)

  // Pendel im freien Raum (Skyline hat unter den Dächern keinen Boden): Anker 8 m seitlich, 5 m höher
  const pendulum = await page.evaluate(() => {
    const P = __dusk.player
    __setup(0, 0, 0, 0, 60) // Körpermitte (0, 61, 0)
    const anchor = new (__dusk.camera.position.constructor)(8, 66, 0)
    P.startSwing(anchor)
    const length = Math.hypot(8, 5)
    let maxDistance = 0, maxSpeed = 0, minY = 1e9, maxX = -1e9, releaseAt = null
    for (let f = 0; f < 60 * 3; f++) {
      P.update(1 / 60)
      const c = __dusk.camera.position
      const centreY = P.feetHeight + 1
      maxDistance = Math.max(maxDistance, Math.hypot(c.x - 8, centreY - 66, c.z))
      minY = Math.min(minY, centreY)
      maxX = Math.max(maxX, c.x)
    }
    return { length, maxDistance, minY, maxX, still: P.isSwinging }
  })
  check('Pendel: Abstand zum Anker bleibt höchstens die Seillänge (+0,15 m)', pendulum.maxDistance <= pendulum.length + 0.15, JSON.stringify(pendulum))
  check('Pendel: tiefster Punkt unter dem Anker (Seillänge), schwingt auf die andere Seite', Math.abs(pendulum.minY - (66 - pendulum.length)) < 0.5 && pendulum.maxX > 14, JSON.stringify(pendulum))
  check('Seil bleibt, solange man in der Luft schwingt', pendulum.still)

  // Loslassen: der Schwung bleibt (waagerecht nach dem Loslassen fast gleich)
  const release = await page.evaluate(() => {
    const P = __dusk.player
    __setup(0, 0, 0, 0, 60)
    P.startSwing(new (__dusk.camera.position.constructor)(8, 66, 0))
    for (let f = 0; f < 50; f++) P.update(1 / 60)
    const before = { x: __dusk.camera.position.x }
    for (let f = 0; f < 2; f++) P.update(1 / 60)
    const x0 = __dusk.camera.position.x
    P.update(1 / 60)
    const speedSwing = (__dusk.camera.position.x - x0) * 60
    P.releaseSwing()
    const x1 = __dusk.camera.position.x
    P.update(1 / 60)
    const speedAfter = (__dusk.camera.position.x - x1) * 60
    return { released: !P.isSwinging, speedSwing, speedAfter }
  })
  check('Loslassen: Seil weg, waagerechter Schwung bleibt (±8 %)', release.released && release.speedSwing > 5 && Math.abs(release.speedAfter - release.speedSwing) / release.speedSwing < 0.08, JSON.stringify(release))

  // Sprung in der Luft löst das Seil; auf dem Boden springt man normal und bleibt eingehängt
  const jumpAir = await page.evaluate(() => {
    const P = __dusk.player
    __setup(0, 0, 0, 0, 60)
    P.startSwing(new (__dusk.camera.position.constructor)(8, 66, 0))
    for (let f = 0; f < 20; f++) P.update(1 / 60)
    const before = P.isSwinging
    P.jump()
    return { before, after: P.isSwinging }
  })
  check('Sprung in der Luft löst das Seil', jumpAir.before && !jumpAir.after, JSON.stringify(jumpAir))
  const landing = await page.evaluate(() => {
    const P = __dusk.player
    __setup(-20, 0, 0, 0, 18) // Dach A
    P.update(1 / 60) // erst auf dem Dach aufsetzen lassen (onGround)
    P.startSwing(new (__dusk.camera.position.constructor)(-20, 30, 0))
    const atStart = P.isSwinging
    P.jump() // vom Boden aus: normaler Sprung
    for (let f = 0; f < 6; f++) P.update(1 / 60)
    const midAir = P.isSwinging
    for (let f = 0; f < 120; f++) P.update(1 / 60)
    return { atStart, midAir, end: P.isSwinging, feet: P.feetHeight }
  })
  check('Sprung vom Boden bleibt eingehängt, die Landung löst das Seil', landing.atStart && landing.midAir && !landing.end && Math.abs(landing.feet - 18) < 0.05, JSON.stringify(landing))

  // Tempo-Deckel: tiefes Pendel (20 m Fall) überschreitet 15 m/s waagerecht nicht, Steigen höchstens 9 m/s
  const cap = await page.evaluate(() => {
    const P = __dusk.player
    __setup(0, 0, 0, 0, 60)
    P.startSwing(new (__dusk.camera.position.constructor)(20, 61, 0))
    let maxH = 0, maxUp = 0, prev = { x: __dusk.camera.position.x, z: __dusk.camera.position.z, y: P.feetHeight }
    for (let f = 0; f < 60 * 4; f++) {
      P.update(1 / 60)
      const c = __dusk.camera.position
      maxH = Math.max(maxH, Math.hypot(c.x - prev.x, c.z - prev.z) * 60)
      maxUp = Math.max(maxUp, (P.feetHeight - prev.y) * 60)
      prev = { x: c.x, z: c.z, y: P.feetHeight }
    }
    return { maxH: +maxH.toFixed(2), maxUp: +maxUp.toFixed(2) }
  })
  check('Tempo gedeckelt: waagerecht höchstens ~14,5 m/s, nach oben höchstens ~9 m/s', cap.maxH <= 14.8 && cap.maxUp <= 9.6, JSON.stringify(cap))

  // Haken zielen: Wand in Reichweite = Anker; Himmel = kein Ziel; sofort wieder möglich (keine Abklingzeit)
  const aim = await page.evaluate(() => {
    const G = __dusk.gadgets
    __setup(-22, -3, Math.PI / 2, 0, 12) // Halle A, Blick nach Westen zur Wand
    const a1 = G.trySwing(__dusk.camera)
    const a2 = G.trySwing(__dusk.camera)
    __setup(-20, 0, 0, Math.PI / 2 - 0.01, 18) // Dach A, Blick steil nach oben: nichts in Reichweite
    const sky = G.trySwing(__dusk.camera)
    return { a1: a1 && a1.x, a2: !!a2, sky: sky === null, reason: G.rejectReason, ready: G.cooldowns.move.remaining }
  })
  check('Zielen: Wand = Anker (x ≈ -29,2), zweiter Wurf sofort möglich, Himmel = kein Ziel', aim.a1 < -28.5 && aim.a2 && aim.sky && aim.reason === 'Kein Ziel in Reichweite' && aim.ready === 0, JSON.stringify(aim))

  // Server-Bewegungsprüfung: ein langes Pendeln zwischen den Hochhäusern erzeugt keinen Fehlalarm
  const rules = await page.evaluate(async () => {
    const { createMovementCheck, checkMovement } = await import('/3D-basics/src/shared/movementRules.ts')
    const P = __dusk.player
    let bad = 0, states = 0
    for (const [ax, ay, az] of [[8, 66, 0], [20, 61, 0], [-6, 75, 4], [12, 90, -6]]) {
      __setup(0, 0, 0, 0, 60)
      const check = createMovementCheck({ x: 0, y: 61.7, z: 0 }, 0, 0)
      P.startSwing(new (__dusk.camera.position.constructor)(ax, ay, az))
      let now = 0
      for (let f = 0; f < 60 * 5; f++) {
        P.update(1 / 60)
        if (f % 3 === 0) {
          now += 50
          states++
          const p = __dusk.camera.position
          if (!checkMovement(check, { x: p.x, y: p.y, z: p.z }, now)) bad++
        }
      }
    }
    return { states, bad }
  })
  check('Server-Bewegungsprüfung: Schwingen ohne Fehlalarm', rules.states > 300 && rules.bad === 0, JSON.stringify(rules))
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
