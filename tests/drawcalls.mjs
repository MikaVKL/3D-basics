// Draw Calls der Arena (Leistung): Messung an vier Blickpunkten und Aufbau der Arena nach Material.
//
//   node tests/drawcalls.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await page.setViewportSize({ width: 1280, height: 720 })
  await play(page)
  await wait(1500)
  const parts = await page.evaluate(() => {
    const byMat = {}
    let hidden = 0
    __dusk.arena.group.traverse((o) => {
      if (!(o.isMesh || o.isLineSegments || o.isLine)) return
      if (o.visible === false) { hidden++; return }
      const m = o.material
      const key = `${o.type}:${m.type}:${m.color?.getHexString?.() ?? ''}:${m.map ? 'map' : ''}`
      byMat[key] = (byMat[key] ?? 0) + 1
    })
    return { byMat, hidden, total: 0 }
  })
  console.log(JSON.stringify(parts.byMat, null, 1), 'ausgeblendet:', parts.hidden)
  const spots = [[-21.5, 1.7, -7, 'Spawn'], [0, 1.7, 0, 'Mitte'], [0, 4.5, -20, 'Ring'], [0, 7.7, 0, 'Dach']]
  let worst = 0
  for (const [x, y, z, name] of spots) {
    await teleport(page, x, y, z)
    await wait(700)
    const r = await page.evaluate(() => {
      const info = __dusk.renderer.info
      __dusk.renderer.render(__dusk.scene ?? __dusk.arena.group.parent, __dusk.camera)
      return { calls: info.render.calls, tris: info.render.triangles }
    })
    console.log(name, JSON.stringify(r))
    worst = Math.max(worst, r.calls)
  }
  console.log('schlechtester Blickpunkt:', worst, 'Draw Calls')
  check('Draw Calls an allen Blickpunkten <= 60', worst <= 60, String(worst))
} finally {
  await browser.close()
  servers.stop()
}
finish()
