// Menüs: Hauptmenü ("Starten"), Waffenauswahl (Primary/Secondary, Messer fest), Einstellungen,
// Pausenmenü ("Weiter" + "Waffenauswahl").
//
//   node tests/menu.mjs
import { startServers, launchBrowser, openGame, wait, createChecks, pickOption } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
const vis = (page, sel) => page.evaluate((s) => !document.querySelector(s).classList.contains('hidden') && getComputedStyle(document.querySelector(s)).display !== 'none', sel)
const overlayHidden = (page) => page.evaluate(() => document.querySelector('#overlay').classList.contains('hidden'))
try {
  const page = await openGame(browser, { online: false, errors })
  await page.setViewportSize({ width: 1280, height: 720 })
  check('Hauptmenü zeigt Starten und Einstellungen, noch kein Weiter', (await vis(page, '#start-button')) && (await vis(page, '#settings-button')) && !(await vis(page, '#resume-button')))
  await page.screenshot({ path: process.env.MENU_SHOT_DIR ? `${process.env.MENU_SHOT_DIR}/menu.png` : '/tmp/menu.png' })

  await page.click('#overlay', { position: { x: 5, y: 5 } })
  await wait(200)
  check('Klick daneben startet vor "Starten" nichts', !(await overlayHidden(page)) && (await vis(page, '#menu-main')))

  await page.click('#settings-button')
  check('Einstellungen öffnen, Hauptmenü weg', (await vis(page, '#menu-settings')) && !(await vis(page, '#menu-main')))
  await page.click('#overlay', { position: { x: 5, y: 5 } })
  await wait(200)
  check('Klick daneben setzt in den Einstellungen nicht fort', !(await overlayHidden(page)))
  await page.click('#settings-back-button')
  check('Fertig führt zurück ins Hauptmenü', (await vis(page, '#menu-main')) && !(await vis(page, '#menu-settings')))

  // Waffenauswahl
  await page.click('#start-button')
  check('Starten öffnet die Waffenauswahl', (await vis(page, '#menu-loadout')) && !(await vis(page, '#menu-main')))
  const cards = await page.evaluate(() => ({
    primary: [...document.querySelectorAll('#loadout-primary .weapon-card')].map((c) => c.dataset.weapon),
    secondary: [...document.querySelectorAll('#loadout-secondary .weapon-card')].map((c) => c.dataset.weapon),
    selected: [...document.querySelectorAll('.weapon-card.selected')].map((c) => c.dataset.weapon),
  }))
  check('Primary: Sturmgewehr, Shotgun, Sniper; Secondary: Pistole, Schwere Pistole, MP', cards.primary.join() === 'rifle,shotgun,sniper' && cards.secondary.join() === 'pistol,heavyPistol,smg', JSON.stringify(cards))
  check('Standard: Sturmgewehr + Pistole ausgewählt', cards.selected.join() === 'rifle,pistol', cards.selected.join())
  check('Messer ist nicht wählbar (nur Hinweis)', !(await page.locator('.weapon-card[data-weapon="knife"]').count()) && (await page.locator('.loadout-note').innerText()).includes('Messer'))

  // Aufklapplisten: zu, bis man klickt; je Slot eine; Wahl klappt zu; Klick daneben klappt zu
  const openCount = () => page.evaluate(() => document.querySelectorAll('.dropdown-list:not(.hidden)').length)
  const summary = (sel) => page.evaluate((s) => document.querySelector(`${s} .dropdown-trigger strong`).textContent, sel)
  check('Drei Aufklapplisten (Primary, Secondary, Gadget), alle zu; Knopf zeigt die Wahl', (await page.locator('.dropdown').count()) === 3 && (await openCount()) === 0 && (await summary('#loadout-primary')) === 'Sturmgewehr' && (await summary('#loadout-secondary')) === 'Pistole', `${await summary('#loadout-primary')} / ${await summary('#loadout-secondary')}`)
  await page.click('#loadout-primary .dropdown-trigger')
  check('Klick öffnet die Liste mit den 3 Primary-Waffen', (await openCount()) === 1 && (await page.locator('#loadout-primary .dropdown-list .weapon-card:visible').count()) === 3)
  await page.click('#loadout-secondary .dropdown-trigger')
  check('Zweite Liste öffnen schließt die erste', (await openCount()) === 1 && (await page.locator('#loadout-secondary .dropdown-list:not(.hidden)').count()) === 1)
  await page.click('#overlay-content h2', { position: { x: 3, y: 3 } })
  check('Klick daneben klappt zu, Spiel startet nicht', (await openCount()) === 0 && !(await overlayHidden(page)))
  await pickOption(page, '.weapon-card[data-weapon="sniper"]')
  check('Wahl klappt die Liste zu, Knopf zeigt Sniper', (await openCount()) === 0 && (await summary('#loadout-primary')) === 'Sniper')
  await pickOption(page, '.weapon-card[data-weapon="smg"]')
  const picked = await page.evaluate(() => [...document.querySelectorAll('.weapon-card.selected')].map((c) => c.dataset.weapon).join())
  check('Wahl wechselt je Slot: Sniper + Maschinenpistole', picked === 'sniper,smg', picked)
  await pickOption(page, '.weapon-card[data-weapon="sniper"]')
  check('Erneut anklicken lässt die Wahl stehen', (await page.locator('.weapon-card.selected').count()) === 2)

  await page.click('#loadout-back-button')
  check('Zurück führt zum Hauptmenü, Spiel nicht gestartet', (await vis(page, '#menu-main')) && !(await overlayHidden(page)) === true)
  await page.click('#start-button')
  const kept = await page.evaluate(() => [...document.querySelectorAll('.weapon-card.selected')].map((c) => c.dataset.weapon).join())
  check('Wahl bleibt beim Zurück/Weiter erhalten', kept === 'sniper,smg', kept)

  await page.click('#loadout-play-button')
  await wait(300)
  check('Spielen startet das Spiel', await overlayHidden(page))
  const held = await page.evaluate(() => ({ slots: __dusk.weapon.slots.join(), current: __dusk.weapon.current, hud: [...document.querySelectorAll('.weapon-slot')].map((e) => e.dataset.weapon).join() }))
  check('Tasten 1/2/3 = Maschinenpistole, Sniper, Messer; Start mit der Secondary', held.slots === 'smg,sniper,knife' && held.current === 'smg' && held.hud === 'smg,sniper,knife', JSON.stringify(held))

  await page.evaluate(() => document.exitPointerLock())
  await wait(300)
  check('ESC/Pointer-Lock-Verlust: Hauptmenü mit Weiter und Waffenauswahl, kein Starten mehr', (await vis(page, '#menu-main')) && (await vis(page, '#resume-button')) && (await vis(page, '#loadout-open-button')) && !(await vis(page, '#start-button')))

  // Mitten im Leben ändern: gilt erst ab dem nächsten Spawn
  await page.click('#loadout-open-button')
  await pickOption(page, '.weapon-card[data-weapon="shotgun"]')
  await page.click('#loadout-play-button')
  await wait(300)
  const mid = await page.evaluate(() => ({ slots: __dusk.weapon.slots.join(), overlayHidden: document.querySelector('#overlay').classList.contains('hidden') }))
  check('Spielen im Pausenmenü setzt fort; die neuen Waffen warten bis zum Respawn', mid.overlayHidden && mid.slots === 'smg,sniper,knife', JSON.stringify(mid))
  await page.evaluate(() => __dusk.player.takeDamage(999))
  // Respawn abwarten (nach ~3 s; auf langsamen Rechnern später)
  await page.waitForFunction(() => __dusk.player.isAlive && __dusk.weapon.slots.join() !== 'smg,sniper,knife', null, { timeout: 15000 }).catch(() => {})
  await wait(300)
  const after = await page.evaluate(() => ({ slots: __dusk.weapon.slots.join(), current: __dusk.weapon.current }))
  check('Nach dem Respawn: Maschinenpistole, Shotgun, Messer; Secondary in der Hand', after.slots === 'smg,shotgun,knife' && after.current === 'smg', JSON.stringify(after))

  // Gemerkt im Browser
  const stored = await page.evaluate(() => localStorage.getItem('duskArena.loadout'))
  check('Auswahl wird im Browser gemerkt', stored === '{"primary":"shotgun","secondary":"smg"}', stored)
  await page.evaluate(() => localStorage.setItem('duskArena.loadout', '{"primary":"knife","secondary":5}'))
  await page.reload()
  await page.waitForFunction(() => 'undefined' !== typeof window.__dusk)
  await page.click('#start-button')
  const fallback = await page.evaluate(() => [...document.querySelectorAll('.weapon-card.selected')].map((c) => c.dataset.weapon).join())
  check('Kaputter Speicher: Standardwaffen', fallback === 'rifle,pistol', fallback)

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
