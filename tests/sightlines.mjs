// Sichtlinien-Messung (Werkzeug, nicht in `npm test`): wie weit sieht man auf einer Karte? Vergleicht Nexus mit der
// Testkarte Skyline (Sniper-Sorge: Skyline soll auch Nahkampf bieten). Rechnet nur mit den Kartendaten
// (`arena.solids`, `arena.ramps`), unabhängig von der Bildrate.
//
// Standpunkte: Raster über alle begehbaren Flächen (Boden, Oberseiten mit voller Standfläche und 1,8 m Kopffreiheit,
// Rampen), Auge 1,7 m über den Füßen. Für jedes Paar von Standpunkten: freie Sicht Auge -> Auge?
//
//   node tests/sightlines.mjs [raster=1.5]
import { startServers, launchBrowser, GAME_URL } from './lib.mjs'

const STEP = Number(process.argv[2] ?? 1.5)
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()

async function measure(name, query, hasGround) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } })
  await page.goto(`${GAME_URL}${query}`)
  await page.waitForFunction(() => 'undefined' !== typeof window.__dusk)
  const result = await page.evaluate(
    ([STEP, hasGround]) => {
      const EYE = 1.7
      const R = 0.3
      const boxes = __dusk.arena.solids.map(({ box }) => [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z])
      const ramps = __dusk.arena.ramps
      const rampHeight = (r, x, z) => {
        if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) return null
        const t = r.axis === 'x' ? (x - r.minX) / (r.maxX - r.minX) : (z - r.minZ) / (r.maxZ - r.minZ)
        return r.bottomHeight + (r.topHeight - r.bottomHeight) * (r.ascending ? t : 1 - t)
      }
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const b of boxes) {
        minX = Math.min(minX, b[0]); maxX = Math.max(maxX, b[3]); minZ = Math.min(minZ, b[2]); maxZ = Math.max(maxZ, b[5])
      }
      const supported = (x, z, h) => (hasGround && h === 0) || boxes.some((b) => Math.abs(b[4] - h) < 0.01 && x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5])
      const headroom = (x, z, h) =>
        !boxes.some((b) => x + R > b[0] && x - R < b[3] && z + R > b[2] && z - R < b[5] && h + 1.8 > b[1] + 0.01 && h + 0.05 < b[4]) &&
        !ramps.some((r) => {
          const rh = rampHeight(r, x, z)
          return rh !== null && rh > h + 0.05 && r.bottomHeight < h + 1.8
        })

      // Standpunkte
      const points = []
      for (let x = minX + STEP / 2; x < maxX; x += STEP) {
        for (let z = minZ + STEP / 2; z < maxZ; z += STEP) {
          const heights = new Set(hasGround ? [0] : [])
          for (const b of boxes) if (b[4] < 40 && x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) heights.add(b[4])
          for (const h of heights) {
            const full = [[-R, -R], [R, -R], [-R, R], [R, R]].every(([dx, dz]) => supported(x + dx, z + dz, h))
            if (full && headroom(x, z, h)) points.push([x, h + EYE, z])
          }
          for (const r of ramps) {
            const rh = rampHeight(r, x, z)
            if (rh !== null && headroom(x, z, rh)) points.push([x, rh + EYE, z])
          }
        }
      }

      // Strecke a -> b frei? Quader per Slab-Test, Rampen-Keile per Abtastung
      const blocked = (a, b) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
        for (const q of boxes) {
          let t0 = 0, t1 = 1
          const axis = (o, d, lo, hi) => {
            if (Math.abs(d) < 1e-9) return o > lo && o < hi
            let n = (lo - o) / d, f = (hi - o) / d
            if (n > f) [n, f] = [f, n]
            t0 = Math.max(t0, n); t1 = Math.min(t1, f)
            return t0 < t1
          }
          if (axis(a[0], dx, q[0], q[3]) && axis(a[1], dy, q[1], q[4]) && axis(a[2], dz, q[2], q[5])) return true
        }
        if (ramps.length) {
          const length = Math.hypot(dx, dy, dz)
          const steps = Math.ceil(length / 0.3)
          for (let i = 1; i < steps; i++) {
            const t = i / steps
            const x = a[0] + dx * t, y = a[1] + dy * t, z = a[2] + dz * t
            for (const r of ramps) {
              const rh = rampHeight(r, x, z)
              if (rh !== null && y < rh && y > r.bottomHeight) return true
            }
          }
        }
        return false
      }

      const distances = []
      const farthest = new Array(points.length).fill(0)
      let pairs = 0
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          pairs++
          if (blocked(points[i], points[j])) continue
          const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1], points[i][2] - points[j][2])
          distances.push(d)
          if (d > farthest[i]) farthest[i] = d
          if (d > farthest[j]) farthest[j] = d
        }
      }
      distances.sort((p, q) => p - q)
      farthest.sort((p, q) => p - q)
      const share = (limit) => distances.filter((d) => d > limit).length / distances.length
      const levels = {}
      for (const p of points) {
        const key = Math.round(p[1] - EYE)
        levels[key] = (levels[key] ?? 0) + 1
      }
      return {
        points: points.length,
        levels,
        visibleShare: distances.length / pairs,
        median: distances[Math.floor(distances.length / 2)],
        p90: distances[Math.floor(distances.length * 0.9)],
        max: distances[distances.length - 1],
        over20: share(20), over30: share(30), over40: share(40),
        under10: 1 - share(10),
        // Anteil der Standpunkte, von denen aus man irgendwen auf über 30 m sieht
        pointsSeeing30: farthest.filter((d) => d > 30).length / points.length,
      }
    },
    [STEP, hasGround]
  )
  await page.close()
  return { name, ...result }
}

try {
  const maps = [await measure('Nexus', '', true), await measure('Skyline', '?map=skyline', false)]
  const pct = (v) => `${(v * 100).toFixed(1)} %`
  const m = (v) => `${v.toFixed(1)} m`
  const rows = [
    ['Standpunkte', (r) => String(r.points)],
    ['Paare mit freier Sicht', (r) => pct(r.visibleShare)],
    ['Sichtweite Median', (r) => m(r.median)],
    ['Sichtweite 90 %', (r) => m(r.p90)],
    ['längste Sichtlinie', (r) => m(r.max)],
    ['Sichtlinien unter 10 m', (r) => pct(r.under10)],
    ['Sichtlinien über 20 m', (r) => pct(r.over20)],
    ['Sichtlinien über 30 m', (r) => pct(r.over30)],
    ['Sichtlinien über 40 m', (r) => pct(r.over40)],
    ['Fläche mit Sicht über 30 m', (r) => pct(r.pointsSeeing30)],
  ]
  console.log(`Raster ${STEP} m\n`)
  console.log(`${''.padEnd(30)}${maps.map((r) => r.name.padStart(12)).join('')}`)
  for (const [label, format] of rows) console.log(`${label.padEnd(30)}${maps.map((r) => format(r).padStart(12)).join('')}`)
  for (const r of maps) console.log(`\n${r.name}: Standpunkte je Höhe (m) ${JSON.stringify(r.levels)}`)
} finally {
  await browser.close()
  servers.stop()
}
