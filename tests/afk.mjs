// AFK-Erkennung (Server, rohe WebSocket-Clients): wer stillsteht, fliegt nach der Frist raus - wer sich nur sehr
// langsam umschaut (lauernd zielen) oder langsam schleicht, ist NICHT inaktiv und bleibt.
//
//   node tests/afk.mjs
import WebSocket from 'ws'
import { startServers, SERVER_URL, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const AFK_MS = 4000
const servers = await startServers({ serverEnv: { AFK_TIMEOUT_MS: String(AFK_MS) } })
const { PROTOCOL_VERSION } = await import('../src/shared/protocol.ts')
const { SPAWN_POINTS } = await import('../src/shared/arenaLayout.ts')

// step(state, tick) verändert den Zustand je Tick (20/s)
function client(name, step) {
  const socket = new WebSocket(SERVER_URL)
  const c = { name, kicked: null, closed: false }
  let state = null
  let tick = 0
  socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', version: PROTOCOL_VERSION, name })))
  socket.on('message', (data) => {
    const message = JSON.parse(String(data))
    if (message.t === 'welcome') {
      state = {
        position: { ...SPAWN_POINTS[message.spawnIndex] }, yaw: 0, health: 100, maxHealth: 100, isAlive: true, crouching: false,
        sliding: false, eyeHeight: 1.7, sprinting: false, lean: 0, shield: 25, maxShield: 25, team: message.team, weapon: 'pistol',
      }
    } else if (message.t === 'kicked') c.kicked = message.reason
  })
  socket.on('close', () => (c.closed = true))
  const timer = setInterval(() => {
    if (!state || socket.readyState !== WebSocket.OPEN) return
    step(state, tick++)
    socket.send(JSON.stringify({ t: 'state', state, time: Date.now(), life: 0 }))
  }, 50)
  c.stop = () => {
    clearInterval(timer)
    socket.close()
  }
  return c
}

try {
  const still = client('Still', () => {})
  // 0,008 rad je Tick = ~9°/s: langsamer Schwenk beim Lauern
  const looking = client('Schaut', (s) => (s.yaw += 0.008))
  // 0,03 m je Tick = 0,6 m/s: langsames Schleichen
  const creeping = client('Schleicht', (s, tick) => (s.position.x += tick % 200 < 100 ? 0.03 : -0.03))
  // Rundungsrauschen um einen festen Wert ist keine Aktivität
  const noisy = client('Rauscht', (s, tick) => (s.yaw = tick % 2 ? 0.004 : 0))
  await wait(AFK_MS + 2500)
  check('Stillstand: nach der Frist als AFK entfernt', still.kicked === 'afk', String(still.kicked))
  check('Rundungsrauschen zählt nicht als Aktivität', noisy.kicked === 'afk', String(noisy.kicked))
  check('Langsames Umschauen (9°/s) ist Aktivität: bleibt im Spiel', looking.kicked === null && !looking.closed, String(looking.kicked))
  check('Langsames Schleichen (0,6 m/s) ist Aktivität: bleibt im Spiel', creeping.kicked === null && !creeping.closed, String(creeping.kicked))
  for (const c of [still, looking, creeping, noisy]) c.stop()
} finally {
  servers.stop()
  finish()
}
