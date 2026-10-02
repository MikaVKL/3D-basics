// Einstellungen im Menü: Regler für Empfindlichkeit, Blickfeld und
// Lautstärke wirken sofort, werden gemerkt und vertragen kaputte Speicherwerte.
//
//   node tests/settings.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []

const setSlider = (page, key, value) =>
  page.evaluate(([k, v]) => {
    const slider = document.querySelector(`#setting-${k}`)
    slider.value = String(v)
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  }, [key, value])
const readUi = (page) =>
  page.evaluate(() => {
    const out = {}
    for (const key of ['sensitivity', 'fov', 'volume', 'music']) {
      out[key] = { value: Number(document.querySelector(`#setting-${key}`).value), label: document.querySelector(`#setting-${key}-value`).textContent }
    }
    return out
  })
const yawPer100px = (page) =>
  page.evaluate(() => {
    const look = __dusk.lookControl
    const before = look.euler.y
    look.rotate(100, 0)
    const delta = before - look.euler.y
    look.euler.y = before
    return delta
  })

try {
  let page = await openGame(browser, { online: false, errors })
  await page.click('#settings-button')

  const ui = await readUi(page)
  check('Standardwerte 1,00× / 75° / 100 %', ui.sensitivity.value === 1 && ui.fov.value === 75 && ui.volume.value === 1 && ui.sensitivity.label === '1.00×' && ui.fov.label === '75°' && ui.volume.label === '100 %', JSON.stringify(ui))
  check('Regler-Bereiche gesetzt', await page.evaluate(() => ['sensitivity', 'fov', 'volume', 'music'].every((k) => Number(document.querySelector(`#setting-${k}`).max) > Number(document.querySelector(`#setting-${k}`).min))))

  // Bedienung mit der Tastatur (Regler fokussieren, Pfeil nach rechts)
  await page.focus('#setting-sensitivity')
  await page.keyboard.press('ArrowRight')
  const stepped = await readUi(page)
  check('Pfeiltaste ändert den Regler um einen Schritt', Math.abs(stepped.sensitivity.value - 1.05) < 0.001 && stepped.sensitivity.label === '1.05×', JSON.stringify(stepped.sensitivity))
  await setSlider(page, 'sensitivity', 1)

  // Wirkung
  const base = await yawPer100px(page)
  await setSlider(page, 'sensitivity', 2)
  const doubled = await yawPer100px(page)
  check('Empfindlichkeit 2× dreht doppelt so weit', Math.abs(doubled / base - 2) < 0.01, `${base.toFixed(3)} -> ${doubled.toFixed(3)} rad je 100 px`)

  await setSlider(page, 'sensitivity', 8)
  const maxed = await yawPer100px(page)
  const maxLabel = await page.textContent('#setting-sensitivity-value')
  check('Empfindlichkeit bis 8× (dreht 8-fach, Anzeige 8.00×)', Math.abs(maxed / base - 8) < 0.01 && maxLabel === '8.00×', `${maxed.toFixed(3)} rad je 100 px, ${maxLabel}`)
  await setSlider(page, 'sensitivity', 2)

  await setSlider(page, 'fov', 100)
  await wait(400)
  const fov = await page.evaluate(() => __dusk.camera.fov)
  check('Blickfeld 100° wirkt auf die Kamera', Math.abs(fov - 100) < 0.01, `${fov}°`)

  // Ton: Audio startet erst nach dem Klick auf Weiter
  await setSlider(page, 'volume', 0.5)
  await setSlider(page, 'music', 0.25)
  await page.click('#settings-back-button')
  await play(page)
  await wait(400)
  const gain = () => page.evaluate(() => __dusk.sound.master.gain.value)
  check('Lautstärke 50 % halbiert die Gesamtlautstärke', Math.abs((await gain()) - 0.3) < 0.001, `${await gain()}`)
  check('Musik-Regler 25 % wirkt nur auf die Musik', Math.abs(await page.evaluate(() => __dusk.sound.musicGain.gain.value) - 0.125) < 0.001)
  await page.evaluate(() => __dusk.sound.toggleMute())
  const muted = await gain()
  await page.evaluate(() => __dusk.sound.toggleMute())
  check('Stummschalten (M) geht weiter, danach wieder 50 %', muted === 0 && Math.abs((await gain()) - 0.3) < 0.001, `stumm ${muted}`)

  // Rutschen addiert weiter 7° auf das gewählte Blickfeld
  // (im selben Schritt lesen: ein echtes Bild würde die Überblendung sofort abbauen)
  const slideFov = await page.evaluate(() => {
    __dusk.slideView.apply(__dusk.camera, true, 1)
    return __dusk.camera.fov
  })
  check('Rutschen: gewähltes Blickfeld + 7°', Math.abs(slideFov - 107) < 0.01, `${slideFov}°`)

  // Gemerkt
  await page.reload()
  await page.waitForFunction(() => typeof window.__dusk !== 'undefined')
  await wait(400)
  const restored = await page.evaluate(() => ({ fov: __dusk.camera.fov, stored: localStorage.getItem('duskArena.settings') }))
  check('nach dem Neuladen gemerkt und angewendet', Math.abs(restored.fov - 100) < 0.01 && JSON.parse(restored.stored).sensitivity === 2, JSON.stringify(restored))
  check('Empfindlichkeit nach Neuladen weiter 2×', Math.abs((await yawPer100px(page)) / base - 2) < 0.01)
  await page.click('#settings-button')
  const ui2 = await readUi(page)
  check('Regler zeigen die gemerkten Werte', ui2.sensitivity.value === 2 && ui2.fov.value === 100 && ui2.volume.value === 0.5 && ui2.fov.label === '100°', JSON.stringify(ui2))

  // Zurücksetzen
  await page.click('#settings-reset-button')
  const reset = await readUi(page)
  check('Standardwerte setzt alles zurück', reset.sensitivity.value === 1 && reset.fov.value === 75 && reset.volume.value === 1, JSON.stringify(reset))
  await wait(300)
  check('Zurücksetzen wirkt auf die Kamera', Math.abs((await page.evaluate(() => __dusk.camera.fov)) - 75) < 0.01)

  // Minimap: Standard an, Einstellung und Taste N, gemerkt, Zurücksetzen
  const mapState = () =>
    page.evaluate(() => ({
      shown: getComputedStyle(document.querySelector('#minimap')).display !== 'none',
      checked: document.querySelector('#setting-minimap').checked,
      label: document.querySelector('#setting-minimap-value').textContent,
      hudHeight: getComputedStyle(document.documentElement).getPropertyValue('--minimap-h').trim(),
      stored: JSON.parse(localStorage.getItem('duskArena.settings') ?? '{}').minimap,
    }))
  const on = await mapState()
  check('Minimap standardmäßig an', on.shown && on.checked && on.label === 'An' && parseInt(on.hudHeight) > 40, JSON.stringify(on))
  await page.click('#setting-minimap')
  const off = await mapState()
  check('Haken weg: Karte aus, Platz im HUD frei, gemerkt', !off.shown && !off.checked && off.label === 'Aus' && off.hudHeight === '0px' && off.stored === false, JSON.stringify(off))
  await page.reload()
  await page.waitForFunction(() => typeof window.__dusk !== 'undefined')
  await page.click('#settings-button')
  const offAfterReload = await mapState()
  check('nach Neuladen weiter aus', !offAfterReload.shown && !offAfterReload.checked, JSON.stringify(offAfterReload))
  await page.keyboard.press('n')
  const byKey = await mapState()
  check('Taste N schaltet die Karte wieder ein (Haken folgt)', byKey.shown && byKey.checked && byKey.stored === true && parseInt(byKey.hudHeight) > 40, JSON.stringify(byKey))
  await page.keyboard.press('n')
  check('Taste N schaltet sie wieder aus', !(await mapState()).shown)
  await page.click('#settings-reset-button')
  check('Standardwerte schaltet die Karte wieder an', (await mapState()).shown)

  // Kaputte Speicherwerte
  await page.evaluate(() => localStorage.setItem('duskArena.settings', '{"sensitivity":99,"fov":"x","volume":-5}'))
  await page.reload()
  await page.waitForFunction(() => typeof window.__dusk !== 'undefined')
  await page.click('#settings-button')
  const broken = await readUi(page)
  check('Werte außerhalb/kaputt: begrenzt bzw. Standard', broken.sensitivity.value === 8 && broken.fov.value === 75 && broken.volume.value === 0, JSON.stringify(broken))
  check('fehlende/kaputte Karten-Einstellung: an', (await mapState()).shown)
  await page.evaluate(() => localStorage.setItem('duskArena.settings', 'kein json'))
  await page.reload()
  await page.waitForFunction(() => typeof window.__dusk !== 'undefined')
  await page.click('#settings-button')
  const garbage = await readUi(page)
  check('kein gültiges JSON: Standardwerte', garbage.sensitivity.value === 1 && garbage.fov.value === 75 && garbage.volume.value === 1, JSON.stringify(garbage))
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
