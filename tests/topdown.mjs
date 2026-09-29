// Draufsicht auf die Arena (Norden oben) mit Meterraster und Spawns als PNG.
// node tests/topdown.mjs [ausgabeordner]
//   topdown.png       alles
//   topdown-unten.png ohne obere Ebene (Stege, Brücken, Plattformen ab 2 m)
import { launchBrowser, openGame, play, startServers, wait } from './lib.mjs'

const outDir = process.argv[2] ?? '.'
const servers = await startServers()
const browser = await launchBrowser()
try {
  const page = await openGame(browser, { name: 'Karte' })
  await page.setViewportSize({ width: 1680, height: 900 })
  await play(page)
  await wait(1500)
  await page.evaluate(() => {
    const D = window.__dusk
    const scene = D.camera.parent
    scene.fog = null
    scene.traverse((o) => {
      if (o === scene || o.isLight) return
      let inArena = false
      for (let p = o; p; p = p.parent) if (p === D.arena.group) inArena = true
      if (!inArena && o.parent === scene) o.visible = false
    })
    const w = D.renderer.domElement.clientWidth
    const h = D.renderer.domElement.clientHeight
    const cx = 10, cz = 0, halfW = 44
    const halfH = Math.max(halfW / (w / h), 23.5)
    const height = 250
    const cam = D.camera.clone()
    cam.fov = (2 * Math.atan(halfH / height) * 180) / Math.PI
    cam.aspect = w / h
    cam.near = 1
    cam.far = 1000
    cam.up.set(0, 0, -1)
    cam.position.set(cx, height, cz)
    cam.lookAt(cx, 0, cz)
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld(true)
    const render = D.renderer.render.bind(D.renderer)
    D.renderer.render = (s) => render(s, cam)
    const toPx = (x, z) => [w / 2 + ((x - cx) * h) / 2 / halfH, h / 2 + ((z - cz) * h) / 2 / halfH]

    for (const el of document.body.children) if (!el.contains(D.renderer.domElement) && el !== D.renderer.domElement) el.style.display = 'none'
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;font:12px monospace;color:#fff'
    const add = (html, x, z, css = '') => {
      const [px, py] = toPx(x, z)
      const d = document.createElement('div')
      d.style.cssText = `position:absolute;left:${px}px;top:${py}px;${css}`
      d.innerHTML = html
      overlay.appendChild(d)
    }
    for (let x = -30; x <= 50; x += 10) {
      add('', x, 0, 'width:1px;height:' + (46 * h) / 2 / halfH + 'px;margin-top:' + (-23 * h) / 2 / halfH + 'px;background:rgba(255,255,255,.25)')
      add('x ' + x, x, -22.6, 'transform:translateX(-50%);background:#0008;padding:0 3px')
    }
    for (let z = -20; z <= 20; z += 10) {
      add('', 0, z, 'height:1px;width:' + (88 * h) / 2 / halfH + 'px;margin-left:' + (-44 * h) / 2 / halfH + 'px;background:rgba(255,255,255,.25)')
      add('z ' + z, -33.5, z, 'transform:translateY(-50%);background:#0008;padding:0 3px')
    }
    D.arena.spawnPoints.forEach((p, i) =>
      add('S' + i, p.x, p.z, 'transform:translate(-50%,-50%);background:#e8c200;color:#000;font-weight:bold;border-radius:50%;padding:3px 6px;border:2px solid #000')
    )
    add('Norden ↑', 46, -21.5, 'font-size:14px;background:#0008;padding:2px 5px')
    document.body.appendChild(overlay)
  })
  await wait(600)
  await page.screenshot({ path: `${outDir}/topdown.png` })
  await page.evaluate(() => {
    for (const s of window.__dusk.arena.solids) if (s.box.min.y > 2) s.mesh.visible = false
  })
  await wait(600)
  await page.screenshot({ path: `${outDir}/topdown-unten.png` })
} finally { await browser.close(); servers.stop() }
