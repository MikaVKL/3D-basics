// Verbindungswarnung: erscheint nur bei echter Stille (Server eingefroren),
// verschwindet danach wieder; das Spiel läuft nach dem Einfrieren normal weiter.
// Beitritt während des Singleplayers (Server wacht später auf) und Server-
// Neustart: Sprung zum Spawn mit Abblenden und Hinweis statt kommentarlos.
//
//   node tests/connection.mjs
import { spawn } from 'node:child_process'
import { startServers, launchBrowser, openGame, play, shootAt, teleport, wait, createChecks, SERVER_PORT } from './lib.mjs'

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
  // Server erst später erreichbar (Aufwachen), dann Neustart (Update)
  const viteOnly = await startServers({ gameServer: false })
  const startGameServer = () => spawn('node', ['server/index.ts'], { env: { ...process.env, PORT: String(SERVER_PORT) }, stdio: 'ignore' })
  let gameServer = null
  try {
    const page = await openGame(browser, { name: 'Mika', errors })
    await play(page)
    await wait(1500)
    await teleport(page, -10, 1.7, 3)
    // Hinweise und Abblenden über die Zeit mitschreiben
    await page.evaluate(() => {
      window.__notices = []
      window.__fades = 0
      new MutationObserver(() => {
        const banner = document.querySelector('#notice-banner')
        if (!banner.classList.contains('hidden')) window.__notices.push(banner.textContent)
      }).observe(document.querySelector('#notice-banner'), { attributes: true, childList: true, characterData: true, subtree: true })
      new MutationObserver(() => {
        if (document.querySelector('#screen-fade').classList.contains('active')) window.__fades++
      }).observe(document.querySelector('#screen-fade'), { attributes: true })
    })
    const singleplayer = await page.evaluate(() => __dusk.network.status)
    gameServer = startGameServer()
    await wait(18000)
    const joined = await page.evaluate(() => ({
      status: __dusk.network.status,
      pos: __dusk.camera.position.toArray(),
      notices: [...new Set(window.__notices)],
      fades: window.__fades,
    }))
    check('Singleplayer, solange der Server fehlt', singleplayer !== 'online', singleplayer)
    check('Server wacht auf: beigetreten, am Spawn', joined.status === 'online' && Math.hypot(joined.pos[0] + 10, joined.pos[2] - 3) > 3, JSON.stringify(joined.pos))
    check('Beitritt mit Abblenden und Hinweis', joined.fades >= 1 && joined.notices.some((n) => n.startsWith('Online-Runde beigetreten')), JSON.stringify(joined))

    await page.evaluate(() => (window.__notices = []))
    gameServer.kill()
    await wait(1500)
    gameServer = startGameServer()
    await wait(18000)
    const rejoined = await page.evaluate(() => ({ status: __dusk.network.status, notices: [...new Set(window.__notices)] }))
    check('Server-Neustart: Hinweis "Verbindung verloren"', rejoined.notices.some((n) => n.startsWith('Verbindung zum Server verloren')), JSON.stringify(rejoined.notices))
    check('danach automatisch wieder beigetreten (mit Hinweis)', rejoined.status === 'online' && rejoined.notices.some((n) => n.startsWith('Online-Runde beigetreten')), JSON.stringify(rejoined))

    // Menü: kein Hinweis beim bewussten Verlassen
    await page.evaluate(() => {
      window.__notices = []
      document.exitPointerLock()
    })
    await wait(21500)
    check('Verlassen über das Menü: kein Verbindungs-Hinweis', !(await page.evaluate(() => window.__notices.some((n) => n.startsWith('Verbindung')))))
  } finally {
    gameServer?.kill()
    viteOnly.stop()
  }
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  finish()
}
