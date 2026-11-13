// Screenshots der Testkarte Skyline von festen Standpunkten (Texturen/Optik prüfen)
// node tests/skyline-shots.mjs [ausgabeordner]
import { launchBrowser, play, startServers, wait, GAME_URL } from './lib.mjs'

const outDir = process.argv[2] ?? '.'
const LOOK = process.env.LOOK ?? 'hafen' // Vorlage (?look=)
const ONLY = process.env.ONLY?.split(',') // nur diese Ansichten
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
  // freier Blick von außen/unten (Flugmodus), Stützen und Auflager prüfen
  ['unter-bruecke', -10, 8, 6, 0, 0.4, true],
  ['unter-terrasse', -10, -20, 7, Math.PI, 0.35, true],
  ['unter-steg', -10, -16, 14, Math.PI, 0.3, true],
  ['kran', -12, 14, 20, 0, 0.1, true],
  ['billboard', 0, -20, 19, Math.PI, 0.05, true],
]
const servers = await startServers()
const browser = await launchBrowser()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`${GAME_URL}?map=skyline&look=${LOOK}`)
  await page.waitForFunction(() => 'undefined' !== typeof window.__dusk)
  await play(page)
  await wait(800)
  for (const [name, x, z, feet, yaw, pitch, fly] of VIEWS) {
    if (ONLY && !ONLY.includes(name)) continue
    await page.evaluate(([x, z, feet, yaw, pitch, fly]) => {
      const D = window.__dusk
      D.player.flying = !!fly
      D.player.spawn({ x, y: feet + 1.7, z, clone() { return this } })
      D.player.bodyY = feet
      D.camera.rotation.set(pitch, yaw, 0, 'YXZ')
      D.lookControl.euler.setFromQuaternion(D.camera.quaternion)
      for (const el of document.querySelectorAll('#hud, #crosshair, #weapon-hud, #stats, #player-hud')) el.style.display = 'none'
    }, [x, z, feet, yaw, pitch, fly])
    await wait(700)
    await page.screenshot({ path: `${outDir}/shot-${LOOK}-${name}.png` })
  }
} finally { await browser.close(); servers.stop() }
