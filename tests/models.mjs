// Waffenmodelle: keine deckungsgleichen Flächen (Z-Fighting, "Panels glitchen ineinander").
// Prüft je Modell alle achsenparallelen Boxen paarweise: zwei Flächen derselben Seite auf
// gleicher Höhe (< 0,2 mm) mit überlappender Fläche flackern.
//
//   node tests/models.mjs
import { startServers, launchBrowser, openGame, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  const result = await page.evaluate(() => {
    const TOL = 0.0002
    const out = {}
    for (const [id, model] of Object.entries(__dusk.weapon.view.models)) {
      const boxes = []
      model.group.children.forEach((m, i) => {
        if (!m.geometry || m.geometry.type !== 'BoxGeometry') return
        if (Math.abs(m.rotation.x) + Math.abs(m.rotation.y) + Math.abs(m.rotation.z) > 1e-6) return
        const p = m.geometry.parameters
        boxes.push({ i, min: [m.position.x - p.width / 2, m.position.y - p.height / 2, m.position.z - p.depth / 2], max: [m.position.x + p.width / 2, m.position.y + p.height / 2, m.position.z + p.depth / 2] })
      })
      const issues = []
      for (let a = 0; a < boxes.length; a++) {
        for (let b = a + 1; b < boxes.length; b++) {
          for (let axis = 0; axis < 3; axis++) {
            const o1 = (axis + 1) % 3
            const o2 = (axis + 2) % 3
            const overlap = (k) => Math.min(boxes[a].max[k], boxes[b].max[k]) - Math.max(boxes[a].min[k], boxes[b].min[k])
            if (overlap(o1) <= 0.0005 || overlap(o2) <= 0.0005) continue
            for (const side of ['min', 'max']) {
              if (Math.abs(boxes[a][side][axis] - boxes[b][side][axis]) <= TOL) issues.push(`${a}/${b} ${'xyz'[axis]} ${side}`)
            }
          }
        }
      }
      // Beim Zielen darf das Modell nicht in die Kamera ragen (Nahebene 0,1 m): hinterstes Ende >= 0,2 m davor
      let rear = -Infinity
      for (const m of model.group.children) {
        if (m.geometry && m.geometry.type === 'BoxGeometry') rear = Math.max(rear, m.position.z + m.geometry.parameters.depth / 2)
      }
      const rearWorld = model.aimZ + model.group.position.z + rear
      out[id] = { boxes: boxes.length, issues, rearWorld }
    }
    return out
  })
  for (const [id, r] of Object.entries(result)) {
    check(`${id}: keine deckungsgleichen Flächen (${r.boxes} Boxen geprüft)`, r.issues.length === 0, r.issues.join(', '))
    if (id !== 'knife') check(`${id}: beim Zielen steckt die Kamera nicht im Modell (Ende ${(-r.rearWorld).toFixed(2)} m vor der Kamera)`, r.rearWorld <= -0.2, r.rearWorld.toFixed(3))
  }
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
