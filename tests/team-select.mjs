// Teamauswahl im Startmenü: Karten mit Spielerzahl vom Server, Wunsch wird erfüllt, solange die Teams
// ausgeglichen bleiben (Abstand höchstens 2, sonst kommt man ins kleinere), Auswahl bleibt gemerkt.
//
//   node tests/team-select.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
const team = (page) => page.evaluate(() => __dusk.player.team)
const counts = (page) => page.evaluate(() => [...document.querySelectorAll('.team-card')].map((c) => c.querySelector('.team-card-count').textContent).join('|'))
try {
  const A = await openGame(browser, { name: 'Anna', errors })
  await A.click('#start-button')
  check('Starten öffnet die Teamauswahl mit Rot, Blau, Automatisch', (await A.locator('#menu-team').isVisible()) && (await A.locator('.team-card').count()) === 3)
  await wait(800)
  check('Leerer Server: 0 Spieler in beiden Teams', (await counts(A)).startsWith('0 Spieler|0 Spieler'), await counts(A))
  check('Standard ist Automatisch', (await A.locator('.team-card[data-team="auto"].selected').count()) === 1)
  await A.click('.team-card[data-team="blue"]')
  check('Blau auswählbar', (await A.locator('.team-card[data-team="blue"].selected').count()) === 1 && (await A.locator('.team-card.selected').count()) === 1)
  await A.click('#team-next-button')
  await A.click('#loadout-play-button')
  await wait(2500)
  check('Wunsch Blau erfüllt', (await team(A)) === 'blue', await team(A))

  // B: Menü zeigt 1 Spieler in Blau
  const B = await openGame(browser, { name: 'Ben', errors })
  await B.click('#start-button')
  await wait(800)
  check('B sieht Anna: Rot 0, Blau 1', (await counts(B)).startsWith('0 Spieler|1 Spieler'), await counts(B))
  // B will auch Blau: 0:2 wäre Abstand 2 -> erlaubt
  await B.click('.team-card[data-team="blue"]')
  await B.click('#team-next-button')
  await B.click('#loadout-play-button')
  await wait(2500)
  check('Wunsch Blau erlaubt bis Abstand 2 (0:2)', (await team(B)) === 'blue', await team(B))

  // C wünscht Blau: 0:3 wäre Abstand 3 -> Rot; Auswahl bleibt nach Neuladen gemerkt
  const C = await openGame(browser, { name: 'Cara', errors })
  await C.click('#start-button')
  await C.click('.team-card[data-team="blue"]')
  await C.reload()
  await C.waitForFunction(() => typeof window.__dusk !== 'undefined')
  await C.click('#start-button')
  check('Auswahl bleibt nach Neuladen gemerkt', (await C.locator('.team-card[data-team="blue"].selected').count()) === 1)
  await C.click('#team-back-button')
  check('Zurück führt zum Hauptmenü', await C.locator('#menu-main').isVisible())
  await C.click('#start-button')
  await C.click('#team-next-button')
  await C.click('#loadout-play-button')
  await wait(2500)
  check('Wunsch Blau bei Abstand 3 abgelehnt: C kommt ins kleinere (Rot)', (await team(C)) === 'red', await team(C))
  // D (automatisch) kommt ins kleinere Team: Rot 1 gegen Blau 2 -> Rot (2:2)
  const D = await openGame(browser, { name: 'Dora', errors })
  await play(D)
  await wait(2500)
  check('Automatisch: D kommt ins kleinere Team (Rot)', (await team(D)) === 'red', await team(D))
  check('Keine Konsolenfehler', errors.length === 0, errors.join('; '))
} finally {
  await browser.close()
  servers.stop()
}
finish()
