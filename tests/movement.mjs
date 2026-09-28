// Gezielte Bewegungs-Abläufe (Singleplayer-Physik): Kisten erklettern,
// Rampen, Fenster-Duck-Sprung, erhöhter Durchgang.
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
    const cam = __dusk.camera
    const DT = 1 / 60
    // Freie Bahn für Rutschen/Bunny-Hop: ab z=4 gut 16 m Richtung Süden ohne Hindernis
    const LANE_X = -8
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

    // Kisten: 1.4m bei (19,-8) erkletterbar, 2.4m bei (3,-9) nicht
    place(19, -5, 0)
    P.setMoveInput(0, 1)
    run(12)
    P.jump()
    run(30)
    P.setMoveInput(0, 0)
    run(30)
    out.lowCrate = P.bodyY

    place(3, -6, 0)
    P.setMoveInput(0, 1)
    run(8)
    P.jump()
    run(60)
    P.setMoveInput(0, 0)
    run(30)
    out.highCrate = P.bodyY

    // Rampe A: steigt von x=2 bis 12 nach +x auf die Hauptplattform (2.8m)
    place(0, 0, -Math.PI / 2)
    P.setMoveInput(0, 1)
    let maxRise = 0
    let previous = P.bodyY
    run(150, () => {
      maxRise = Math.max(maxRise, P.bodyY - previous)
      previous = P.bodyY
    })
    out.rampTop = P.bodyY
    out.rampMaxRise = maxRise
    cam.rotation.set(0, Math.PI / 2, 0, 'YXZ')
    run(150)
    out.rampDown = P.bodyY

    // Rampe B (West-Plattform, 2.4m) hoch, dann durch den erhöhten
    // Durchgang in der Trennwand (x=-20) in den Hauptraum
    place(-22, 1.5, Math.PI)
    P.setMoveInput(0, 1)
    out.rampBTop = 0
    run(300, () => {
      out.rampBTop = Math.max(out.rampBTop, P.bodyY)
      if (cam.position.z >= 14) P.setMoveInput(0, 0)
    })
    cam.rotation.set(0, -Math.PI / 2, 0, 'YXZ')
    P.setMoveInput(0, 1)
    run(90)
    P.setMoveInput(0, 0)
    run(60)
    out.throughDoorwayX = cam.position.x

    // Fenster-Deckungswand bei z=-15: per Duck-Sprung durchkletterbar
    // (gewollt), stehend nicht
    const windowAttempt = (crouch) => {
      for (let start = -12; start >= -14; start -= 0.1) {
        place(9, start, 0)
        P.setCrouching(crouch)
        P.setMoveInput(0, 1)
        run(10)
        P.jump()
        run(180)
        P.setMoveInput(0, 0)
        P.setCrouching(false)
        run(60)
        if (cam.position.z < -15.6) return true
      }
      return false
    }
    out.windowCrouch = windowAttempt(true)
    out.windowStanding = windowAttempt(false)

    // Rutschen: offene Fläche im Süden, Blick nach +z (yaw PI)
    const slideRun = (crouchFrame, sprint, releaseAt = Infinity) => {
      place(LANE_X, 4, Math.PI)
      P.setSprinting(sprint)
      P.setMoveInput(0, 1)
      const startZ = cam.position.z
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
      const res = { dist: cam.position.z - startZ, maxSpeed, slideFrames, endSpeed: P.horizontalSpeed, eye: cam.position.y - P.bodyY }
      P.setCrouching(false)
      P.setSprinting(false)
      return res
    }
    out.slide = slideRun(20, true)
    out.sprintOnly = slideRun(Infinity, true)
    out.crouchWalk = slideRun(20, false)
    out.slideRelease = slideRun(20, true, 30)

    // Cooldown: sofort erneut ducken rutscht nicht gleich wieder
    place(LANE_X, 4, Math.PI)
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

    // Gegen die Außenwand rutschen: Schwung verfällt, kein Durchrutschen
    place(0, 20, Math.PI)
    P.setSprinting(true)
    P.setMoveInput(0, 1)
    run(20)
    P.setCrouching(true)
    run(40)
    out.wallZ = cam.position.z
    out.wallSpeed = P.horizontalSpeed
    P.setCrouching(false)

    // Bunny-Hop: Leertaste kurz vor der Landung (Puffer) bzw. zu spät.
    // Nach jeder Landung zurück auf die freie Fläche, Schwung bleibt.
    const hops = (count, { sprint = false, lateFrames = 0, crouchAtEnd = false } = {}) => {
      place(LANE_X, 4, Math.PI)
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
          cam.position.z = 4
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
    place(LANE_X, 4, Math.PI)
    P.setSprinting(true)
    P.setMoveInput(0, 1)
    run(30)
    P.jump()
    run(2)
    P.setMoveInput(0, 0)
    P.setSprinting(false)
    const z0 = cam.position.z
    let airFrames = 0
    while (!P.isOnGround && airFrames < 120) {
      P.update(DT)
      airFrames++
    }
    out.airCarry = cam.position.z - z0
    run(30)
    out.stopAfterLanding = P.horizontalSpeed

    // Normales Gehen unverändert: sofort volles Tempo, sofort Stillstand
    place(LANE_X, 4, Math.PI)
    P.setMoveInput(0, 1)
    run(1)
    out.walkStart = P.horizontalSpeed
    P.setMoveInput(0, 0)
    run(1)
    out.walkStop = P.horizontalSpeed

    // Sprint loslassen (Shift weiter gehalten): sofort stehen, kein Nachgleiten
    // (Bug: Sprint-Tempo galt als Schwung, man glitt bis 4,5 m weiter)
    const coast = (sprintFrames) => {
      place(LANE_X, 4, Math.PI)
      P.setSprinting(true)
      P.setMoveInput(0, 1)
      run(sprintFrames)
      P.setMoveInput(0, 0)
      const z0 = cam.position.z
      run(60)
      P.setSprinting(false)
      return cam.position.z - z0
    }
    out.coastTap = coast(6)
    out.coastSprint = coast(60)

    // Aus dem Rutschen springen: Tempo des Rutschens bleibt in der Luft
    place(LANE_X, 4, Math.PI)
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
    // --- Obere Ebene: Rampe A -> Plattform -> Brücke -> Nord-Laufsteg ---
    const EAST = -Math.PI / 2
    const WEST = Math.PI / 2
    const walkTo = (yaw, frames) => {
      cam.rotation.set(0, yaw, 0, 'YXZ')
      P.setMoveInput(0, 1)
      run(frames)
      P.setMoveInput(0, 0)
      run(10)
    }
    place(-2, 0, EAST)
    walkTo(EAST, 150) // Rampe A hoch bis auf die Plattform (x ~15)
    out.upperPlatform = { y: P.bodyY, x: cam.position.x }
    cam.position.x = 15 // Brückenmitte (Brücke x 13,75..16,25)
    walkTo(0, 200) // nach Norden über die Brücke bis an die Wand
    out.upperCatwalk = { y: P.bodyY, z: cam.position.z }
    walkTo(WEST, 360) // am Geländer entlang nach Westen
    out.upperWest = { y: P.bodyY, x: cam.position.x }
    // Geländer hält: nach Süden laufen (keine Lücke bei x ~-17)
    const beforeRail = cam.position.z
    walkTo(Math.PI, 60)
    out.railing = { y: P.bodyY, z: cam.position.z, before: beforeRail }
    // Lücke im Geländer (x -16..-14): hier geht es hinunter
    cam.position.x = -15
    walkTo(Math.PI, 80)
    out.dropDown = { y: P.bodyY, z: cam.position.z }

    // Unter dem Steg (place() würde auf den Steg setzen: Boden direkt)
    const placeOnFloor = (x, z) => {
      place(x, z, 0)
      P.spawn({ x, y: 1.7, z, clone() { return this } })
    }
    placeOnFloor(-9, -19)
    let maxHead = 0
    P.jump()
    run(60, () => (maxHead = Math.max(maxHead, P.bodyY + 2.0)))
    out.underCatwalk = { maxHead, landed: P.bodyY }
    placeOnFloor(-9, -10)
    walkTo(0, 140) // von der Raummitte unter den Steg bis an die Wand
    out.walkUnder = { y: P.bodyY, z: cam.position.z }
    // Vom Boden aus kommt man nicht hoch (2,8 m > Sprunghöhe)
    placeOnFloor(-9, -15.5)
    P.setMoveInput(0, 1)
    P.jump()
    run(60)
    P.setMoveInput(0, 0)
    out.noClimb = P.bodyY

    return out
  })

  check('auf 1.4m-Kiste springen klappt', Math.abs(r.lowCrate - 1.4) < 0.01, `Höhe ${r.lowCrate.toFixed(2)}`)
  check('auf 2.4m-Kiste springen klappt nicht', r.highCrate < 0.01, `Höhe ${r.highCrate.toFixed(2)}`)
  check('Rampe A hoch bis auf die Plattform', Math.abs(r.rampTop - 2.8) < 0.01, `Höhe ${r.rampTop.toFixed(2)}`)
  check('Rampe A gleichmäßig (kein Ruck)', r.rampMaxRise < 0.1, `max. ${r.rampMaxRise.toFixed(3)}m/Frame`)
  check('Rampe A wieder runter', r.rampDown < 0.01, `Höhe ${r.rampDown.toFixed(2)}`)
  check('Rampe B hoch auf die West-Plattform', Math.abs(r.rampBTop - 2.4) < 0.01, `Höhe ${r.rampBTop.toFixed(2)}`)
  check('durch erhöhten Durchgang in den Hauptraum', r.throughDoorwayX > -19.5, `x ${r.throughDoorwayX.toFixed(2)}`)
  check('Fenster: Duck-Sprung kommt durch', r.windowCrouch)
  check('Fenster: stehend springen kommt nicht durch', !r.windowStanding)
  const f2 = (n) => n.toFixed(2)
  check('obere Ebene: Rampe A auf die Plattform', Math.abs(r.upperPlatform.y - 2.8) < 0.01, `Höhe ${f2(r.upperPlatform.y)}, x ${f2(r.upperPlatform.x)}`)
  check('obere Ebene: über die Brücke auf den Nordsteg', Math.abs(r.upperCatwalk.y - 2.8) < 0.01 && r.upperCatwalk.z < -18.5, `Höhe ${f2(r.upperCatwalk.y)}, z ${f2(r.upperCatwalk.z)}`)
  check('obere Ebene: Steg entlang nach Westen', Math.abs(r.upperWest.y - 2.8) < 0.01 && r.upperWest.x < -17, `Höhe ${f2(r.upperWest.y)}, x ${f2(r.upperWest.x)}`)
  check('Geländer hält (kein Absturz)', Math.abs(r.railing.y - 2.8) < 0.01 && r.railing.z < -17.3, `Höhe ${f2(r.railing.y)}, z ${f2(r.railing.z)}`)
  check('Lücke im Geländer: hinunterspringen', r.dropDown.y < 0.01 && r.dropDown.z > -17, `Höhe ${f2(r.dropDown.y)}, z ${f2(r.dropDown.z)}`)
  check('unter dem Steg: Sprung stößt an (Kopf <= 2,5 m)', r.underCatwalk.maxHead <= 2.51 && r.underCatwalk.landed < 0.01, `Kopf max ${f2(r.underCatwalk.maxHead)}`)
  check('unter den Steg bis an die Wand laufen', r.walkUnder.y < 0.01 && r.walkUnder.z < -19.5, `z ${f2(r.walkUnder.z)}`)
  check('vom Boden nicht auf den Steg springen', r.noClimb < 0.01, `Höhe ${f2(r.noClimb)}`)
  const f = (n) => n.toFixed(2)
  check('Rutschen startet aus dem Sprint', r.slide.slideFrames > 20, `${r.slide.slideFrames} Frames, max ${f(r.slide.maxSpeed)} m/s`)
  check('Rutschen schneller als Sprint', r.slide.maxSpeed > r.sprintOnly.maxSpeed * 1.2, `${f(r.slide.maxSpeed)} vs ${f(r.sprintOnly.maxSpeed)} m/s`)
  check('Rutschen weiter als Ducken ohne Rutschen', r.slide.dist > r.crouchWalk.dist + 2, `${f(r.slide.dist)} vs ${f(r.crouchWalk.dist)} m`)
  check('Rutschen läuft aus (Duck-Tempo)', r.slide.slideFrames < 70 && r.slide.endSpeed < 4, `Ende ${f(r.slide.endSpeed)} m/s`)
  check('beim Rutschen geduckt', Math.abs(r.slide.eye - 1.0) < 0.01, `Augenhöhe ${f(r.slide.eye)}`)
  check('ohne Sprint kein Rutschen', r.crouchWalk.slideFrames === 0)
  check('Loslassen beendet Rutschen', r.slideRelease.slideFrames === 10, `${r.slideRelease.slideFrames} Frames`)
  check('Duck-Spam: Abklingzeit', r.spamSlides <= 2, `${r.spamSlides} Rutscher in 1,7 s`)
  check('Rutschen gegen Wand: bleibt drin, Schwung weg', r.wallZ < 21 && r.wallSpeed < 0.01, `z ${f(r.wallZ)}, ${f(r.wallSpeed)} m/s`)
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
