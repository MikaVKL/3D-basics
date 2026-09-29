// Hintergrund-Tab: sendet den Zustand nur ~1x pro Sekunde, danach wieder
// mit voller Rate; die anderen sehen den Spieler weiter.
//
//   node tests/background.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const browser = await launchBrowser()
const errors = []
const servers = await startServers()
try {
  const a = await openGame(browser, { name: 'Ada', errors })
  const b = await openGame(browser, { name: 'Bob', errors })
  await play(a)
  await play(b)
  await wait(3000)

  let sent = 0
  a.on('websocket', () => {})
  const cdp = await a.context().newCDPSession(a)
  await cdp.send('Network.enable')
  cdp.on('Network.webSocketFrameSent', (e) => {
    if (String(e.response.payloadData).includes('"t":"state"')) sent++
  })
  const setHidden = (hidden) =>
    a.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h })
      document.dispatchEvent(new Event('visibilitychange'))
    }, hidden)
  const measure = async (ms) => {
    sent = 0
    await wait(ms)
    return sent / (ms / 1000)
  }

  const visibleRate = await measure(3000)
  await setHidden(true)
  await wait(300)
  const hiddenRate = await measure(6000)
  const stillThere = await b.evaluate(() => __dusk.remotePlayers.players.size)
  await setHidden(false)
  await wait(300)
  const backRate = await measure(3000)

  check('sichtbar: volle Rate', visibleRate >= 8, `${visibleRate.toFixed(1)} Zustände/s`)
  check('versteckt: ca. 1 pro Sekunde', hiddenRate >= 0.5 && hiddenRate <= 2, `${hiddenRate.toFixed(1)} Zustände/s`)
  check('versteckter Spieler bleibt für andere sichtbar', stillThere === 1, `${stillThere} fremde Spieler`)
  check('wieder sichtbar: volle Rate', backRate >= 8, `${backRate.toFixed(1)} Zustände/s`)
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
