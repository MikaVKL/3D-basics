// Stecken-Fuzz-Test: viele simulierte Spieler laufen/springen/ducken
// zufällig durch die Arena (reine Physik, ohne Rendern, im Browser über
// window.__dusk). Gemeldet wird jede Stelle, an der der Körper in einem
// Hindernis steckt, man sich nicht mehr wegbewegen kann oder ohne Sprung
// ruckartig nach oben gezogen wird.
//
//   node tests/stuck-fuzz.mjs [spieler=1000] [sekunden=30] [seed=1] [duckanteil=0.15]
//
// Deterministisch pro Seed - gut für Vorher/Nachher-Vergleiche.
import { startServers, launchBrowser, openGame } from './lib.mjs'

const [AGENTS = 1000, SECONDS = 30, SEED = 1, CROUCH = 0.15] = process.argv.slice(2).map(Number)

const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
try {
  const page = await openGame(browser, { online: false })
  const found = await page.evaluate(
    ({ AGENTS, SECONDS, SEED, CROUCH }) => {
      const P = __dusk.player
      const cam = __dusk.camera
      const solids = __dusk.arena.solids
      let seed = SEED
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
      const R = 0.4
      const DT = 1 / 60

      // Körper (ab Stufenhöhe bis Kopf) steckt spürbar in einem Solid?
      const overlapping = () => {
        const x = cam.position.x
        const z = cam.position.z
        const feet = P.bodyY
        const head = feet + P.eyeHeight + 0.3
        return solids.some(({ box }) => {
          const ox = Math.min(x + R, box.max.x) - Math.max(x - R, box.min.x)
          const oz = Math.min(z + R, box.max.z) - Math.max(z - R, box.min.z)
          const oy = Math.min(head, box.max.y) - Math.max(feet + 0.16, box.min.y)
          return ox > 0.02 && oz > 0.02 && oy > 0.02
        })
      }
      const snapshot = () => ({
        pos: cam.position.clone(),
        q: cam.quaternion.clone(),
        bodyY: P.bodyY,
        vel: P.velocity.clone(),
        onGround: P.onGround,
        eye: P.eyeHeight,
        crouch: P.isCrouching,
        want: P.wantsToCrouch,
      })
      const restore = (s) => {
        cam.position.copy(s.pos)
        cam.quaternion.copy(s.q)
        P.bodyY = s.bodyY
        P.velocity.copy(s.vel)
        P.onGround = s.onGround
        P.eyeHeight = s.eye
        P.isCrouching = s.crouch
        P.wantsToCrouch = s.want
      }
      const setYaw = (yaw) => cam.rotation.set(0, yaw, 0, 'YXZ')
      // Kommt man von hier aus irgendwohin weg (8 Richtungen, mit/ohne Sprung)?
      const canEscape = () => {
        const s = snapshot()
        let best = 0
        for (let d = 0; d < 8; d++) {
          for (const jump of [false, true]) {
            restore(s)
            setYaw((d * Math.PI) / 4)
            P.setCrouching(false)
            P.setMoveInput(0, 1)
            if (jump) P.jump()
            for (let i = 0; i < 40; i++) P.update(DT)
            best = Math.max(best, Math.hypot(cam.position.x - s.pos.x, cam.position.z - s.pos.z))
          }
        }
        restore(s)
        return best > 0.3
      }

      const found = []
      const report = (kind) =>
        found.push({ kind, x: +cam.position.x.toFixed(2), z: +cam.position.z.toFixed(2), y: +P.bodyY.toFixed(2) })

      for (let a = 0; a < AGENTS; a++) {
        // Start: zufälliger Punkt, an dem man stehen kann, ohne zu stecken
        let ok = false
        for (let t = 0; t < 50 && !ok; t++) {
          const x = -31.4 + rnd() * 82.8
          const z = -20.4 + rnd() * 40.8
          if (x > 32 && Math.abs(z) > 11.5) continue // außerhalb des Flankenraums
          const ground = P.groundHeightAt(x, z)
          P.spawn({ x, y: ground + 1.7, z, clone() { return this } })
          P.bodyY = ground
          ok = !overlapping()
        }
        if (!ok) continue

        let lastPos = cam.position.clone()
        let idleSeconds = 0
        for (let f = 0; f < SECONDS * 60; f++) {
          if (f % 20 === 0) {
            if (rnd() < 0.5) setYaw(rnd() * Math.PI * 2)
            P.setMoveInput(rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0, rnd() < 0.85 ? 1 : -1)
            P.setSprinting(rnd() < 0.3)
            P.setCrouching(rnd() < CROUCH)
          }
          if (rnd() < 0.03) P.jump()
          const yBefore = P.bodyY
          const vyBefore = P.velocity.y
          P.update(DT)
          if (vyBefore <= 0 && P.bodyY - yBefore > 0.2) {
            report(`ohne Sprung um ${(P.bodyY - yBefore).toFixed(2)}m hochgezogen`)
            break
          }
          if (overlapping()) {
            report('steckt in Hindernis')
            break
          }
          if (f % 60 === 59) {
            const moved = Math.hypot(cam.position.x - lastPos.x, cam.position.z - lastPos.z)
            lastPos = cam.position.clone()
            idleSeconds = moved < 0.05 ? idleSeconds + 1 : 0
            if (idleSeconds >= 2 && !canEscape()) {
              report('festgesetzt')
              break
            }
          }
        }
      }
      return found
    },
    { AGENTS, SECONDS, SEED, CROUCH }
  )

  console.log(`${AGENTS} Spieler × ${SECONDS}s (Seed ${SEED}, Duckanteil ${CROUCH}): ${found.length} Probleme`)
  // Häufungen auf einem 2m-Raster
  const cells = new Map()
  for (const f of found) {
    const key = `${Math.round(f.x / 2) * 2},${Math.round(f.z / 2) * 2}`
    const cell = cells.get(key) ?? { count: 0, example: f }
    cell.count++
    cells.set(key, cell)
  }
  ;[...cells.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .forEach(([key, { count, example: e }]) =>
      console.log(`  bei (${key}) ×${count}  z.B. ${e.kind} x=${e.x} z=${e.z} y=${e.y}`)
    )
  process.exitCode = found.length === 0 ? 0 : 1
} finally {
  await browser.close()
  servers.stop()
}
