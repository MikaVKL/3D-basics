// Verbindungswarnung: erscheint nur bei echter Stille (Server eingefroren),
// verschwindet danach wieder; das Spiel läuft nach dem Einfrieren normal weiter.
//
//   node tests/connection.mjs
import { startServers, launchBrowser, openGame, play, shootAt, teleport, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const browser = await launchBrowser()
const errors = []
const warningVisible = (page) => page.evaluate(() => !document.querySelector('#connection-warning').classList.contains('hidden'))
// Wie oft war die Warnung in dieser Zeit sichtbar? (alle 100 ms geprüft)
const sampleWarning = (page, ms) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        let shown = 0
        const timer = setInterval(() => {
          if (!document.querySelector('#connection-warning').classList.contains('hidden')) shown++
        }, 100)
        setTimeout(() => {
          clearInterval(timer)
          resolve(shown)
        }, duration)
      }),
    ms
  )

try {
  for (const env of [{}, { SIMULATED_LATENCY_MS: '150', SIMULATED_JITTER_MS: '30' }]) {
    const label = env.SIMULATED_LATENCY_MS ? 'mit 150 ms Ping' : 'ohne Verzögerung'
    const servers = await startServers({ serverEnv: env })
    try {
      const A = await openGame(browser, { name: 'Anna', errors })
      const B = await openGame(browser, { name: 'Ben', errors })
      await play(A)
      await play(B)
      await wait(4000)
      check(`normales Spiel (${label}): keine Warnung`, (await sampleWarning(A, 6000)) === 0)

      if (!env.SIMULATED_LATENCY_MS) {
        servers.signalServer('SIGSTOP')
        await wait(700)
        const early = await warningVisible(A)
        await wait(1800)
        const frozen = await warningVisible(A)
        servers.signalServer('SIGCONT')
        await wait(1500)
        const after = await warningVisible(A)
        check('Server eingefroren: Warnung erst nach ~1,5 s', !early && frozen, `0,7 s: ${early}, 2,5 s: ${frozen}`)
        check('Server läuft weiter: Warnung weg', !after)
        const status = await A.evaluate(() => [__dusk.network.status, __dusk.network.playerCount])
        check('nach dem Einfrieren weiter online, beide Spieler da', status[0] === 'online' && status[1] === 2, JSON.stringify(status))

        // Server reagiert wieder: Treffer zählt
        await teleport(B, 0, 1.7, 5)
        await teleport(A, 0, 1.7, 10)
        await wait(800)
        await shootAt(A, [0, 0.9, 5])
        await wait(600)
        const shield = await B.evaluate(() => __dusk.player.vitals.shield)
        check('nach dem Einfrieren zählen Treffer', shield === 5, `Schild ${shield}`)
      }
      await A.close()
      await B.close()
    } finally {
      servers.stop()
      await wait(500)
    }
  }
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  finish()
}
