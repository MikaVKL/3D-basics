// Einstellung "Zielen umschalten": Halten (Standard) zielt nur solange die rechte Taste unten ist,
// Umschalten zielt nach dem Loslassen weiter und beendet das Zielen beim nächsten Rechtsklick (Touchpad).
//
//   node tests/aim-toggle.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(500)
  const mouse = (type, button) =>
    page.evaluate(([t, b]) => document.dispatchEvent(new MouseEvent(t, { button: b, bubbles: true })), [type, button])
  await page.evaluate(() => Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement }))
  const wanted = () => page.evaluate(() => __dusk.weapon.aimRequested)

  check('Standard: Halten', (await page.evaluate(() => document.querySelector('#setting-aimtoggle').checked)) === false)
  await mouse('mousedown', 2)
  check('Halten: Taste unten = zielen', await wanted())
  await mouse('mouseup', 2)
  check('Halten: losgelassen = nicht mehr zielen', !(await wanted()))

  await page.evaluate(() => document.querySelector('#setting-aimtoggle').click())
  const stored = await page.evaluate(() => ({ s: JSON.parse(localStorage.getItem('duskArena.settings')).aimToggle, label: document.querySelector('#setting-aimtoggle-value').textContent }))
  check('Umschalten wird gemerkt', stored.s === true && stored.label === 'Umschalten', JSON.stringify(stored))

  await mouse('mousedown', 2)
  await mouse('mouseup', 2)
  check('Umschalten: Klick zielt, auch nach dem Loslassen', await wanted())
  await mouse('mousedown', 0)
  await mouse('mouseup', 0)
  check('Umschalten: Schießen (links) beendet das Zielen nicht', await wanted())
  await mouse('mousedown', 2)
  await mouse('mouseup', 2)
  check('Umschalten: zweiter Rechtsklick beendet das Zielen', !(await wanted()))

  // Zielen läuft weiter, bis man es abschaltet; Tod/Menü beenden es (cancelFire)
  await mouse('mousedown', 2)
  await mouse('mouseup', 2)
  await page.evaluate(() => __dusk.weapon.cancelFire())
  check('Menü/Tod beendet das Zielen auch im Umschalt-Modus', !(await wanted()))
  await mouse('mousedown', 2)
  await mouse('mouseup', 2)
  check('danach zielt der nächste Klick wieder an', await wanted())
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
