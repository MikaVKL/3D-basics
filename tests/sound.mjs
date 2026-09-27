// Sound-Test: jeder Sound erzeugt hörbares Signal (Offline-Rendering), und
// die Spielereignisse lösen die richtigen Sounds aus.
//
//   node tests/sound.mjs
import { startServers, launchBrowser, openGame, play, shootAt, teleport, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []

// Protokolliert jeden sound.play()-Aufruf der Seite in window.__sounds
const spySounds = (page) =>
  page.evaluate(() => {
    window.__sounds = []
    const original = __dusk.sound.play.bind(__dusk.sound)
    __dusk.sound.play = (name, volume) => {
      window.__sounds.push(name)
      original(name, volume)
    }
  })
const takeSounds = (page) =>
  page.evaluate(() => {
    const list = window.__sounds
    window.__sounds = []
    return list
  })

try {
  // --- 1) Jeder Sound hörbar, nicht übersteuert, keine kaputten Werte ---
  const page = await openGame(browser, { online: false, errors })
  const levels = await page.evaluate(async () => {
    const { SYNTHS, createNoiseBuffer } = await import('/3D-basics/src/sound.ts')
    const result = {}
    for (const name of Object.keys(SYNTHS)) {
      const ctx = new OfflineAudioContext(1, 44100 * 1.5, 44100)
      SYNTHS[name](ctx, ctx.destination, createNoiseBuffer(ctx))
      const data = (await ctx.startRendering()).getChannelData(0)
      let peak = 0
      let invalid = 0
      for (const v of data) {
        if (!Number.isFinite(v)) invalid++
        else peak = Math.max(peak, Math.abs(v))
      }
      result[name] = { peak, invalid }
    }
    return result
  })
  for (const [name, { peak, invalid }] of Object.entries(levels)) {
    check(`Sound "${name}" hörbar und sauber`, peak > 0.02 && peak < 1.2 && invalid === 0, `Spitze ${peak.toFixed(2)}`)
  }

  // --- 2) Singleplayer-Ereignisse ---
  await play(page)
  await wait(300)
  check('Audio nach Klick auf "Spielen" aktiv', await page.evaluate(() => __dusk.sound.ctx?.state === 'running'))
  await spySounds(page)

  await teleport(page, 3, 1.7, -2) // vor dem Dummy bei (3, 0.8, -6)
  await wait(200)
  await takeSounds(page)
  await shootAt(page, [3, 0.8, -6])
  check('Schuss auf Dummy: Schuss + Hitmarker', (await takeSounds(page)).sort().join() === 'hit,shot')
  for (let i = 0; i < 8; i++) await shootAt(page, [3, 0.8, -6])
  check('Dummy-Kill: Kill-Ton', (await takeSounds(page)).includes('kill'))

  await page.evaluate(() => {
    __dusk.weapon.reloadRemaining = 0
    __dusk.weapon.ammo = 3
    __dusk.weapon.reload()
  })
  check('Nachladen', (await takeSounds(page)).join() === 'reload')

  // Physik direkt simulieren (Headless rendert zu langsam für echte Frames)
  const simulate = (setup) =>
    page.evaluate((setupCode) => {
      const P = __dusk.player
      new Function('P', setupCode)(P)
      for (let i = 0; i < 90; i++) P.update(1 / 60)
    }, setup)
  await teleport(page, 0, 1.7, 12)
  await takeSounds(page)
  await simulate('P.jump()')
  check('Sprung + Landung', (await takeSounds(page)).join() === 'jump,land')

  // Schritte laufen über den Game-Loop (updateOwnFootsteps) - dort echte Frames
  await teleport(page, 0, 1.7, 12)
  await page.evaluate(() => __dusk.player.setMoveInput(0, 1))
  await wait(2500)
  await page.evaluate(() => __dusk.player.setMoveInput(0, 0))
  const steps = (await takeSounds(page)).filter((s) => s === 'step').length
  check('Schritte beim Laufen', steps >= 2, `${steps} Schritte`)

  await teleport(page, 0, 1.7, 12)
  await page.evaluate(() => {
    __dusk.player.setCrouching(true)
    __dusk.player.setMoveInput(0, 1)
  })
  await wait(2500)
  await page.evaluate(() => {
    __dusk.player.setMoveInput(0, 0)
    __dusk.player.setCrouching(false)
  })
  check('geduckt lautlos', !(await takeSounds(page)).includes('step'))

  await page.keyboard.press('KeyM')
  const muted = await page.evaluate(() => [__dusk.sound.muted, localStorage.getItem('duskArena.muted')])
  await page.keyboard.press('KeyM')
  check('M schaltet stumm und merkt es sich', muted[0] === true && muted[1] === '1')

  // --- 3) Mehrspieler: Treffer-Wumms beim Getroffenen, Kill-Ton vom Server ---
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A)
  await play(B)
  await wait(3800) // Beitritt + Spawn-Schutz
  await spySounds(A)
  await spySounds(B)
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 10)
  await wait(600)
  for (let i = 0; i < 9; i++) {
    await shootAt(A, [0, 0.9, 5])
    await wait(150)
  }
  await wait(600)
  const aSounds = await takeSounds(A)
  const bSounds = await takeSounds(B)
  check('Getroffener hört Treffer-Wumms', bSounds.filter((s) => s === 'hurt').length === 9, bSounds.join())
  check('Schütze hört Kill-Ton vom Server', aSounds.includes('kill'), aSounds.join())
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
