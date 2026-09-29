// Bewegungsprüfung des Servers (src/shared/movementRules.ts): keine
// Fehlalarme bei echten Spuren aus dem Spiel (zufällige Bewegung mit Rutschen,
// Bunny-Hop, Rampen, Stürzen) - auch bei Ping-Bündelung und Hintergrund-Tab -
// und jeder simulierte Cheat wird erkannt.
//
//   node tests/movement-check.mjs
import { startServers, launchBrowser, openGame, play, createChecks } from './lib.mjs'
import { createMovementCheck, checkMovement } from '../src/shared/movementRules.ts'

const { check, finish } = createChecks()
const RUNS = 40
const SECONDS = 30

const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
let traces
try {
  const page = await openGame(browser, { online: false })
  await play(page)
  traces = await page.evaluate(
    ([runs, seconds]) => {
      const P = __dusk.player
      const cam = __dusk.camera
      const DT = 1 / 60
      let seed = 12345
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0
        return seed / 4294967296
      }
      const pick = (list) => list[Math.floor(random() * list.length)]
      const result = []
      for (let r = 0; r < runs; r++) {
        // Start auf dem Boden irgendwo im Hauptraum
        const x = -18 + random() * 48
        const z = -18 + random() * 36
        P.spawn({ x, y: P.groundHeightAt(x, z) + 1.7, z, clone() { return this } })
        const trace = []
        let time = 0
        let nextDecision = 0
        for (let f = 0; f < seconds * 60; f++) {
          if (time >= nextDecision) {
            nextDecision = time + 0.3 + random() * 1.2
            cam.rotation.set(0, random() * Math.PI * 2, 0, 'YXZ')
            P.setMoveInput(pick([-1, 0, 1]), pick([1, 1, 1, 0, -1]))
            P.setSprinting(random() < 0.7)
            P.setCrouching(random() < 0.25)
            if (random() < 0.5) P.jump()
          }
          if (random() < 0.02) P.jump()
          P.update(DT)
          time += DT
          if (f % 3 === 0) {
            const p = P.getNetworkState().position
            trace.push([Math.round(time * 1000), p.x, p.y, p.z])
          }
        }
        result.push(trace)
      }
      return result
    },
    [RUNS, SECONDS]
  )
} finally {
  await browser.close()
  servers.stop()
}

// Ergebnis: Anzahl Verstöße beim Abspielen einer Spur. Die Ankunftszeit
// wächst monoton (WebSocket liefert in Reihenfolge; Verzögerung bündelt nur).
function replay(trace, delay) {
  const [t0, x0, y0, z0] = trace[0]
  const state = createMovementCheck({ x: x0, y: y0, z: z0 }, 0, t0)
  let violations = 0
  let last = t0
  for (const s of trace.slice(1)) {
    last = Math.max(last, delay(s[0]))
    if (!checkMovement(state, { x: s[1], y: s[2], z: s[3] }, last)) violations++
  }
  return violations
}

let seed = 7
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
const samples = traces.reduce((n, t) => n + t.length, 0)
const modes = {
  'exakt 20 Hz': (t) => t,
  'Ping 150 ms + Jitter 30 ms': (t) => t + 150 + random() * 60 - 30,
  'starker Jitter (0-400 ms, gebündelt)': (t) => t + random() * 400,
  'Hintergrund-Tab (1 Zustand/s, gebündelt)': (t) => Math.ceil(t / 1000) * 1000,
  'eingefroren 1,4 s, dann alles auf einmal': (t) => Math.ceil(t / 1400) * 1400,
}
for (const [name, delay] of Object.entries(modes)) {
  let violations = 0
  for (const trace of traces) violations += replay(trace, delay)
  check(`keine Fehlalarme: ${name}`, violations === 0, `${violations} von ${samples} Zuständen`)
}

// Cheats ab Zustand 40: Wie viele Zustände (je 50 ms) vergehen bis zur ersten
// Ablehnung? Danach setzt der Server den Spieler zurück (Stufe 2), deshalb
// zählt nur der erste Verstoß.
function cheat(name, transform, maxStates) {
  const delays = []
  for (const trace of traces.slice(0, 10)) {
    const [t0, x0, y0, z0] = trace[0]
    const state = createMovementCheck({ x: x0, y: y0, z: z0 }, 0, t0)
    let offset = { x: 0, y: 0, z: 0 }
    let delay = Infinity
    trace.slice(1).forEach((s, i) => {
      if (i > 40) offset = transform(offset, i - 40)
      const ok = checkMovement(state, { x: s[1] + offset.x, y: s[2] + offset.y, z: s[3] + offset.z }, s[0])
      if (i > 40 && !ok && delay === Infinity) delay = i - 40
    })
    delays.push(delay)
  }
  const worst = Math.max(...delays)
  check(`Cheat erkannt: ${name}`, worst <= maxStates, `spätestens nach ${worst} Zuständen (${(worst * 0.05).toFixed(2)} s), alle 10 Spuren`)
}
// Ein Sprung bis ~24 m (1,5 s Guthaben) ist bauartbedingt erlaubt; im Mittel
// bleibt die Geschwindigkeit bei 16 m/s. Darüber wird sofort abgelehnt.
cheat('Teleport 40 m in einem Schritt', (o, i) => (i === 1 ? { x: 40, y: 0, z: 0 } : o), 1)
cheat('Teleport 40 m nach oben', (o, i) => (i === 1 ? { x: 0, y: 40, z: 0 } : o), 1)
// Läuft der Spieler gegen die Cheat-Richtung, ist er netto kaum schneller als
// erlaubt - das dauert entsprechend länger
cheat('Speedhack +25 m/s', (o) => ({ x: o.x + 1.25, y: o.y, z: o.z }), 100)
cheat('Fliegen 20 m/s aufwärts', (o) => ({ x: o.x, y: o.y + 1, z: o.z }), 60)

finish()
