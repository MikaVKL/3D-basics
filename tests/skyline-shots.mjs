// Screenshots der Testkarte Skyline von festen Standpunkten (Texturen/Optik prüfen)
// node tests/skyline-shots.mjs [ausgabeordner]
import { launchBrowser, play, startServers, wait, GAME_URL } from './lib.mjs'

const outDir = process.argv[2] ?? '.'
// [Name, x, z, Füße, yaw (0 = Norden, +PI/2 = Westen), pitch]
const VIEWS = [
  ['halle', -17.5, -1, 12, Math.PI / 2, -0.05],
  ['halle-sued', -22, -6, 12, Math.PI, -0.1],
  ['skybridge', -14.2, 0, 12, -Math.PI / 2, 0],
  ['terrasse', -16.5, -10.2, 12, -Math.PI / 2, 0],
  ['mitte', -4.5, 0, 12, -Math.PI / 2, 0.1],
  ['dach', -15, 2, 18, Math.PI / 2, -0.05],
  ['dach-kran', -20, 4, 18, -Math.PI / 2, 0.05],
  ['aussen', -34, 0, 18, -Math.PI / 2, -0.15],
]
const servers = await startServers()
const browser = await launchBrowser()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`${GAME_URL}?map=skyline`)
  await page.waitForFunction(() => 'undefined' !== typeof window.__dusk)
  await play(page)
  await wait(800)
  for (const [name, x, z, feet, yaw, pitch] of VIEWS) {
    await page.evaluate(([x, z, feet, yaw, pitch]) => {
      const D = window.__dusk
      D.player.spawn({ x, y: feet + 1.7, z, clone() { return this } })
      D.player.bodyY = feet
      D.camera.rotation.set(pitch, yaw, 0, 'YXZ')
      D.lookControl.euler.setFromQuaternion(D.camera.quaternion)
      for (const el of document.querySelectorAll('#hud, #crosshair, #weapon-hud, #stats, #player-hud')) el.style.display = 'none'
    }, [x, z, feet, yaw, pitch])
    await wait(700)
    await page.screenshot({ path: `${outDir}/shot-${name}.png` })
  }
} finally { await browser.close(); servers.stop() }
