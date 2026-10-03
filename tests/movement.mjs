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
    P.weapon = 'pistol' // Tempo-Messungen mit 100 % (Startwaffe ist jetzt das Sturmgewehr)
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

    // Rampe B (West-Plattform, 2.8m) hoch, dann durch den erhöhten
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
    out.linkY = P.bodyY
    // Auf der Verbindung: Geländer im Osten hält, nach Süden auf den Südsteg
    cam.rotation.set(0, Math.PI, 0, 'YXZ')
    P.setMoveInput(0, 1)
    run(90)
    P.setMoveInput(0, 0)
    run(30)
    out.linkSteg = { y: P.bodyY, z: cam.position.z }

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
    // Unter dem Steg (place() würde auf den Steg setzen: Boden direkt)
    const placeOnFloor = (x, z) => {
      place(x, z, 0)
      P.spawn({ x, y: 1.7, z, clone() { return this } })
    }
    place(-2, 0, EAST)
    walkTo(EAST, 150) // Rampe A hoch bis auf die Plattform (x ~15)
    out.upperPlatform = { y: P.bodyY, x: cam.position.x }
    cam.position.x = 15 // Brückenmitte (Brücke x 13,75..16,25)
    walkTo(0, 200) // nach Norden über die Brücke bis an die Wand
    out.upperCatwalk = { y: P.bodyY, z: cam.position.z }
    walkTo(WEST, 360) // am Geländer entlang nach Westen
    out.upperWest = { y: P.bodyY, x: cam.position.x }
    // Geländer hält: nach Süden laufen (bei x -10 liegt darunter die Nordwest-Rampe)
    cam.position.x = -10
    const beforeRail = cam.position.z
    walkTo(Math.PI, 60)
    out.railing = { y: P.bodyY, z: cam.position.z, before: beforeRail }
    // Lücke im Geländer (x 26..28): hier geht es hinunter
    cam.position.x = 27
    walkTo(Math.PI, 80)
    out.dropDown = { y: P.bodyY, z: cam.position.z }

    // Eck-Aufgänge: Nordwest (Rampe steigt nach Westen), Südost (nach Osten)
    placeOnFloor(-5, -16) // zwischen Rampe (ab x -6,5) und Nord-Spawn-Deckung (ab x -4,5)
    walkTo(WEST, 200)
    out.nwRampTop = { y: P.bodyY, x: cam.position.x }
    walkTo(0, 60) // von der Eck-Plattform nach Norden auf den Steg
    out.nwCatwalk = { y: P.bodyY, z: cam.position.z }
    walkTo(Math.PI, 40) // zurück auf die Plattform, dann die Rampe hinunter
    walkTo(EAST, 200)
    out.nwRampDown = { y: P.bodyY, x: cam.position.x }
    placeOnFloor(17.5, 16)
    walkTo(EAST, 200)
    out.seRampTop = { y: P.bodyY, x: cam.position.x }
    walkTo(Math.PI, 60)
    out.seCatwalk = { y: P.bodyY, z: cam.position.z }
    // Von unter dem Steg kommt man nicht seitlich auf die Rampe
    placeOnFloor(-11, -19)
    walkTo(Math.PI, 60)
    out.rampSide = { y: P.bodyY, z: cam.position.z }

    placeOnFloor(-9, -19)
    let maxHead = 0
    P.jump()
    run(60, () => (maxHead = Math.max(maxHead, P.bodyY + 2.0)))
    out.underCatwalk = { maxHead, landed: P.bodyY }
    placeOnFloor(-5, -10) // x -9: Nordwest-Rampe, x 5..13: Fensterwand
    walkTo(0, 140) // von der Raummitte unter den Steg bis an die Wand
    out.walkUnder = { y: P.bodyY, z: cam.position.z, x: cam.position.x }
    // Vom Boden aus kommt man nicht hoch (2,8 m > Sprunghöhe)
    placeOnFloor(-5, -15.5)
    P.setMoveInput(0, 1)
    P.jump()
    run(60)
    P.setMoveInput(0, 0)
    out.noClimb = P.bodyY

    // Südseite: Plattform -> Brücke nach Süden -> Steg bis an die Ostwand
    place(15, 0, Math.PI)
    walkTo(Math.PI, 200)
    out.southCatwalk = { y: P.bodyY, z: cam.position.z }
    walkTo(EAST, 200)
    out.southEast = { y: P.bodyY, x: cam.position.x }
    placeOnFloor(-9, 10)
    walkTo(Math.PI, 140)
    out.walkUnderSouth = { y: P.bodyY, z: cam.position.z }
    // Süd-Spawn ist rundum gedeckt: raus nur seitlich unter dem Steg
    placeOnFloor(0, 18)
    walkTo(WEST, 120)
    const spawnWest = cam.position.x
    placeOnFloor(0, 18)
    walkTo(EAST, 120)
    out.spawnExit = { west: spawnWest, east: cam.position.x }
    // Nord-Spawn genauso: seitlich unter dem Steg raus
    placeOnFloor(0, -18)
    walkTo(WEST, 120)
    const northWest = cam.position.x
    placeOnFloor(0, -18)
    walkTo(EAST, 120)
    out.northSpawnExit = { west: northWest, east: cam.position.x }

    // Nordost-Halle: durch die Öffnung (x 38..46) hinein, daneben blockiert die Wand
    placeOnFloor(39, -8)
    walkTo(0, 200)
    out.hallIn = { z: cam.position.z }
    // Regal-Steg: vom Nordsteg (x 28) nach Osten durch die Wand, Absprung-Lücke bei x 47..49
    place(28, -19, EAST)
    walkTo(EAST, 100)
    out.shelfEnter = { y: P.bodyY, x: cam.position.x }
    walkTo(EAST, 160)
    out.shelfEast = { y: P.bodyY, x: cam.position.x }
    cam.position.x = 48
    walkTo(Math.PI, 80)
    out.shelfDrop = { y: P.bodyY, z: cam.position.z }
    // Vom Boden aus (Öffnung Ostwand unter dem Steg) kommt man nicht durch die Wand
    placeOnFloor(28, -19)
    walkTo(EAST, 100)
    out.shelfWall = { x: cam.position.x }
    // Unter dem Regal-Steg stehen (Halle)
    placeOnFloor(44, -14)
    walkTo(0, 60)
    out.shelfUnder = { y: P.bodyY, z: cam.position.z }
    // Halle-Spawn (49,5 / -19,2): unter dem Regal-Steg, Kiste davor, raus nach Westen
    placeOnFloor(49.5, -19.2)
    walkTo(WEST, 120)
    out.hallSpawnExit = cam.position.x
    placeOnFloor(49.5, -19.2)
    walkTo(0, 40)
    out.hallSpawnWall = cam.position.z
    placeOnFloor(34, -8)
    walkTo(0, 120)
    out.hallWall = { z: cam.position.z }

    // Südost-Halle (Spiegelbild): durch die Öffnung (x 38..46) hinein, daneben blockiert die Wand
    placeOnFloor(39, 8)
    walkTo(Math.PI, 200)
    out.seHallIn = { z: cam.position.z }
    placeOnFloor(37, 8)
    walkTo(Math.PI, 120)
    out.seHallWall = { z: cam.position.z }
    // Regal-Steg Süd: vom Südsteg (x 28) nach Osten über den Südost-Tunnel und durch die Wand, Absprung-Lücke bei x 47..49
    place(28, 19, EAST)
    walkTo(EAST, 100)
    out.seShelfEnter = { y: P.bodyY, x: cam.position.x }
    walkTo(EAST, 160)
    out.seShelfEast = { y: P.bodyY, x: cam.position.x }
    cam.position.x = 48
    walkTo(0, 80)
    out.seShelfDrop = { y: P.bodyY, z: cam.position.z }
    placeOnFloor(44, 14)
    walkTo(Math.PI, 60)
    out.seShelfUnder = { y: P.bodyY, z: cam.position.z }
    // Halle-Spawn (49,5 / 19,2): unter dem Regal-Steg, Kiste davor, raus nach Westen
    placeOnFloor(49.5, 19.2)
    walkTo(WEST, 120)
    out.seHallSpawnExit = cam.position.x
    placeOnFloor(49.5, 19.2)
    walkTo(Math.PI, 40)
    out.seHallSpawnWall = cam.position.z

    // Nordwest-Tunnel (unter dem Nordsteg) führt durch die Trennwand in die West-Zone
    placeOnFloor(-10, -19)
    walkTo(WEST, 220)
    out.nwTunnel = { x: cam.position.x, z: cam.position.z, y: P.bodyY }
    // ... und wieder zurück
    walkTo(EAST, 260)
    out.nwTunnelBack = { x: cam.position.x, y: P.bodyY }

    // Südost-Tunnel (L): Gang unter dem Südsteg nach Osten durch die Ostwand, dann
    // außerhalb nach Norden durch die Südwand des Flankenraums (Ostzone)
    placeOnFloor(20, 19)
    walkTo(EAST, 190)
    out.seTunnelEast = { x: cam.position.x, z: cam.position.z, y: P.bodyY }
    walkTo(0, 200)
    out.seTunnelNorth = { x: cam.position.x, z: cam.position.z, y: P.bodyY }
    walkTo(Math.PI, 260)
    out.seTunnelBack = { x: cam.position.x, z: cam.position.z, y: P.bodyY }

    // Aus dem Nordwest-Tunnel darf kein Spawn der West-Zone einsehbar sein
    // (sonst Schießstand). Der Nord-Spawn (0, -18) liegt weiter am selben Gang
    // und ist von dort schon immer einsehbar - bewusst nicht Teil der Prüfung.
    const ray = new __dusk.weapon.raycaster.constructor()
    const walls = __dusk.arena.solids.map((s) => s.mesh)
    const V = cam.position.constructor
    let seeing = 0
    for (const spawn of __dusk.arena.spawnPoints.filter((p) => p.x < -20.5)) {
      for (let x = -19; x <= -7; x += 1) {
        for (let z = -20.2; z <= -17.8; z += 0.6) {
          const from = new V(x, 1.5, z)
          const dir = new V(spawn.x, 1.5, spawn.z).sub(from)
          ray.set(from, dir.clone().normalize())
          ray.far = dir.length()
          if (ray.intersectObjects(walls, false).length === 0) seeing++
        }
      }
    }
    out.tunnelSight = seeing

    return out
  })

  check('auf 1.4m-Kiste springen klappt', Math.abs(r.lowCrate - 1.4) < 0.01, `Höhe ${r.lowCrate.toFixed(2)}`)
  check('auf 2.4m-Kiste springen klappt nicht', r.highCrate < 0.01, `Höhe ${r.highCrate.toFixed(2)}`)
  check('Rampe A hoch bis auf die Plattform', Math.abs(r.rampTop - 2.8) < 0.01, `Höhe ${r.rampTop.toFixed(2)}`)
  check('Rampe A gleichmäßig (kein Ruck)', r.rampMaxRise < 0.1, `max. ${r.rampMaxRise.toFixed(3)}m/Frame`)
  check('Rampe A wieder runter', r.rampDown < 0.01, `Höhe ${r.rampDown.toFixed(2)}`)
  check('Rampe B hoch auf die West-Plattform', Math.abs(r.rampBTop - 2.8) < 0.01, `Höhe ${r.rampBTop.toFixed(2)}`)
  check('durch das Fenster auf die Verbindung (2,8 m, Geländer im Osten)', r.throughDoorwayX > -19.5 && r.throughDoorwayX < -17 && Math.abs(r.linkY - 2.8) < 0.01, `x ${r.throughDoorwayX.toFixed(2)}, Höhe ${r.linkY.toFixed(2)}`)
  check('Verbindung: nach Süden auf den Südsteg', Math.abs(r.linkSteg.y - 2.8) < 0.01 && r.linkSteg.z > 19.5, `Höhe ${r.linkSteg.y.toFixed(2)}, z ${r.linkSteg.z.toFixed(2)}`)
  check('Fenster: Duck-Sprung kommt durch', r.windowCrouch)
  check('Fenster: stehend springen kommt nicht durch', !r.windowStanding)
  const f2 = (n) => n.toFixed(2)
  check('obere Ebene: Rampe A auf die Plattform', Math.abs(r.upperPlatform.y - 2.8) < 0.01, `Höhe ${f2(r.upperPlatform.y)}, x ${f2(r.upperPlatform.x)}`)
  check('obere Ebene: über die Brücke auf den Nordsteg', Math.abs(r.upperCatwalk.y - 2.8) < 0.01 && r.upperCatwalk.z < -18.5, `Höhe ${f2(r.upperCatwalk.y)}, z ${f2(r.upperCatwalk.z)}`)
  check('obere Ebene: Steg entlang nach Westen', Math.abs(r.upperWest.y - 2.8) < 0.01 && r.upperWest.x < -17, `Höhe ${f2(r.upperWest.y)}, x ${f2(r.upperWest.x)}`)
  check('Geländer hält (kein Absturz)', Math.abs(r.railing.y - 2.8) < 0.01 && r.railing.z < -17.3, `Höhe ${f2(r.railing.y)}, z ${f2(r.railing.z)}`)
  check('Nordwest-Rampe hoch auf die Eck-Plattform', Math.abs(r.nwRampTop.y - 2.8) < 0.01 && r.nwRampTop.x < -17, `Höhe ${f2(r.nwRampTop.y)}, x ${f2(r.nwRampTop.x)}`)
  check('von der Eck-Plattform auf den Nordsteg', Math.abs(r.nwCatwalk.y - 2.8) < 0.01 && r.nwCatwalk.z < -18.5, `Höhe ${f2(r.nwCatwalk.y)}, z ${f2(r.nwCatwalk.z)}`)
  check('Nordwest-Rampe wieder hinunter', r.nwRampDown.y < 0.01 && r.nwRampDown.x > -6, `Höhe ${f2(r.nwRampDown.y)}, x ${f2(r.nwRampDown.x)}`)
  check('Südost-Rampe hoch auf die Eck-Plattform', Math.abs(r.seRampTop.y - 2.8) < 0.01 && r.seRampTop.x > 29, `Höhe ${f2(r.seRampTop.y)}, x ${f2(r.seRampTop.x)}`)
  check('von der Eck-Plattform auf den Südsteg', Math.abs(r.seCatwalk.y - 2.8) < 0.01 && r.seCatwalk.z > 18.5, `Höhe ${f2(r.seCatwalk.y)}, z ${f2(r.seCatwalk.z)}`)
  check('unter dem Steg: nicht seitlich auf die Rampe', r.rampSide.y < 0.01 && r.rampSide.z < -17.5, `Höhe ${f2(r.rampSide.y)}, z ${f2(r.rampSide.z)}`)
  check('Nordwest-Tunnel führt durch die Trennwand in die West-Zone', r.nwTunnel.x < -28 && r.nwTunnel.y < 0.01, `x ${f2(r.nwTunnel.x)}, z ${f2(r.nwTunnel.z)}`)
  check('Nordwest-Tunnel: auch zurück in den Hauptraum', r.nwTunnelBack.x > -16 && r.nwTunnelBack.y < 0.01, `x ${f2(r.nwTunnelBack.x)}`)
  check('Südost-Tunnel: Gang unter dem Südsteg durch die Ostwand nach Osten', r.seTunnelEast.x > 35 && r.seTunnelEast.z > 17.5 && r.seTunnelEast.y < 0.01, `x ${f2(r.seTunnelEast.x)}, z ${f2(r.seTunnelEast.z)}`)
  check('Südost-Tunnel (L): nach Norden in den Flankenraum (Ostzone)', r.seTunnelNorth.z < 10 && r.seTunnelNorth.x > 33 && r.seTunnelNorth.y < 0.01, `x ${f2(r.seTunnelNorth.x)}, z ${f2(r.seTunnelNorth.z)}`)
  check('Südost-Tunnel: auch zurück bis in den Gang', r.seTunnelBack.z > 19.5 && r.seTunnelBack.y < 0.01, `x ${f2(r.seTunnelBack.x)}, z ${f2(r.seTunnelBack.z)}`)
  check('Nordwest-Tunnel: von dort ist kein West-Spawn einsehbar', r.tunnelSight === 0, `${r.tunnelSight} freie Sichtlinien`)
  check('Lücke im Geländer: hinunterspringen', r.dropDown.y < 0.01 && r.dropDown.z > -17, `Höhe ${f2(r.dropDown.y)}, z ${f2(r.dropDown.z)}`)
  check('obere Ebene: Brücke nach Süden auf den Südsteg', Math.abs(r.southCatwalk.y - 2.8) < 0.01 && r.southCatwalk.z > 18.5, `Höhe ${f2(r.southCatwalk.y)}, z ${f2(r.southCatwalk.z)}`)
  check('obere Ebene: Südsteg bis an die Ostwand', Math.abs(r.southEast.y - 2.8) < 0.01 && r.southEast.x > 28.5, `Höhe ${f2(r.southEast.y)}, x ${f2(r.southEast.x)}`)
  check('unter den Südsteg bis an die Wand laufen', r.walkUnderSouth.y < 0.01 && r.walkUnderSouth.z > 19.5, `z ${f2(r.walkUnderSouth.z)}`)
  check('Süd-Spawn: seitlich unter dem Steg raus', r.spawnExit.west < -6 && r.spawnExit.east > 6, `x ${f2(r.spawnExit.west)} / ${f2(r.spawnExit.east)}`)
  check('Halle-Spawn: nach Westen unter dem Steg raus', r.hallSpawnExit < 44, `x ${f2(r.hallSpawnExit)}`)
  check('Halle-Spawn: Wand im Norden', r.hallSpawnWall < -19.9, `z ${f2(r.hallSpawnWall)}`)
  check('Nordost-Halle: durch die Öffnung hinein', r.hallIn.z < -19.9, `z ${f2(r.hallIn.z)}`)
  check('Nordost-Halle: Wand neben der Öffnung hält', r.hallWall.z > -11.2, `z ${f2(r.hallWall.z)}`)
  check('Regal-Steg: durch die Ostwand auf 2,8 m', Math.abs(r.shelfEnter.y - 2.8) < 0.01 && r.shelfEnter.x > 30, `Höhe ${f2(r.shelfEnter.y)}, x ${f2(r.shelfEnter.x)}`)
  check('Regal-Steg: bis ans Ende in der Halle', Math.abs(r.shelfEast.y - 2.8) < 0.01 && r.shelfEast.x > 50, `Höhe ${f2(r.shelfEast.y)}, x ${f2(r.shelfEast.x)}`)
  check('Regal-Steg: Lücke im Geländer, hinunterspringen', r.shelfDrop.y < 0.01 && r.shelfDrop.z > -17, `Höhe ${f2(r.shelfDrop.y)}, z ${f2(r.shelfDrop.z)}`)
  check('unter dem Steg kein Durchgang durch die Ostwand', r.shelfWall.x < 32, `x ${f2(r.shelfWall.x)}`)
  check('unter dem Regal-Steg stehen', r.shelfUnder.y < 0.01 && r.shelfUnder.z < -17.9, `Höhe ${f2(r.shelfUnder.y)}, z ${f2(r.shelfUnder.z)}`)
  check('Südost-Halle: durch die Öffnung hinein', r.seHallIn.z > 19.9, `z ${f2(r.seHallIn.z)}`)
  check('Südost-Halle: Wand neben der Öffnung hält', r.seHallWall.z < 11.8, `z ${f2(r.seHallWall.z)}`)
  check('Regal-Steg Süd: über den Tunnel und durch die Wand auf 2,8 m', Math.abs(r.seShelfEnter.y - 2.8) < 0.01 && r.seShelfEnter.x > 33, `Höhe ${f2(r.seShelfEnter.y)}, x ${f2(r.seShelfEnter.x)}`)
  check('Regal-Steg Süd: bis ans Ende in der Halle', Math.abs(r.seShelfEast.y - 2.8) < 0.01 && r.seShelfEast.x > 50, `Höhe ${f2(r.seShelfEast.y)}, x ${f2(r.seShelfEast.x)}`)
  check('Regal-Steg Süd: Lücke im Geländer, hinunterspringen', r.seShelfDrop.y < 0.01 && r.seShelfDrop.z < 17.5, `Höhe ${f2(r.seShelfDrop.y)}, z ${f2(r.seShelfDrop.z)}`)
  check('unter dem Regal-Steg Süd stehen', r.seShelfUnder.y < 0.01 && r.seShelfUnder.z > 17.9, `Höhe ${f2(r.seShelfUnder.y)}, z ${f2(r.seShelfUnder.z)}`)
  check('Südost-Halle-Spawn: nach Westen unter dem Steg raus', r.seHallSpawnExit < 44, `x ${f2(r.seHallSpawnExit)}`)
  check('Südost-Halle-Spawn: Wand im Süden', r.seHallSpawnWall > 19.9, `z ${f2(r.seHallSpawnWall)}`)
  check('Nord-Spawn: seitlich unter dem Steg raus', r.northSpawnExit.west < -6 && r.northSpawnExit.east > 6, `x ${f2(r.northSpawnExit.west)} / ${f2(r.northSpawnExit.east)}`)
  check('unter dem Steg: Sprung stößt an (Kopf <= 2,5 m)', r.underCatwalk.maxHead <= 2.51 && r.underCatwalk.landed < 0.01, `Kopf max ${f2(r.underCatwalk.maxHead)}`)
  check('unter den Steg bis an die Wand laufen', r.walkUnder.y < 0.01 && r.walkUnder.z < -19.5, `x ${f2(r.walkUnder.x)}, z ${f2(r.walkUnder.z)}`)
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
