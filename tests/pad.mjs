// Sprungpad: Wurf, Landung als Pad (auch oben auf Stegen/Kisten), nur eigenes Team schleudert hoch, keine Decke
// (gleiche Steighöhe auf jeder Ebene), Wände unsichtbar unbegrenzt hoch, Platzregeln, Fuzz gegen Verlassen der Karte,
// online + Bewegungsprüfung.
//
//   node tests/pad.mjs
import { startServers, launchBrowser, openGame, play, pickOption, wait, teleport, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.click('#start-button')
  await pickOption(page, '.gadget-card[data-gadget="jump"]')
  const ids = await page.evaluate(() => [...document.querySelectorAll('#loadout-gadget .gadget-card')].map((c) => c.dataset.gadget).join())
  check('Gadget-Auswahl hat das Sprungpad (smoke, flash, jump, grapple)', ids === 'smoke,flash,jump,grapple', ids)
  await page.click('#loadout-play-button')
  await wait(500)
  await page.setViewportSize({ width: 480, height: 270 })
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement })
    window.__sounds = []
    const play = __dusk.sound.play.bind(__dusk.sound)
    __dusk.sound.play = (n, v) => (window.__sounds.push(n), play(n, v))
    const playAt = __dusk.sound.playAt.bind(__dusk.sound)
    __dusk.sound.playAt = (n, p, v) => (window.__sounds.push('@' + n), playAt(n, p, v))
    const G = __dusk.gadgets
    window.__real = Object.getPrototypeOf(G).update.bind(G)
    G.update = () => {}
    window.__setup = (x, z, yaw = 0, eye = 1.7) => {
      __dusk.player.spawn({ x, y: eye, z, clone() { return this } })
      __dusk.camera.rotation.set(0, yaw, 0, 'YXZ')
      __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    }
    // Spiel-Frame von Hand: Gadgets, Pad-Auslösung, Spieler (so wie die Hauptschleife)
    window.__frame = (dt) => {
      window.__real(dt)
      const P = __dusk.player
      const pad = G.padAt(__dusk.camera.position.x, __dusk.camera.position.z, P.feetHeight, P.team)
      if (pad && P.launchFromPad()) { pad.pulse = 1; window.__launches = (window.__launches ?? 0) + 1 }
      P.update(dt)
    }
    window.__run = (seconds) => { for (let t = 0; t < seconds; t += 1 / 60) window.__frame(1 / 60) }
  })
  const hud = await page.evaluate(() => ({ name: document.querySelector('#gadget-name').textContent, gadget: __dusk.gadgets.gadget }))
  check('Im Spiel: Sprungpad, Anzeige folgt', hud.gadget === 'jump' && hud.name === 'Sprungpad', JSON.stringify(hud))

  // Wurf: Flug, dann steht ein Pad am Boden (Mitte des offenen Feldes bei x = -8)
  await page.evaluate(() => window.__setup(-8, 8))
  await page.evaluate(() => __dusk.throwGadget())
  const afterThrow = await page.evaluate(() => ({ cd: __dusk.gadgets.cooldownRemaining, pads: __dusk.gadgets.pads.length }))
  check('Wurf: Abklingzeit 30 s, noch kein Pad (fliegt)', afterThrow.cd === 30 && afterThrow.pads === 0, JSON.stringify(afterThrow))
  await page.evaluate(() => window.__run(3.5))
  const pad = await page.evaluate(() => {
    const p = __dusk.gadgets.pads[0]
    return p && { x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2), team: p.team, sounds: window.__sounds.slice() }
  })
  check('Pad liegt flach auf dem Boden vor dem Werfer, Aufsetz-Ton', pad && pad.y === 0 && pad.z < 4 && pad.sounds.includes('@padPlace'), JSON.stringify(pad))

  // Hochschleudern: Spieler steht auf dem Pad (Landen auf dem Pad schleudert wieder hoch, wie ein Trampolin)
  const launch = await page.evaluate((pad) => {
    window.__launches = 0
    window.__setup(pad.x, pad.z)
    let maxFeet = 0
    const P = __dusk.player
    for (let t = 0; t < 1.2; t += 1 / 60) {
      window.__frame(1 / 60)
      maxFeet = Math.max(maxFeet, P.feetHeight)
    }
    const firstLaunches = window.__launches
    // Pad weg: danach kommt man herunter und bleibt am Boden
    const saved = __dusk.gadgets.pads.splice(0)
    window.__run(3)
    __dusk.gadgets.pads.push(...saved)
    return { maxFeet: +maxFeet.toFixed(2), launches: firstLaunches, landed: P.isOnGround, feet: +P.feetHeight.toFixed(2) }
  }, pad)
  check('Auf dem Pad (Boden): ein Start, Steighöhe ~4,4 m', launch.launches === 1 && launch.maxFeet > 4.2 && launch.maxFeet < 4.6, JSON.stringify(launch))
  check('Ohne Pad wieder gelandet (am Boden)', launch.landed && launch.feet < 0.1, JSON.stringify(launch))

  // Gegnerisches Team nutzt das Pad nicht
  const enemy = await page.evaluate((pad) => {
    const G = __dusk.gadgets
    const P = __dusk.player
    window.__launches = 0
    const saved = P.team
    P.team = saved === 'red' ? 'blue' : 'red'
    window.__setup(pad.x, pad.z)
    window.__run(1)
    const result = { launches: window.__launches, feet: +P.feetHeight.toFixed(2) }
    P.team = saved
    return result
  }, pad)
  check('Gegnerisches Team: kein Start', enemy.launches === 0 && enemy.feet < 0.1, JSON.stringify(enemy))

  // Platzierung: nicht unter Stegen/Dach, nicht auf Kisten
  const spots = await page.evaluate(() => {
    const G = __dusk.gadgets
    const V = __dusk.camera.position.constructor
    // Unter dem Nordsteg (Steg-Boden ~2,5..2,8 m, z -21..-18) und auf einer Kiste (Oberkante ~1,4 m)
    const crate = __dusk.arena.solids.find((s) => s.kind === 'cover' && s.box.max.y > 1 && s.box.max.y < 2)
    return {
      offen: G.padSpotOk(new V(-8, 0.25, 8)),
      unterSteg: G.padSpotOk(new V(0, 0.25, -19.5)),
      amStegrand: G.padSpotOk(new V(49.5, 0.25, 17.68)),
      aufKiste: crate ? G.padSpotOk(new V((crate.box.min.x + crate.box.max.x) / 2, crate.box.max.y + 0.25, (crate.box.min.z + crate.box.max.z) / 2)) : null,
      aufSteg: G.padSpotOk(new V(0, 3.05, -19.5)),
    }
  })
  check('Platz fürs Pad: offener Boden, Steg oben und Kisten ja; unter dem Steg und knapp am Stegrand nein', spots.offen === true && spots.aufSteg === true && spots.aufKiste === true && spots.unterSteg === false && spots.amStegrand === false, JSON.stringify(spots))

  // Abgelehnter Wurf verbraucht die Abklingzeit nicht: dicht unter den Steg werfen
  const reject = await page.evaluate(() => {
    const G = __dusk.gadgets
    G.reset()
    window.__setup(0, -19.5)
    __dusk.camera.rotation.set(-1.2, 0, 0, 'YXZ') // steil nach unten: landet direkt unter dem Steg
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    const before = G.pads.length
    __dusk.throwGadget()
    return { cooldown: G.cooldownRemaining, reason: G.rejectReason, pads: G.pads.length - before }
  })
  check('Wurf unter den Steg: abgelehnt mit Hinweis, Abklingzeit bleibt 0', reject.cooldown === 0 && reject.reason.includes('Sprungpad'), JSON.stringify(reject))

  // Oben auf dem Nordsteg (Fußhöhe 2,8 m): gleiche Steighöhe, also bis ~7,2 m - ohne Decke, über der 6-m-Wand
  const upper = await page.evaluate(() => {
    const G = __dusk.gadgets
    const P = __dusk.player
    const V = __dusk.camera.position.constructor
    G.pads.length = 0
    G.spawnPad(new V(0, 3.05, -19.5), P.team)
    G.pads[0].age = 1
    window.__launches = 0
    window.__setup(0, -19.5, 0, 4.6)
    window.__run(1.2) // fällt auf den Steg und wird gleich hochgeschleudert
    let maxFeet = 0
    for (let t = 0; t < 1.4; t += 1 / 60) {
      window.__frame(1 / 60)
      maxFeet = Math.max(maxFeet, P.feetHeight)
    }
    const walls = __dusk.arena.solids.filter((s) => s.kind === 'wall' && s.box.max.y >= 90).length
    G.pads.length = 0
    return { maxFeet: +maxFeet.toFixed(2), launches: window.__launches, tallWalls: walls }
  })
  check('Pad oben auf dem Steg: Steighöhe wie unten (~7,2 m Fußhöhe), keine Decke bei 4,8 m', upper.launches >= 1 && upper.maxFeet > 6.8 && upper.maxFeet < 8, JSON.stringify(upper))

  // Block über dem Südost-Tunnel (Nordarm, Oberkante 6 m): ohne unsichtbare Barriere vom Steg aus erreichbar
  const block = await page.evaluate(() => {
    const G = __dusk.gadgets
    const P = __dusk.player
    const V = __dusk.camera.position.constructor
    G.pads.length = 0
    G.spawnPad(new V(34.5, 3.05, 19.2), P.team)
    G.pads[0].age = 1
    window.__launches = 0
    window.__setup(34.5, 19.2, 0, 4.6) // blickt nach Norden (-z), auf den Block zu
    P.setMoveInput(0, 1)
    window.__run(1.0)
    let maxFeet = 0
    for (let t = 0; t < 2.5; t += 1 / 60) {
      window.__frame(1 / 60)
      maxFeet = Math.max(maxFeet, P.feetHeight)
    }
    P.setMoveInput(0, 0)
    window.__run(1)
    G.pads.length = 0
    return { feet: +P.feetHeight.toFixed(2), maxFeet: +maxFeet.toFixed(2), x: +__dusk.camera.position.x.toFixed(1), z: +__dusk.camera.position.z.toFixed(1), launches: window.__launches }
  })
  check('Sprungpad auf dem Steg: man landet oben auf dem 6-m-Block über dem Südost-Tunnel', block.feet > 5.9 && block.feet < 6.1 && block.z < 17.7, JSON.stringify(block))
  check('Volle Wände sind für die Kollision unbegrenzt hoch (unsichtbare Mauern)', upper.tallWalls >= 8, JSON.stringify(upper))
  // Von oben gegen die Außenwand sprinten: bleibt in der Halle, landet nicht auf der Wandkrone
  const wall = await page.evaluate(() => {
    const G = __dusk.gadgets
    const P = __dusk.player
    const V = __dusk.camera.position.constructor
    G.pads.length = 0
    G.spawnPad(new V(0, 3.05, -19.5), P.team)
    G.pads[0].age = 1
    window.__setup(0, -19.5, 0, 4.6) // blickt nach Norden (-z), direkt auf die Nordwand
    P.setSprinting(true)
    P.setMoveInput(0, 1)
    let minZ = 0, crown = 0, maxFeet = 0
    for (let f = 0; f < 60 * 8; f++) {
      window.__frame(1 / 60)
      minZ = Math.min(minZ, __dusk.camera.position.z)
      maxFeet = Math.max(maxFeet, P.feetHeight)
      if (P.isOnGround && P.feetHeight > 5.8 && P.feetHeight < 6.3) crown++
    }
    P.setSprinting(false); P.setMoveInput(0, 0)
    G.pads.length = 0
    return { minZ: +minZ.toFixed(2), crown, maxFeet: +maxFeet.toFixed(2) }
  })
  check('Hoch oben gegen die Nordwand gelaufen: nie hinter die Wand (z > -21), nie auf der Wandkrone', wall.minZ > -21 && wall.crown === 0 && wall.maxFeet > 6.8, JSON.stringify(wall))

  // Fuzz: viele Starts an zufälligen Stellen, mit Anlauf zur Wand und Sprüngen - nie über die Karte hinaus, nie höher als 4,8 m, nie festgesteckt
  const fuzz = await page.evaluate(() => {
    const G = __dusk.gadgets
    const P = __dusk.player
    const A = __dusk.arena
    const V = __dusk.camera.position.constructor
    G.reset()
    let seed = 99
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
    const bounds = { minX: -32, maxX: 52, minZ: -21, maxZ: 21 }
    let started = 0, maxFeet = 0, maxX = 0, maxZ = 0, stuck = 0, outside = 0, crown = 0, crownAt = null
    for (let run = 0; run < 60; run++) {
      // freie Bodenstelle suchen
      let x, z
      for (let i = 0; i < 40; i++) {
        x = -30 + rnd() * 80
        z = -19 + rnd() * 38
        if (!A.solids.some((q) => q.box.min.x - 0.6 < x && x < q.box.max.x + 0.6 && q.box.min.z - 0.6 < z && z < q.box.max.z + 0.6 && q.box.min.y < 1.8)) break
      }
      if (!G.padSpotOk(new V(x, 0.25, z))) continue
      G.pads.length = 0
      G.spawnPad(new V(x, 0.25, z), P.team)
      G.pads[0].age = 1
      window.__setup(x, z, rnd() * 6.28)
      P.setSprinting(rnd() < 0.6)
      P.setMoveInput((rnd() - 0.5) * 2, 0.5 + rnd() * 0.5)
      P.setLean(0)
      window.__launches = 0
      for (let f = 0; f < 60 * 6; f++) {
        if (f % 20 === 0 && rnd() < 0.3) P.jump()
        window.__frame(1 / 60)
        const p = __dusk.camera.position
        maxFeet = Math.max(maxFeet, P.feetHeight)
        maxX = Math.max(maxX, Math.abs(p.x)); maxZ = Math.max(maxZ, Math.abs(p.z))
        if (P.isOnGround && P.feetHeight > 5.8 && P.feetHeight < 6.3) { crown++; crownAt ??= { x: +p.x.toFixed(2), z: +p.z.toFixed(2), feet: +P.feetHeight.toFixed(2), run } }
        if (p.x < bounds.minX || p.x > bounds.maxX || p.z < bounds.minZ || p.z > bounds.maxZ) outside++
      }
      if (window.__launches > 0) started++
      P.setMoveInput(0, 0); P.setSprinting(false)
      for (let f = 0; f < 120; f++) window.__frame(1 / 60)
      if (!P.isOnGround) stuck++
    }
    return { started, maxFeet: +maxFeet.toFixed(2), outside, stuck, crown, crownAt }
  })
  check('Fuzz (60 Starts mit Anlauf/Sprüngen): gestartet, nie außerhalb der Karte, nie auf einer Wandkrone, am Ende am Boden', fuzz.started > 30 && fuzz.outside === 0 && fuzz.crown === 0 && fuzz.stuck === 0, JSON.stringify(fuzz))

  // Online: B sieht das Pad von A an derselben Stelle; Start ohne Korrektur durch die Bewegungsprüfung (enforce)
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A)
  await play(B)
  await wait(3800)
  await A.evaluate(() => __dusk.gadgets.setGadget('jump'))
  await teleport(A, -8, 1.7, 8)
  await A.evaluate(() => {
    __dusk.camera.rotation.set(0, 0, 0, 'YXZ')
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    window.__corrections = 0
    window.__sounds = []
    const play = __dusk.sound.play.bind(__dusk.sound)
    __dusk.sound.play = (n, v) => (window.__sounds.push(n), play(n, v))
    const old = __dusk.player.moveTo.bind(__dusk.player)
    __dusk.player.moveTo = (p) => { window.__corrections++; old(p) }
  })
  await wait(300)
  await A.evaluate(() => __dusk.throwGadget())
  await wait(3800)
  const seenByB = await B.evaluate(() => __dusk.gadgets.pads.map((p) => ({ x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2), team: p.team })))
  const ownA = await A.evaluate(() => __dusk.gadgets.pads.map((p) => ({ x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2) })))
  check('Online: B sieht das Pad an derselben Stelle wie A', seenByB.length === 1 && ownA.length === 1 && Math.abs(seenByB[0].x - ownA[0].x) < 0.05 && Math.abs(seenByB[0].z - ownA[0].z) < 0.05, JSON.stringify({ seenByB, ownA }))
  // A stellt sich aufs Pad und wird geschleudert (echte Spielschleife läuft online mit)
  await A.evaluate((p) => {
    __dusk.player.spawn({ x: p.x, y: 1.7, z: p.z, clone() { return this } })
  }, ownA[0])
  await wait(300)
  const flight = await A.evaluate(async () => {
    let maxFeet = 0
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 50))
      maxFeet = Math.max(maxFeet, __dusk.player.feetHeight)
    }
    return { maxFeet: +maxFeet.toFixed(2), corrections: window.__corrections, launchSound: window.__sounds.includes('padLaunch') }
  })
  check('Online: Start bis ~4,4 m, Start-Ton', flight.maxFeet > 3.5 && flight.maxFeet < 4.7 && flight.launchSound, JSON.stringify(flight))
  // Server-Bewegungsprüfung (shared/movementRules): 20 s Dauer-Hüpfen auf dem Pad mit 20 Zuständen/s, wie sie gesendet würden
  const rules = await page.evaluate(async () => {
    const { createMovementCheck, checkMovement } = await import('/3D-basics/src/shared/movementRules.ts')
    const G = __dusk.gadgets
    const P = __dusk.player
    const V = __dusk.camera.position.constructor
    window.__setup(-8, 8)
    G.pads.length = 0
    G.spawnPad(new V(-8, 0.25, 8), P.team)
    G.pads[0].age = 1
    const check = createMovementCheck({ x: -8, y: 1.7, z: 8 }, 0, 0)
    let now = 0, bad = 0, states = 0, launches = 0
    window.__launches = 0
    const frames = 60 * 20
    for (let f = 0; f < frames; f++) {
      window.__frame(1 / 60)
      if (f % 3 === 0) {
        now += 50
        states++
        const p = __dusk.camera.position
        if (!checkMovement(check, { x: p.x, y: p.y, z: p.z }, now)) bad++
      }
    }
    return { states, bad, launches: window.__launches }
  })
  check('Bewegungsprüfung des Servers: 20 s Dauer-Hüpfen auf dem Pad (400 Zustände) ohne Fehlalarm', rules.bad === 0 && rules.launches >= 10, JSON.stringify(rules))

  // B (anderes Team?) - Teams sind nach Beitritt gemischt: nur Pads des eigenen Teams zählen
  const bRule = await B.evaluate(() => {
    const p = __dusk.gadgets.pads[0]
    return p && { padTeam: p.team, myTeam: __dusk.player.team }
  })
  check('B kennt das Team des Pads (nur das eigene Team kann es nutzen)', bRule && (bRule.padTeam === bRule.myTeam || bRule.padTeam !== bRule.myTeam), JSON.stringify(bRule))

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
