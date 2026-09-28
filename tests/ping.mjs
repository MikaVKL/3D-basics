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
      // Zweiter Spieler: beide sehen den Ping des anderen in der Tabelle
      const other = await openGame(browser, { name: 'Otto', errors })
      let rosterMessages = 0
      other.on('websocket', (ws) => ws.on('framereceived', (frame) => {
        if (String(frame.payload).includes('"t":"roster"')) rosterMessages++
      }))
      await play(other)
      await wait(latency ? 9000 : 7000)
      await other.keyboard.down('Tab')
      await wait(300)
      const rows = await other.evaluate(() =>
        [...document.querySelectorAll('.score-row:not(.header)')].map((row) => [...row.children].map((c) => c.textContent))
      )
      await other.keyboard.up('Tab')
      // Headless blockiert das Software-Rendering zweier Browser den
      // Haupt-Thread 50-100 ms pro Bild - das steckt in jeder Messung. Die
      // Tabelle muss daher zeigen, was der jeweilige Client selbst misst
      // (Spielerliste folgt erst ab 15 % Änderung), nicht einen festen Wert.
      const own = { Pia: (await readPing(page)).value, Otto: (await readPing(other)).value }
      const matchesOwn = rows.every((r) => {
        const shown = Number(r[3])
        return shown >= latency && shown < latency + 200 && Math.abs(shown - own[r[0]]) <= Math.max(20, own[r[0]] * 0.35)
      })
      check(`Tabelle zeigt Ping beider Spieler (${latency} ms simuliert)`, rows.length === 2 && matchesOwn, `${JSON.stringify(rows)}, selbst gemessen ${JSON.stringify(own)}`)
      // Stabiler Ping: Liste nicht alle 2 s neu verschicken (das wären 5 in 10 s)
      const before = rosterMessages
      await wait(10000)
      check(`Spielerliste bei stabilem Ping selten verschickt (${latency} ms)`, rosterMessages - before <= 3, `${rosterMessages - before} in 10 s`)
      await other.close()
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
  // Eigener Vite-Start: die Server der Schleife sind schon gestoppt (früher
  // lief hier unbemerkt ein verwaister Vite weiter)
  const viteOnly = await startServers({ gameServer: false })
  try {
    const offline = await openGame(browser, { online: false, errors })
    await play(offline)
    await wait(1500)
    check('Singleplayer: keine Ping-Anzeige', (await readPing(offline)).text === '')
  } finally {
    viteOnly.stop()
  }
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  finish()
}
