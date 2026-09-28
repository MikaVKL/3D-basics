// Ping-Anzeige: Messwert plausibel (ohne und mit simuliertem Ping), Farbe,
// ausgeblendet ohne Verbindung.
//
//   node tests/ping.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const browser = await launchBrowser()
const errors = []
const readPing = (page) =>
  page.evaluate(() => {
    const element = document.querySelector('#net-ping')
    return { text: element.textContent, quality: element.dataset.quality, value: __dusk.network.ping }
  })

try {
  for (const latency of [0, 200]) {
    const servers = await startServers({ serverEnv: { SIMULATED_LATENCY_MS: String(latency) } })
    try {
      const page = await openGame(browser, { name: 'Pia', errors })
      await play(page)
      await wait(latency ? 7000 : 5000) // Beitritt + einige Messungen
      const p = await readPing(page)
      if (latency === 0) {
        check('Ping ohne Verzögerung angezeigt und klein', p.value !== null && p.value < 50 && p.text === ` · ${p.value} ms` && p.quality === 'good', JSON.stringify(p))
      } else {
        check('Ping mit 200 ms simuliert: ~200 ms, rot', p.value >= 190 && p.value < 300 && p.quality === 'bad', JSON.stringify(p))
      }
      if (latency === 0) {
        // Menü + 20 s -> Spiel verlassen: keine Anzeige mehr
        await page.evaluate(() => document.exitPointerLock())
        await wait(21500)
        const left = await readPing(page)
        check('nach Verlassen: keine Ping-Anzeige', left.text === '' && left.value === null, JSON.stringify(left))
      }
      await page.close()
    } finally {
      servers.stop()
      await wait(500)
    }
  }
  const offline = await openGame(browser, { online: false, errors })
  await play(offline)
  await wait(1500)
  check('Singleplayer: keine Ping-Anzeige', (await readPing(offline)).text === '')
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  finish()
}
