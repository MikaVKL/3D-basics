// FPS-Anzeige neben dem Ping: erscheint, entspricht den echten Frames, Farbe folgt dem Wert.
//
//   node tests/fps.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(1500)
  const read = () =>
    page.evaluate(() => ({
      text: document.querySelector('#net-fps').textContent,
      quality: document.querySelector('#net-fps').dataset.quality,
      fps: __dusk.getFps(),
    }))
  const shown = await read()
  check('Anzeige "N FPS" im Statusfeld, Wert = Spielzähler', /^ · \d+ FPS$/.test(shown.text) && shown.text === ` · ${shown.fps} FPS`, JSON.stringify(shown))
  const quality = shown.fps >= 45 ? 'good' : shown.fps >= 25 ? 'ok' : 'bad'
  check('Farbe folgt dem Wert (>= 45 grün, >= 25 gelb, sonst rot)', shown.quality === quality, JSON.stringify(shown))

  // Gegenprobe: eigene Zählung der Frames über 2 s
  const counted = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0
        const start = performance.now()
        const tick = () => {
          frames++
          if (performance.now() - start < 2000) requestAnimationFrame(tick)
          else resolve({ measured: Math.round((frames * 1000) / (performance.now() - start)), shown: __dusk.getFps() })
        }
        requestAnimationFrame(tick)
      })
  )
  check('Angezeigte Bildrate weicht höchstens 30 % von einer eigenen Messung ab', Math.abs(counted.shown - counted.measured) <= Math.max(2, counted.measured * 0.3), JSON.stringify(counted))
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
