// Pausenmenü: Weiter + Einstellungen (Minecraft-Aufbau)
//
//   node tests/menu.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
const vis = (page, sel) => page.evaluate((s) => !document.querySelector(s).classList.contains('hidden') && getComputedStyle(document.querySelector(s)).display !== 'none', sel)
try {
  const page = await openGame(browser, { online: false, errors })
  check('Menü zeigt Weiter und Einstellungen', (await vis(page, '#resume-button')) && (await vis(page, '#settings-button')))
  await page.screenshot({ path: process.env.MENU_SHOT_DIR ? `${process.env.MENU_SHOT_DIR}/menu.png` : '/tmp/menu.png' })

  await page.click('#settings-button')
  check('Einstellungen öffnen, Hauptmenü weg', (await vis(page, '#menu-settings')) && !(await vis(page, '#menu-main')))
  await page.click('#overlay', { position: { x: 5, y: 5 } })
  await wait(200)
  check('Klick daneben setzt in den Einstellungen nicht fort', await page.evaluate(() => !document.querySelector('#overlay').classList.contains('hidden')))
  await page.click('#settings-back-button')
  check('Fertig führt zurück ins Hauptmenü', (await vis(page, '#menu-main')) && !(await vis(page, '#menu-settings')))

  await page.click('#resume-button')
  await wait(300)
  check('Weiter startet das Spiel', await page.evaluate(() => document.querySelector('#overlay').classList.contains('hidden')))

  await page.evaluate(() => document.exitPointerLock())
  await wait(300)
  check('ESC/Pointer-Lock-Verlust zeigt wieder das Hauptmenü', (await vis(page, '#menu-main')) && (await vis(page, '#resume-button')))
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
