// Laserstrahl (Leuchtspur): erscheint bei jedem Schuss, hat Kern + Schein in
// Teamfarbe, blendet weich aus, wird danach aufgeräumt (Szene, Materialien).
//
//   node tests/tracer.mjs
import { startServers, launchBrowser, openGame, play, shootAt, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(300)

  // Update der Waffe anhalten, damit die Zeit im Test gesteuert wird
  await page.evaluate(() => {
    const w = __dusk.weapon
    window.__realUpdate = w.update.bind(w)
    w.update = () => {}
    window.__sceneChildren = () => __dusk.renderer.info.memory.geometries
  })
  await shootAt(page, [3, 0.9, -6])
  const shot = await page.evaluate(() => {
    const t = __dusk.weapon.tracers[0]
    return {
      count: __dusk.weapon.tracers.length,
      meshes: t?.meshes.length,
      coreColor: t?.materials[1].color.getHex(),
      glowColor: t?.materials[0].color.getHex(),
      additive: t?.materials[0].blending === 2,
      noFog: t?.materials[0].fog === false,
      opacity: t?.materials.map((m) => m.opacity),
      team: __dusk.weapon.shooterTeam,
    }
  })
  check('Schuss erzeugt einen Strahl aus Kern und Schein', shot.count === 1 && shot.meshes === 2, JSON.stringify(shot))
  check('Kern weiß, Schein in der Teamfarbe des Schützen', shot.coreColor === 0xffffff && shot.glowColor === (shot.team === 'red' ? 0xff4d5a : 0x4da6ff), `Schein ${shot.glowColor?.toString(16)} (${shot.team})`)
  check('additiv und ohne Nebel (auch weit weg sichtbar)', shot.additive && shot.noFog)

  // Zeitverlauf: 0,2 s Lebensdauer, weiches Ausblenden
  const life = await page.evaluate(() => {
    const step = (dt) => {
      window.__realUpdate(dt)
      const t = __dusk.weapon.tracers[0]
      return t ? Number(t.materials[1].opacity.toFixed(2)) : null
    }
    return { at50: step(0.05), at100: step(0.05), at150: step(0.05), at250: step(0.1) }
  })
  check('nach 50 ms noch klar sichtbar', life.at50 > 0.5, `Deckkraft ${life.at50}`)
  check('blendet weich aus (monoton fallend)', life.at100 < life.at50 && life.at150 < life.at100 && life.at150 > 0, JSON.stringify(life))
  check('nach 0,25 s weg', life.at250 === null)
  // (Einschlag-Markierungen sind wegen der angehaltenen Waffen-Updates noch da)
  const cleaned = await page.evaluate(() => {
    const w = __dusk.weapon
    const beams = w.scene.children.filter((c) => c.geometry === w.tracerCoreGeometry || c.geometry === w.tracerGlowGeometry)
    return { tracers: w.tracers.length, beams: beams.length }
  })
  check('Strahlen danach aus der Szene entfernt', cleaned.tracers === 0 && cleaned.beams === 0, JSON.stringify(cleaned))

  // Strahl anderer Spieler: Farbe nach Team des Schützen
  const remote = await page.evaluate(() => {
    const V = __dusk.camera.position.constructor
    const out = {}
    for (const team of ['red', 'blue']) {
      __dusk.weapon.showRemoteTracer(new V(0, 1.5, 0), new V(0, 1.5, -10), team)
      out[team] = __dusk.weapon.tracers[__dusk.weapon.tracers.length - 1].materials[0].color.getHex()
    }
    return out
  })
  check('fremde Strahlen in Teamfarbe (rot/blau)', remote.red === 0xff4d5a && remote.blue === 0x4da6ff, JSON.stringify(remote))

  // Pistole kräftiger und länger sichtbar als Sturmgewehr
  const styles = await page.evaluate(() => {
    const w = __dusk.weapon
    const V = __dusk.camera.position.constructor
    const out = {}
    for (const id of ['pistol', 'rifle']) {
      w.showRemoteTracer(new V(0, 1.5, 0), new V(0, 1.5, -10), 'red', id)
      const t = w.tracers[w.tracers.length - 1]
      out[id] = { width: t.meshes[0].scale.x, glow: t.materials[0].opacity, life: t.lifetime }
    }
    return out
  })
  check('Pistolenstrahl dicker, heller und länger als Sturmgewehr', styles.pistol.width > styles.rifle.width && styles.pistol.glow > styles.rifle.glow && styles.pistol.life > styles.rifle.life, JSON.stringify(styles))

  // Dauerfeuer: nicht unbegrenzt viele Strahlen
  const burst = await page.evaluate(() => {
    const w = __dusk.weapon
    w.update = w.update // bleibt angehalten
    const V = __dusk.camera.position.constructor
    window.__realUpdate(1)
    let max = 0
    for (let i = 0; i < 30; i++) {
      w.showRemoteTracer(new V(0, 1.5, 0), new V(0, 1.5, -20), 'blue', 'rifle')
      window.__realUpdate(0.1)
      max = Math.max(max, w.tracers.length)
    }
    return max
  })
  check('Dauerfeuer (10 Schüsse/s): höchstens ~4 Strahlen gleichzeitig', burst <= 4, `${burst} gleichzeitig`)
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
