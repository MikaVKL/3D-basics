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

    // Kisten: 1.4m bei (15,-8) erkletterbar, 2.4m bei (3,-9) nicht
    place(15, -5, 0)
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
} finally {
  await browser.close()
  servers.stop()
  finish()
}
