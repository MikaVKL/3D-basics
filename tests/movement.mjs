// Gezielte Bewegungs-Abläufe (Singleplayer-Physik): Kisten erklettern, Rutschen, Bunny-Hop, Schwung.
// Karten-Wege (Rampen, Ring, Brücken, Turm) prüft tests/nexus.mjs.
//
//   node tests/movement.mjs
import { startServers, launchBrowser, openGame, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
try {
  const page = await openGame(browser, { online: false })
  const r = await page.evaluate(() => {
    const P = __dusk.player
    P.weapon = 'pistol' // Tempo-Messungen mit 100 % (Startwaffe ist jetzt das Sturmgewehr)
    const cam = __dusk.camera
    const DT = 1 / 60
    // Freie Bahn für Rutschen/Bunny-Hop: ab (-18, 10) 30 m nach Osten ohne Hindernis (Nexus, Bahn z = 10)
    const EAST = -Math.PI / 2
    const place = (x, z, yaw) => {
      const ground = P.groundHeightAt(x, z)
      P.spawn({ x, y: ground + 1.7, z, clone() { return this } })
      P.setCrouching(false)
      P.setSprinting(false)
      P.setMoveInput(0, 0)
      cam.rotation.set(0, yaw, 0, 'YXZ') // yaw 0 = Blick nach -z
    }
    const run = (frames, each) => {
      for (let f = 0; f < frames; f++) {
        each?.(f)
        P.update(DT)
      }
    }
    const out = {}

    // Kisten: 1.4 m bei (12, -5) erkletterbar, 2.4 m bei (21.5, -3.5) nicht
    place(12, -2, 0)
    P.setMoveInput(0, 1)
    run(12)
    P.jump()
    run(30)
    P.setMoveInput(0, 0)
    run(30)
    out.lowCrate = P.bodyY

    place(21.5, -8, Math.PI)
    P.setMoveInput(0, 1)
    run(20)
    P.jump()
    run(60)
    P.setMoveInput(0, 0)
    run(30)
    out.highCrate = P.bodyY

    // Rutschen: freie Bahn nach Osten
    const slideRun = (crouchFrame, sprint, releaseAt = Infinity) => {
      place(-18, 10, EAST)
      P.setSprinting(sprint)
      P.setMoveInput(0, 1)
      const startX = cam.position.x
      let maxSpeed = 0
      let slideFrames = 0
      let startedSlide = 0
      run(90, (f) => {
        if (f === crouchFrame) P.setCrouching(true)
        if (f === releaseAt) P.setCrouching(false)
        if (P.isSliding) {
          slideFrames++
          if (!startedSlide) startedSlide = f
        }
        maxSpeed = Math.max(maxSpeed, P.horizontalSpeed)
      })
      const res = { dist: cam.position.x - startX, maxSpeed, slideFrames, endSpeed: P.horizontalSpeed, eye: cam.position.y - P.bodyY }
      P.setCrouching(false)
      P.setSprinting(false)
      return res
    }
    out.slide = slideRun(20, true)
    out.sprintOnly = slideRun(Infinity, true)
    out.crouchWalk = slideRun(20, false)
    out.slideRelease = slideRun(20, true, 30)

    // Cooldown: sofort erneut ducken rutscht nicht gleich wieder
    place(-18, 10, EAST)
    P.setSprinting(true)
    P.setMoveInput(0, 1)
    let slides = 0
    let wasSliding = false
    run(120, (f) => {
      P.setCrouching(f >= 20 && f % 12 < 6)
      if (P.isSliding && !wasSliding) slides++
      wasSliding = P.isSliding
    })
    out.spamSlides = slides

    // Gegen die Säule bei (22, 10) rutschen (Fläche bei x = 21,4): Schwung verfällt, kein Durchrutschen
    place(14.5, 10, EAST)
    P.setSprinting(true)
    P.setMoveInput(0, 1)
    run(20)
    P.setCrouching(true)
    run(40)
    out.wallX = cam.position.x
    out.wallSpeed = P.horizontalSpeed
    P.setCrouching(false)

    // Bunny-Hop: Leertaste kurz vor der Landung (Puffer) bzw. zu spät.
    // Nach jeder Landung zurück auf die freie Fläche, Schwung bleibt.
    const hops = (count, { sprint = false, lateFrames = 0, crouchAtEnd = false } = {}) => {
      place(-18, 10, EAST)
      P.setSprinting(sprint)
      P.setMoveInput(0, 1)
      run(30)
      P.jump()
      const speeds = []
      let landings = 0
      let lateCounter = -1
      // Gepufferter Sprung hebt im selben Frame wieder ab -> über onLand zählen
      const onLand = P.onLand
      P.onLand = () => {
        landings++
        if (lateFrames) lateCounter = lateFrames
      }
      for (let f = 0; f < count * 80 && landings < count; f++) {
        if (landings === count - 1 && crouchAtEnd) P.setCrouching(true)
        if (!P.isOnGround && P.velocity.y < 0 && P.bodyY < 0.4 && !lateFrames && landings < count - 1) P.jump()
        const before = landings
        P.update(DT)
        if (landings > before) {
          speeds.push(P.horizontalSpeed)
          cam.position.x = -18
        }
        if (lateCounter > 0 && --lateCounter === 0 && landings < count) P.jump()
      }
      P.onLand = onLand
      run(5)
      const res = { speeds, sliding: P.isSliding }
      run(60)
      res.after = P.horizontalSpeed
      P.setCrouching(false)
      P.setSprinting(false)
      return res
    }
    out.walkHops = hops(7)
    out.sprintHops = hops(12, { sprint: true })
    out.lateHops = hops(4, { lateFrames: 15 })
    out.hopIntoSlide = hops(4, { sprint: true, crouchAtEnd: true })

    // Schwung in der Luft: Taste im Sprung loslassen, man fliegt weiter
    place(-18, 10, EAST)
    P.setSprinting(true)
    P.setMoveInput(0, 1)
    run(30)
    P.jump()
    run(2)
    P.setMoveInput(0, 0)
    P.setSprinting(false)
    const x0 = cam.position.x
    let airFrames = 0
    while (!P.isOnGround && airFrames < 120) {
      P.update(DT)
      airFrames++
    }
    out.airCarry = cam.position.x - x0
    run(30)
    out.stopAfterLanding = P.horizontalSpeed

    // Normales Gehen unverändert: sofort volles Tempo, sofort Stillstand
    place(-18, 10, EAST)
    P.setMoveInput(0, 1)
    run(1)
    out.walkStart = P.horizontalSpeed
    P.setMoveInput(0, 0)
    run(1)
    out.walkStop = P.horizontalSpeed

    // Sprint loslassen (Shift weiter gehalten): sofort stehen, kein Nachgleiten
    // (Bug: Sprint-Tempo galt als Schwung, man glitt bis 4,5 m weiter)
    const coast = (sprintFrames) => {
      place(-18, 10, EAST)
      P.setSprinting(true)
      P.setMoveInput(0, 1)
      run(sprintFrames)
      P.setMoveInput(0, 0)
      const x0 = cam.position.x
      run(60)
      P.setSprinting(false)
      return cam.position.x - x0
    }
    out.coastTap = coast(6)
    out.coastSprint = coast(60)

    // Aus dem Rutschen springen: Tempo des Rutschens bleibt in der Luft
    place(-18, 10, EAST)
    P.setSprinting(true)
    P.setMoveInput(0, 1)
    run(20)
    P.setCrouching(true)
    run(3)
    const slideSpeed = P.horizontalSpeed
    P.jump()
    run(20)
    out.slideJump = { slideSpeed, air: P.horizontalSpeed, onGround: P.isOnGround }
    P.setCrouching(false)
    P.setSprinting(false)
    run(60)
    return out
  })

  check('auf 1.4m-Kiste springen klappt', Math.abs(r.lowCrate - 1.4) < 0.01, `Höhe ${r.lowCrate.toFixed(2)}`)
  check('auf 2.4m-Kiste springen klappt nicht', r.highCrate < 0.01, `Höhe ${r.highCrate.toFixed(2)}`)
  const f = (n) => n.toFixed(2)
  check('Rutschen startet aus dem Sprint', r.slide.slideFrames > 20, `${r.slide.slideFrames} Frames, max ${f(r.slide.maxSpeed)} m/s`)
  check('Rutschen schneller als Sprint', r.slide.maxSpeed > r.sprintOnly.maxSpeed * 1.2, `${f(r.slide.maxSpeed)} vs ${f(r.sprintOnly.maxSpeed)} m/s`)
  check('Rutschen weiter als Ducken ohne Rutschen', r.slide.dist > r.crouchWalk.dist + 2, `${f(r.slide.dist)} vs ${f(r.crouchWalk.dist)} m`)
  check('Rutschen läuft aus (Duck-Tempo)', r.slide.slideFrames < 70 && r.slide.endSpeed < 4, `Ende ${f(r.slide.endSpeed)} m/s`)
  check('beim Rutschen geduckt', Math.abs(r.slide.eye - 1.0) < 0.01, `Augenhöhe ${f(r.slide.eye)}`)
  check('ohne Sprint kein Rutschen', r.crouchWalk.slideFrames === 0)
  check('Loslassen beendet Rutschen', r.slideRelease.slideFrames === 10, `${r.slideRelease.slideFrames} Frames`)
  check('Duck-Spam: Abklingzeit', r.spamSlides <= 2, `${r.spamSlides} Rutscher in 1,7 s`)
  check('Rutschen gegen die Säule: bleibt davor, Schwung weg', r.wallX < 21.4 && r.wallSpeed < 0.01, `x ${f(r.wallX)}, ${f(r.wallSpeed)} m/s`)
  const sp = (list) => list.map(f).join(' ')
  const walkLast = r.walkHops.speeds.at(-2)
  // +5 % pro getimtem Hop
  const hopGain = r.walkHops.speeds[1] / r.walkHops.speeds[0]
  check('Bunny-Hop: getimte Sprünge +5 %', walkLast > 6 * 1.2 && Math.abs(hopGain - 1.05) < 0.005, `${sp(r.walkHops.speeds)} (x${hopGain.toFixed(3)})`)
  check('Bunny-Hop: Deckel bei 12 m/s', Math.max(...r.sprintHops.speeds) <= 12.001 && Math.max(...r.sprintHops.speeds) > 11.9, sp(r.sprintHops.speeds))
  check('Bunny-Hop: nach letzter Landung wieder Lauftempo', Math.abs(r.walkHops.after - 6) < 0.01, `${f(r.walkHops.after)} m/s`)
  check('zu spät gesprungen: kein Zuwachs', Math.max(...r.lateHops.speeds) <= 6.001, sp(r.lateHops.speeds))
  check('Hop mit Ducken landen: rutscht weiter', r.hopIntoSlide.sliding)
  check('Schwung bleibt in der Luft (Taste losgelassen)', r.airCarry > 5, `${f(r.airCarry)} m geflogen`)
  check('nach der Landung ohne Eingabe Stillstand', r.stopAfterLanding < 0.01, `${f(r.stopAfterLanding)} m/s`)
  check('Sprint loslassen: kein Nachgleiten', r.coastTap < 0.01 && r.coastSprint < 0.01, `nach Tippen ${f(r.coastTap)} m, nach 1 s ${f(r.coastSprint)} m`)
  check('normales Gehen unverändert (sofort 6 m/s, sofort 0)', Math.abs(r.walkStart - 6) < 0.01 && r.walkStop === 0, `${f(r.walkStart)} / ${f(r.walkStop)}`)
  check('Sprung aus dem Rutschen behält Tempo', !r.slideJump.onGround && r.slideJump.air > 10.5, `${f(r.slideJump.slideSpeed)} -> ${f(r.slideJump.air)} m/s`)
} finally {
  await browser.close()
  servers.stop()
  finish()
}
