// Effekte: Mündungsleuchten, Einschlagfunken, Todeseffekt, Kamera-Ruck -
// ausgelöst an den richtigen Stellen und danach wieder aufgeräumt.
//
//   node tests/effects.mjs
import { startServers, launchBrowser, openGame, play, shootAt, teleport, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []

// Zählt Effekt-Aufrufe einer Seite in window.__fx
const spyEffects = (page) =>
  page.evaluate(() => {
    window.__fx = []
    for (const name of ['muzzleFlash', 'impactSparks', 'deathBurst']) {
      const original = __dusk.effects[name].bind(__dusk.effects)
      __dusk.effects[name] = (...args) => {
        window.__fx.push(name)
        original(...args)
      }
    }
    const shake = __dusk.cameraShake.shake.bind(__dusk.cameraShake)
    __dusk.cameraShake.shake = (strength, duration) => {
      window.__fx.push(strength > 0.1 ? 'shakeStrong' : 'shake')
      shake(strength, duration)
    }
  })
const takeEffects = (page) =>
  page.evaluate(() => {
    const list = window.__fx
    window.__fx = []
    return list.sort().join()
  })

try {
  // --- Singleplayer ---
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(300)
  await spyEffects(page)
  await teleport(page, 0, 1.7, 12)
  await wait(200)
  await takeEffects(page)
  await shootAt(page, [0, 1.7, 30]) // Richtung Süd-Wand
  check('Schuss an die Wand: Leuchten + Funken', (await takeEffects(page)) === 'impactSparks,muzzleFlash')
  await shootAt(page, [0, 60, 12]) // senkrecht in den Himmel
  check('Schuss ins Leere: nur Leuchten', (await takeEffects(page)) === 'muzzleFlash')
  await wait(1200)
  check('Effekte räumen sich auf', (await page.evaluate(() => __dusk.effects.count)) === 0)

  // 200 Einschläge im selben Moment (wie Dauerfeuer vieler Spieler)
  const capped = await page.evaluate(() => {
    for (let i = 0; i < 200; i++) __dusk.effects.impactSparks(__dusk.camera.position.clone())
    return __dusk.effects.count
  })
  check('Obergrenze bei Dauerfeuer', capped === 60, `${capped} gleichzeitig`)
  await wait(1200)

  await teleport(page, 3, 1.7, -2) // vor dem Dummy bei (3, 0.8, -6)
  await wait(200)
  await takeEffects(page)
  for (let i = 0; i < 9; i++) await shootAt(page, [3, 0.8, -6])
  check('Dummy-Kill: Todeseffekt', (await takeEffects(page)).includes('deathBurst'))
  await wait(1800)
  check('Todeseffekt verschwindet wieder', (await page.evaluate(() => __dusk.effects.count)) === 0)

  // --- Mehrspieler ---
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A)
  await play(B)
  await wait(3800)
  await spyEffects(A)
  await spyEffects(B)
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 10)
  await wait(600)
  await takeEffects(A)
  await takeEffects(B)
  await shootAt(A, [0, 0.9, 5])
  await wait(500)
  const bSees = await takeEffects(B)
  check('Getroffener: fremdes Leuchten + Funken + Kamera-Ruck', bSees === 'impactSparks,muzzleFlash,shake', bSees)
  for (let i = 0; i < 8; i++) {
    await shootAt(A, [0, 0.9, 5])
    await wait(150)
  }
  await wait(600)
  check('Schütze sieht Todeseffekt des Gegners', (await takeEffects(A)).includes('deathBurst'))
  check('eigener Tod: starker Kamera-Ruck', (await takeEffects(B)).includes('shakeStrong'))
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
