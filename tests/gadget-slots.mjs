// Zwei Gadget-Plätze: Taktik (Taste G: Rauch/Blend) und Bewegung (Taste F: Haken/Pad), je eigene Wahl,
// Abklingzeit und Anzeige; der Server zählt die Abklingzeit je Platz.
//
//   node tests/gadget-slots.mjs
import { startServers, launchBrowser, openGame, play, pickOption, wait, teleport, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const A = await openGame(browser, { name: 'Anna', errors })
  await A.setViewportSize({ width: 1280, height: 720 })
  await A.click('#start-button')
  const columns = await A.evaluate(() => [...document.querySelectorAll('.loadout-column h3')].map((h) => h.textContent))
  check('Auswahl hat vier Listen: Primary, Secondary, Taktik (G), Bewegung (F)', columns.join('|') === 'Primary|Secondary|Taktik (Taste G)|Bewegung (Taste F)', columns.join('|'))
  const defaults = await A.evaluate(() => ({
    tactic: document.querySelector('#loadout-gadget .gadget-card.selected')?.dataset.gadget,
    move: document.querySelector('#loadout-gadget-move .gadget-card.selected')?.dataset.gadget,
  }))
  check('Vorgabe: Rauchgranate und Enterhaken (Bewegung ist nie leer)', defaults.tactic === 'smoke' && defaults.move === 'grapple', JSON.stringify(defaults))
  await pickOption(A, '.gadget-card[data-gadget="jump"]')
  const stored = await A.evaluate(() => [localStorage.getItem('duskArena.gadget.tactic'), localStorage.getItem('duskArena.gadget.move')])
  check('Wahl wird je Platz gemerkt (Pad unter Bewegung)', stored[1] === 'jump', JSON.stringify(stored))
  await A.click('#loadout-play-button')
  await wait(3800)
  await teleport(A, -8, 1.7, 8)
  await wait(400)
  await A.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => __dusk.renderer.domElement })
  })
  const hud = await A.evaluate(() => ({
    tactic: [document.querySelector('#gadget-hud .gadget-key').textContent, document.querySelector('#gadget-name').textContent],
    move: [document.querySelector('#gadget-hud-move .gadget-key').textContent, document.querySelector('#gadget-name-move').textContent],
    sel: __dusk.gadgets.selected,
  }))
  check('HUD: zwei Zeilen G = Rauchgranate, F = Sprungpad', hud.tactic.join() === 'G,Rauchgranate' && hud.move.join() === 'F,Sprungpad' && hud.sel.tactic === 'smoke' && hud.sel.move === 'jump', JSON.stringify(hud))

  // Taste G wirft Rauch, Taste F das Pad - unabhängige Abklingzeiten
  await A.keyboard.press('KeyG')
  const afterG = await A.evaluate(() => ({ t: __dusk.gadgets.cooldowns.tactic.remaining, m: __dusk.gadgets.cooldowns.move.remaining }))
  check('G: Taktik 25 s, Bewegung unberührt', Math.abs(afterG.t - 25) < 0.5 && afterG.m === 0, JSON.stringify(afterG))
  await A.keyboard.press('KeyF')
  const afterF = await A.evaluate(() => ({ t: __dusk.gadgets.cooldowns.tactic.remaining, m: __dusk.gadgets.cooldowns.move.remaining }))
  check('F direkt danach: Bewegung 30 s (Pad), Taktik läuft weiter', Math.abs(afterF.m - 30) < 0.5 && afterF.t > 24 && afterF.t <= 25, JSON.stringify(afterF))
  await wait(300)
  const hudCd = await A.evaluate(() => ({ t: document.querySelector('#gadget-status').textContent, m: document.querySelector('#gadget-status-move').textContent }))
  check('Anzeige: beide Zeilen zeigen ihre Restzeit', /^\d+ s$/.test(hudCd.t) && /^\d+ s$/.test(hudCd.m), JSON.stringify(hudCd))

  // Neues Leben: beide wieder bereit
  const reset = await A.evaluate(() => {
    __dusk.gadgets.reset()
    return { t: __dusk.gadgets.cooldowns.tactic.remaining, m: __dusk.gadgets.cooldowns.move.remaining }
  })
  check('Neues Leben: beide Plätze bereit', reset.t === 0 && reset.m === 0, JSON.stringify(reset))

  // Server: Taktik-Wurf und Haken direkt hintereinander werden beide weitergegeben, zweiter Taktik-Wurf nicht
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(B)
  await wait(3800)
  await teleport(B, -8, 1.7, 8)
  await wait(400)
  await A.evaluate(() => {
    window.__got = []
    const playAt = __dusk.sound.playAt.bind(__dusk.sound)
    __dusk.sound.playAt = (n, p, v) => (['throw', 'hookShot'].includes(n) && window.__got.push(n), playAt(n, p, v))
  })
  const send = (kind, to) => B.evaluate(([k, t]) => {
    const p = __dusk.camera.position
    __dusk.network.sendGadget(k, { x: p.x, y: p.y, z: p.z }, { x: p.x + t, y: 0.15, z: p.z }, 0.8)
  }, [kind, to])
  await send('smoke', 6)
  await send('grapple', 8)
  await send('smoke', 6)
  await send('jump', 5)
  await send('grapple', 8)
  await wait(700)
  const got = await A.evaluate(() => window.__got.join())
  check('Server je Platz: Rauch + Haken kommen durch, 2. Rauch/2. Haken/Pad nicht (Taktik bzw. Bewegung noch in der Abklingzeit)', got === 'throw,hookShot', got)

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
