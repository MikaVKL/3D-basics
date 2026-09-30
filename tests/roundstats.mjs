// Rundenende-Statistik: Sieger + Liste (Rang/Stern, Name in Teamfarbe, Kills,
// Tode, Kopftreffer), eigene Zeile markiert, auch für Nachzügler; danach
// beginnt die nächste Runde ohne Altlasten.
//
//   node tests/roundstats.mjs
import { startServers, launchBrowser, openGame, play, shootAt, teleport, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ serverEnv: { KILLS_TO_WIN: '2' } })
const browser = await launchBrowser()
const errors = []

const banner = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('#round-banner')
    return {
      visible: !el.classList.contains('hidden'),
      cls: el.className,
      winner: document.querySelector('#round-winner').textContent,
      countdown: document.querySelector('#round-countdown').textContent,
      rows: [...document.querySelectorAll('#round-stats .round-stat-row')].map((row) => ({
        cls: row.className,
        cells: [...row.children].map((c) => c.textContent),
      })),
    }
  })

// B abschießen: 3 Kopftreffer (je 40) + 1 Körpertreffer (20) = 140 >= 125 (Schild + Leben)
async function kill(A, B) {
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 10)
  await wait(700)
  for (const target of [[0, 1.7, 5], [0, 1.7, 5], [0, 1.7, 5], [0, 0.9, 5]]) {
    await shootAt(A, target)
    await wait(350) // Ratenlimit des Servers
  }
  await wait(600)
}

try {
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A)
  await play(B)
  await wait(3800) // Beitritt + Spawn-Schutz

  await kill(A, B)
  await B.waitForFunction(() => __dusk.player.isAlive, null, { timeout: 15000 })
  await wait(2600) // Spawn-Schutz
  await kill(A, B)
  await wait(800)

  const a = await banner(A)
  const b = await banner(B)
  check('Banner sichtbar mit Sieger', a.visible && /gewinnt/.test(a.winner), `${a.winner} (${a.cls})`)
  check('Countdown zeigt bis zu 10 s', /\d+/.test(a.countdown) && Number(a.countdown.match(/\d+/)[0]) > 6, a.countdown)
  check('Liste: Kopfzeile + 2 Spieler', a.rows.length === 3 && a.rows[0].cls.includes('header'), JSON.stringify(a.rows.map((r) => r.cells)))
  const [, first, second] = a.rows
  check('Bester zuerst, mit Stern: Anna 2 Kills / 0 Tode / 6 Kopftreffer', first?.cells.join('|') === '★|Anna|2|0|6' && first.cls.includes('mvp'), JSON.stringify(first))
  check('Zweiter: Ben 0 / 2 / 0', second?.cells.join('|') === '2|Ben|0|2|0', JSON.stringify(second))
  check('Namen in Teamfarbe (verschiedene Teams)', first.cls.includes('red') !== second.cls.includes('red') && (first.cls + second.cls).includes('blue'), `${first.cls} / ${second.cls}`)
  check('eigene Zeile markiert (bei jedem die eigene)', first.cls.includes('own') && !second.cls.includes('own') && b.rows[2].cls.includes('own') && !b.rows[1].cls.includes('own'))

  // Nachzügler sieht die Statistik ebenfalls
  const C = await openGame(browser, { name: 'Cleo', errors })
  await play(C)
  await wait(1500)
  const c = await banner(C)
  check('Nachzügler sieht die Statistik', c.visible && c.rows.length === 3, `${c.rows.length} Zeilen`)

  // Nächste Runde
  await A.waitForFunction(() => document.querySelector('#round-banner').classList.contains('hidden'), null, { timeout: 15000 })
  await wait(500)
  const after = await A.evaluate(() => [...__dusk.network.roster.values()].map((p) => `${p.name}:${p.kills}/${p.deaths}`).join())
  check('nächste Runde: Banner weg, Zähler wieder 0', /Anna:0\/0/.test(after) && /Ben:0\/0/.test(after), after)
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
