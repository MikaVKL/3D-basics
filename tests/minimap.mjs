// Minimap: entsteht aus den Arena-Daten (passt sich Erweiterungen an), zeigt dich
// und nur dein Team, Etagen unterschieden.
//
//   node tests/minimap.mjs
import { startServers, launchBrowser, openGame, play, teleport, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []

// RGBA eines Pixels der Zeichenfläche an einer Weltposition
const pixel = (page, layer, x, z) =>
  page.evaluate(
    ([layer, x, z]) => {
      const m = __dusk.minimap
      const canvas = document.querySelector(`#minimap .minimap-${layer}`)
      const factor = canvas.width / (m.bounds.maxX - m.bounds.minX)
      const px = Math.round((x - m.bounds.minX) * factor)
      const pz = Math.round((z - m.bounds.minZ) * factor)
      return [...canvas.getContext('2d').getImageData(px, pz, 1, 1).data]
    },
    [layer, x, z]
  )
const near = (a, b, tolerance = 40) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tolerance)

try {
  const A = await openGame(browser, { name: 'Anna', errors })
  await play(A)
  await wait(800)

  // --- Aufbau aus den Arena-Daten ---
  const built = await A.evaluate(() => {
    const m = __dusk.minimap
    const solids = __dusk.arena.solids
    const minX = Math.min(...solids.map((s) => s.box.min.x))
    const maxX = Math.max(...solids.map((s) => s.box.max.x))
    return { bounds: m.bounds, minX, maxX, count: solids.length, aspect: document.querySelector('#minimap').style.aspectRatio }
  })
  check('Ausschnitt = alle Objekte + 1,5 m Rand', Math.abs(built.bounds.minX - (built.minX - 1.5)) < 0.01 && Math.abs(built.bounds.maxX - (built.maxX + 1.5)) < 0.01, JSON.stringify(built.bounds))
  check('Seitenverhältnis folgt der Arena', built.aspect.includes('/'), built.aspect)
  const wall = await pixel(A, 'static', 0, -21)
  const crate = await pixel(A, 'static', -2, 0)
  const floor = await pixel(A, 'static', -10, -12)
  check('Außenwand gezeichnet (grau)', near(wall, [0x56, 0x6b, 0x82], 30), JSON.stringify(wall))
  check('Kiste gezeichnet (sandbraun)', near(crate, [0xc9, 0x97, 0x5a], 30), JSON.stringify(crate))
  check('freier Boden bleibt leer', floor[3] === 0, JSON.stringify(floor))
  const steg = await pixel(A, 'static', 0, -19)
  check('obere Ebene (Nordsteg) türkis durchscheinend', steg[3] > 60 && steg[1] > steg[0], JSON.stringify(steg))

  // --- Erweiterung: neues Objekt außerhalb der alten Grenzen ---
  const grown = await A.evaluate(() => {
    const m = __dusk.minimap
    const before = { ...m.bounds }
    const T = __dusk.camera.position.constructor
    const box = new (__dusk.arena.solids[0].box.constructor)(new T(88, 0, -5), new T(94, 3, 5))
    __dusk.arena.solids.push({ mesh: __dusk.arena.solids[0].mesh, box })
    m.rebuild()
    return { before, after: { ...m.bounds } }
  })
  check('neue Halle erweitert den Ausschnitt', grown.after.maxX >= 94 + 1.5 - 0.01 && grown.after.maxX > grown.before.maxX, `maxX ${grown.before.maxX} -> ${grown.after.maxX}`)
  const added = await pixel(A, 'static', 91, 0)
  check('neues Objekt erscheint auf der Karte', added[3] > 0, JSON.stringify(added))
  const old = await pixel(A, 'static', -2, 0)
  check('altes Objekt weiter an der richtigen Stelle (Kiste)', near(old, [0xc9, 0x97, 0x5a], 30), JSON.stringify(old))
  await A.evaluate(() => {
    __dusk.arena.solids.pop()
    __dusk.minimap.rebuild()
  })

  // --- Du selbst ---
  await teleport(A, 10, 1.7, 8)
  await wait(400)
  const me = await pixel(A, 'live', 10, 8)
  check('eigener Pfeil an der Spielerposition (weiß)', me[3] > 0 && near(me, [255, 255, 255], 120), JSON.stringify(me))
  check('Anzeige UNTEN auf dem Boden', (await A.textContent('.minimap-floor')) === 'UNTEN')
  await teleport(A, 10, 2.8 + 1.7, -19.5)
  await wait(400)
  check('Anzeige OBEN auf dem Steg', (await A.textContent('.minimap-floor')) === 'OBEN')
  await teleport(A, 10, 1.7, 8)

  // --- Team: nur Kameraden, keine Gegner ---
  // Drei Mitspieler: bei 4 Spielern ist die Aufteilung immer 2:2 (der Server
  // würfelt nur bei Gleichstand), also hat Anna genau eine Kameradin/einen Kameraden
  const pages = { Ben: await openGame(browser, { name: 'Ben', errors }), Cleo: await openGame(browser, { name: 'Cleo', errors }), Dana: await openGame(browser, { name: 'Dana', errors }) }
  for (const page of Object.values(pages)) await play(page)
  await wait(3500)
  const teams = await A.evaluate(() => Object.fromEntries([...__dusk.network.roster.values()].map((p) => [p.name, p.team])))
  const mates = Object.keys(pages).filter((name) => teams[name] === teams.Anna)
  const enemies = Object.keys(pages).filter((name) => teams[name] !== teams.Anna)
  check('Aufteilung 2:2 (ein Kamerad, zwei Gegner)', mates.length === 1 && enemies.length === 2, JSON.stringify(teams))
  const C = pages[mates[0]] // Kamerad
  await teleport(pages[enemies[0]], -12, 1.7, 8) // Gegner
  await teleport(pages[enemies[1]], -12, 1.7, 8)
  await teleport(C, 24, 1.7, 8) // Kamerad, untere Ebene
  await wait(1500)
  const mate = await pixel(A, 'live', 24, 8)
  const enemy = await pixel(A, 'live', -12, 8)
  check('Kamerad als Punkt in Teamfarbe', mate[3] > 200, JSON.stringify(mate))
  check('Gegner werden nicht gezeigt', enemy[3] === 0, JSON.stringify(enemy))
  await teleport(C, 10, 2.8 + 1.7, -19.5) // Kamerad oben
  await wait(1500)
  const upstairs = await pixel(A, 'live', 10, -19.5)
  check('Kamerad auf der anderen Etage gedimmt', upstairs[3] > 40 && upstairs[3] < 160, JSON.stringify(upstairs))
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
