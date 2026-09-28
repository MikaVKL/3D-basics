// HUD: Lebensanzeige (Werte, Aufblitzen bei Schaden, Pulsieren bei wenig
// Leben), Layout ohne Überlappungen in verschiedenen Bildschirmgrößen.
//
//   node tests/hud.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []

const bars = (page) =>
  page.evaluate(() => ({
    health: document.querySelector('#health-text').textContent,
    shield: document.querySelector('#shield-text').textContent,
    healthFlash: document.querySelector('#health-bar-fill').classList.contains('flash'),
    shieldFlash: document.querySelector('#shield-bar-fill').classList.contains('flash'),
    low: document.querySelector('#health-bar-fill').classList.contains('low'),
  }))
// Klassen wechseln pro Bild - über mehrere Bilder beobachten
const watchFlash = (page, ms) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const seen = { health: false, shield: false }
        const start = performance.now()
        const tick = () => {
          seen.health ||= document.querySelector('#health-bar-fill').classList.contains('flash')
          seen.shield ||= document.querySelector('#shield-bar-fill').classList.contains('flash')
          if (performance.now() - start < duration) requestAnimationFrame(tick)
          else resolve(seen)
        }
        tick()
      }),
    ms
  )

try {
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(500)
  await page.evaluate(() => (__dusk.player.vitals.shieldRegenCooldown = 999))
  let b = await bars(page)
  check('Start: Leben 100, Schild 25, kein Blitzen', b.health === '100' && b.shield === '25' && !b.healthFlash && !b.shieldFlash && !b.low, JSON.stringify(b))

  // 15 Schaden: nur der Schild blitzt (Leben bleibt voll)
  let flash = watchFlash(page, 400)
  await page.evaluate(() => __dusk.player.takeDamage(15))
  let seen = await flash
  b = await bars(page)
  check('Schaden am Schild: Schild blitzt, Leben nicht', seen.shield && !seen.health, JSON.stringify(seen))
  check('Werte danach: Schild 10, Leben 100', b.shield === '10' && b.health === '100', JSON.stringify(b))
  check('Blitzen hört wieder auf', !b.healthFlash && !b.shieldFlash)

  // 30 Schaden: Schild leer, Leben blitzt
  flash = watchFlash(page, 400)
  await page.evaluate(() => __dusk.player.takeDamage(30))
  seen = await flash
  b = await bars(page)
  check('Schaden am Leben: Leben blitzt', seen.health, JSON.stringify(seen))
  check('Werte danach: Schild 0, Leben 80', b.shield === '0' && b.health === '80', JSON.stringify(b))

  // Wenig Leben pulsiert (<= 30), vorher nicht
  await page.evaluate(() => __dusk.player.takeDamage(49))
  await wait(200)
  const at31 = await bars(page)
  await page.evaluate(() => __dusk.player.takeDamage(1))
  await wait(200)
  const at30 = await bars(page)
  check('Pulsieren erst ab 30 Leben', !at31.low && at30.low, `31: ${at31.low}, 30: ${at30.low}`)

  // Tod: kein Pulsieren, nach Respawn voll und ruhig
  await page.evaluate(() => __dusk.player.takeDamage(999))
  await wait(300)
  const dead = await bars(page)
  check('tot: kein Pulsieren', !dead.low, JSON.stringify(dead))
  flash = watchFlash(page, 3800)
  seen = await flash
  b = await bars(page)
  check('Respawn: Leben 100, Schild 25', b.health === '100' && b.shield === '25', JSON.stringify(b))
  check('Respawn/Tod lösen kein Blitzen aus', !seen.health && !seen.shield, JSON.stringify(seen))
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
