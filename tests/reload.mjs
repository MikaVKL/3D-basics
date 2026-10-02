// Nachladen und Waffenwechsel: Töne zu den richtigen Zeitpunkten (Ende passt zur
// Nachladezeit), Animation (Kippen beim Nachladen, zweiphasiger Wechsel mit
// Modelltausch am Tiefpunkt), Klick beim Abdrücken während des Nachladens.
//
//   node tests/reload.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(500)

  // Waffen-Update selbst steuern (Headless rendert zu langsam für echte Zeit)
  await page.evaluate(() => {
    const w = __dusk.weapon
    window.__real = w.update.bind(w)
    w.update = () => {}
    window.__sounds = []
    const play = __dusk.sound.play.bind(__dusk.sound)
    __dusk.sound.play = (name, volume) => {
      window.__sounds.push(name)
      play(name, volume)
    }
    window.__step = (dt) => w.update(dt)
    window.__real = (dt) => {
      const real = Object.getPrototypeOf(w).update
      real.call(w, dt)
    }
    window.__take = () => window.__sounds.splice(0)
    window.__visible = () => Object.entries(w.view.models).filter(([, m]) => m.group.visible).map(([id]) => id).join()
  })
  const run = (seconds) =>
    page.evaluate((s) => {
      const out = []
      for (let t = 0; t < s - 1e-9; t += 1 / 60) {
        window.__real(1 / 60)
        const w = __dusk.weapon
        out.push({ reload: w.view.reload, lowered: w.view.lowered, roll: w.view.group.rotation.z, y: w.view.group.position.y, model: window.__visible(), sounds: window.__take() })
      }
      return out
    }, seconds)

  // --- Nachladen (Pistole, 1,2 s) ---
  await page.evaluate(() => { __dusk.weapon.ammo = 3; __dusk.weapon.reload() })
  const start = await page.evaluate(() => window.__take())
  check('Nachladen: beim Start nur das Magazin-löst-Geräusch', start.join() === 'reloadOut', start.join())
  const frames = await run(1.3)
  const all = frames.flatMap((f, i) => f.sounds.map((s) => [s, i / 60]))
  const done = all.find(([s]) => s === 'reloadIn')
  check('Einrast-Ton am Ende der Nachladezeit (1,2 s)', !!done && Math.abs(done[1] - 1.2) < 0.05 && all.length === 1, JSON.stringify(all))
  const maxRoll = Math.min(...frames.map((f) => f.roll))
  const midFrame = frames[Math.round(0.5 * 60)]
  const endFrame = frames[frames.length - 1]
  check('Animation: Waffe kippt zur Seite (Rollwinkel < -0,4) und senkt sich', maxRoll < -0.4 && midFrame.y < -0.31, `Roll ${maxRoll.toFixed(2)}, y in der Mitte ${midFrame.y.toFixed(2)}`)
  check('Animation: danach wieder in der Ausgangslage', Math.abs(endFrame.roll) < 0.01 && endFrame.y > -0.285 && endFrame.reload === 0, `Roll ${endFrame.roll.toFixed(3)}, y ${endFrame.y.toFixed(3)}`)
  const ammo = await page.evaluate(() => __dusk.weapon.ammo)
  check('Magazin nach dem Nachladen voll', ammo === 12, String(ammo))

  // --- Sturmgewehr: längeres Nachladen, Ton am Ende der 2 s ---
  await page.evaluate(() => { __dusk.weapon.switchTo('rifle'); __dusk.weapon.switchRemaining = 0 })
  await run(0.1)
  await page.evaluate(() => window.__take())
  await page.evaluate(() => { __dusk.weapon.ammo = 5; __dusk.weapon.reload() })
  const rifleFrames = await run(2.2)
  const rifleAll = rifleFrames.flatMap((f, i) => f.sounds.map((s) => [s, i / 60]))
  const rifleDone = rifleAll.find(([s]) => s === 'reloadIn')
  check('Sturmgewehr: Einrast-Ton nach 2,0 s (nicht nach 1,2 s)', !!rifleDone && Math.abs(rifleDone[1] - 2) < 0.05, JSON.stringify(rifleAll))

  // --- Abdrücken beim Nachladen: Klick (nur beim Drücken, nicht dauernd) ---
  await page.evaluate(() => { __dusk.weapon.ammo = 5; __dusk.weapon.reload(); window.__take() })
  const pressSounds = await page.evaluate(() => {
    __dusk.weapon.setTrigger(true) // Klick kommt sofort beim Drücken
    return window.__take()
  })
  const held = (await run(0.5)).flatMap((f) => f.sounds)
  await page.evaluate(() => __dusk.weapon.setTrigger(false))
  const clicks = [...pressSounds, ...held].filter((s) => s === 'dryFire').length
  check('Abdrücken beim Nachladen: genau ein Klick (auch bei gehaltener Taste)', clicks === 1, `${clicks} Klicks`)
  await run(2)
  await page.evaluate(() => window.__take())
  await page.evaluate(() => __dusk.weapon.setTrigger(true))
  await page.evaluate(() => __dusk.weapon.setTrigger(false))
  check('Abdrücken ohne Nachladen: kein Klick (es wird geschossen)', !(await page.evaluate(() => window.__take())).includes('dryFire'))

  // --- Waffenwechsel: zweiphasig ---
  await page.evaluate(() => { __dusk.weapon.switchTo('pistol'); __dusk.weapon.switchRemaining = 0; })
  await run(0.1)
  await page.evaluate(() => { window.__take(); __dusk.weapon.switchTo('rifle') })
  const switchStart = await page.evaluate(() => window.__visible())
  check('Wechsel beginnt: altes Modell (Pistole) bleibt zunächst sichtbar', switchStart === 'pistol', switchStart)
  const sw = await run(0.35)
  const swSounds = sw.flatMap((f, i) => f.sounds.map((s) => [s, i / 60]))
  const drawAt = swSounds.find(([s]) => s === 'drawGun')
  const swapIndex = sw.findIndex((f) => f.model === 'rifle')
  check('Zieh-Ton genau einmal, am Tiefpunkt (~0,15 s)', swSounds.length === 1 && !!drawAt && Math.abs(drawAt[1] - 0.15) < 0.04, JSON.stringify(swSounds))
  check('Modell wechselt am Tiefpunkt (nicht am Anfang)', swapIndex > 5 && Math.abs(swapIndex / 60 - 0.15) < 0.04, `Bild ${swapIndex}`)
  const lows = sw.map((f) => f.lowered)
  const peak = Math.max(...lows)
  check('Absenken -> Tiefpunkt (1) -> wieder hoch (0)', peak > 0.95 && lows[0] < 0.3 && lows[lows.length - 1] < 0.01, `max ${peak.toFixed(2)}, Anfang ${lows[0].toFixed(2)}, Ende ${lows.at(-1).toFixed(2)}`)
  const sides = sw.map((f) => f.roll)
  check('Waffe kippt beim Wechsel zur Seite und kommt zurück', Math.max(...sides) > 0.2 && Math.abs(sides.at(-1)) < 0.01, `max ${Math.max(...sides).toFixed(2)}`)

  // --- Messer: eigener Ton ---
  await page.evaluate(() => { window.__take(); __dusk.weapon.switchTo('knife') })
  const knife = (await run(0.35)).flatMap((f) => f.sounds)
  check('Messer ziehen: Messer-Ton statt Klick', knife.join() === 'drawKnife', knife.join())

  // --- Respawn: Modell sofort, kein Ton ---
  await page.evaluate(() => { __dusk.weapon.switchTo('rifle'); window.__take() })
  await page.evaluate(() => __dusk.weapon.resetLoadout())
  const afterReset = await page.evaluate(() => ({ model: window.__visible(), sounds: window.__take() }))
  check('Respawn: Pistole sofort sichtbar, kein Zieh-Ton', afterReset.model === 'pistol' && !afterReset.sounds.includes('drawGun'), JSON.stringify(afterReset))

  // --- Wechsel mitten im Nachladen bricht ab (kein Einrast-Ton) ---
  await page.evaluate(() => { __dusk.weapon.switchRemaining = 0 })
  await run(0.1)
  await page.evaluate(() => { __dusk.weapon.ammo = 4; __dusk.weapon.reload(); window.__take() })
  await run(0.3)
  await page.evaluate(() => __dusk.weapon.switchTo('rifle'))
  const aborted = (await run(1.6)).flatMap((f) => f.sounds)
  check('Wechsel beim Nachladen: Nachladen abgebrochen, kein Einrast-Ton', !aborted.includes('reloadIn'), aborted.join())
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
