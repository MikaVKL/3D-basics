// Erkennbarkeit: rote und blaue Figur vor Kiste, Wand, Boden und in der
// Weite - Farbabstand (ΔE, CIE76) zwischen Figur und dem, was dahinter liegt.
// Orientierung: < 10 kaum unterscheidbar, ab 20 gut, ab 40 sehr deutlich.
//
//   node tests/contrast.mjs
import { launchBrowser, openGame, play, startServers, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const MIN_MEDIAN = 28
const MIN_WEAKEST = 20 // schwächstes Fünftel der Figur-Pixel

const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const scenes = [
  ['Kiste', [-2, 1.5, 9], [-2, 0, 3.2]],
  ['Wand', [8, 1.5, 12], [8, 0, 18.5]],
  ['Boden', [10, 6, -2], [10, 0, -6]],
  // Nicht bei x = 0: dort steht die Deckung vor dem Nord-Spawn
  ['Weite', [12, 1.7, -19], [18, 0, -11]],
]
try {
  const page = await openGame(browser, { online: false })
  await page.setViewportSize({ width: 640, height: 400 })
  await play(page); await wait(400)
  await page.addStyleTag({ content: 'body > *:not(#app) { display: none !important; }' })
  for (const team of ['red', 'blue']) {
    for (const [name, cam, pos] of scenes) {
      await page.evaluate(async ([team, cam, pos]) => {
        const { PlayerAvatar } = await import('/3D-basics/src/playerAvatar.ts')
        const D = __dusk
        for (const o of D.arena.shootables) if (o.userData.damageable && !o.userData.avatar) o.visible = false
        D.camera.children.forEach((c) => (c.visible = false)) // Waffe in der Hand
        window.__avatar?.root.removeFromParent()
        const a = new PlayerAvatar(team)
        a.mesh.userData.avatar = true
        const yaw = Math.atan2(cam[0] - pos[0], cam[2] - pos[2])
        a.applyState({ ...D.player.getNetworkState(), team, isAlive: true, crouching: false, sliding: false, eyeHeight: 1.7, weapon: 'rifle', yaw, position: { x: pos[0], y: pos[1] + 1.7, z: pos[2] } })
        a.update(1)
        D.camera.parent.add(a.root)
        window.__avatar = a
        D.player.spawn({ x: cam[0], y: cam[1], z: cam[2], clone() { return this } })
        D.player.update = () => {} // Kamera nicht bewegen/fallen lassen
        D.camera.position.set(...cam)
        D.camera.lookAt(pos[0], pos[1] + 1, pos[2])
        D.lookControl.euler.setFromQuaternion(D.camera.quaternion)
      }, [team, cam, pos])
      await wait(400)
      const withFigure = (await page.screenshot()).toString('base64')
      await page.evaluate(() => (window.__avatar.root.visible = false))
      await wait(400)
      const without = (await page.screenshot()).toString('base64')
      const r = await page.evaluate(measure, [withFigure, without])
      check(`${team === 'red' ? 'Rot' : 'Blau'} vor ${name}: gut erkennbar`, r.median >= MIN_MEDIAN && r.weakest >= MIN_WEAKEST && r.pixels > 300, `ΔE Median ${r.median.toFixed(1)}, schwächste 20 % ${r.weakest.toFixed(1)}, ${r.pixels} Pixel`)
    }
  }
} finally {
  await browser.close()
  servers.stop()
  finish()
}

// Läuft im Browser: beide Bilder dekodieren, Lab-Abstand je Pixel
async function measure([a, b]) {
  const load = async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return context.getImageData(0, 0, image.width, image.height).data
  }
  const lab = (r, g, bl) => {
    const lin = (c) => ((c /= 255) > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92)
    const [R, G, B] = [lin(r), lin(g), lin(bl)]
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505)
    const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B)
    const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089)
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
  }
  const [pa, pb] = [await load(a), await load(b)]
  const deltas = []
  for (let i = 0; i < pa.length; i += 4) {
    const [l1, a1, b1] = lab(pa[i], pa[i + 1], pa[i + 2])
    const [l2, a2, b2] = lab(pb[i], pb[i + 1], pb[i + 2])
    const d = Math.hypot(l1 - l2, a1 - a2, b1 - b2)
    if (d > 3) deltas.push(d)
  }
  deltas.sort((x, y) => x - y)
  return { pixels: deltas.length, median: deltas[deltas.length >> 1] ?? 0, weakest: deltas[Math.floor(deltas.length * 0.2)] ?? 0 }
}
