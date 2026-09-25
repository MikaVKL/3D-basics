import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import {
  PROTOCOL_VERSION,
  MAX_PLAYERS,
  DEFAULT_SERVER_PORT,
  TICK_RATE,
  type ClientMessage,
  type PlayerNetworkState,
  type ServerMessage,
  type PlayerId,
} from '../src/shared/protocol.ts'

// Läuft direkt als TypeScript über Node (Type-Stripping ab Node 22.18) -
// kein eigener Build-Schritt nötig, weder lokal noch beim Hosting.

const PORT = Number(process.env.PORT) || DEFAULT_SERVER_PORT
const HELLO_TIMEOUT_MS = 5000
// Tote Verbindungen (Tab ohne sauberes close, WLAN weg) würden sonst ewig
// einen der 8 Plätze blockieren.
const HEARTBEAT_INTERVAL_MS = 10000

interface Client {
  id: PlayerId
  socket: WebSocket
  alive: boolean
  // null, bis der Client seinen ersten Zustand geschickt hat
  state: PlayerNetworkState | null
}

const clients = new Map<PlayerId, Client>()
let nextPlayerId = 1

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message))
  }
}

function broadcast(message: ServerMessage, exceptId?: PlayerId) {
  for (const client of clients.values()) {
    if (client.id !== exceptId) send(client.socket, message)
  }
}

function parseMessage(data: unknown): ClientMessage | null {
  try {
    const message = JSON.parse(String(data))
    return typeof message === 'object' && message !== null && typeof message.t === 'string'
      ? (message as ClientMessage)
      : null
  } catch {
    return null
  }
}

// Großzügig um die Arena (halbe Kantenlänge 20) herum - soll nur Unsinn
// abfangen, keine Bewegung prüfen (das kommt in einem späteren Schritt).
const WORLD_LIMIT = 30

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// Nimmt nur bekannte Felder mit plausiblen Werten - der Rest der Nachricht
// wird verworfen, damit kein Client beliebige Daten an alle anderen
// weiterreichen kann.
function sanitizeState(raw: unknown): PlayerNetworkState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as Record<string, any>
  const p = s.position
  if (typeof p !== 'object' || p === null) return null
  const numbers = [p.x, p.y, p.z, s.yaw, s.health, s.maxHealth, s.shield, s.maxShield]
  if (!numbers.every(isFiniteNumber)) return null
  if (Math.abs(p.x) > WORLD_LIMIT || Math.abs(p.z) > WORLD_LIMIT || Math.abs(p.y) > WORLD_LIMIT) {
    return null
  }
  if (s.team !== 'red' && s.team !== 'blue') return null
  return {
    position: { x: p.x, y: p.y, z: p.z },
    yaw: s.yaw,
    health: s.health,
    maxHealth: s.maxHealth,
    isAlive: Boolean(s.isAlive),
    crouching: Boolean(s.crouching),
    sprinting: Boolean(s.sprinting),
    shield: s.shield,
    maxShield: s.maxShield,
    team: s.team,
  }
}

// Einfacher HTTP-Endpunkt: Hosting-Anbieter prüfen per HTTP, ob der Dienst
// lebt - außerdem praktisch zum schnellen Testen im Browser.
const httpServer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(`Dusk Arena Server - ${clients.size}/${MAX_PLAYERS} Spieler\n`)
})

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (socket) => {
  let client: Client | null = null

  const helloTimeout = setTimeout(() => socket.close(), HELLO_TIMEOUT_MS)

  socket.on('message', (data) => {
    const message = parseMessage(data)
    if (!message) return

    if (!client) {
      if (message.t !== 'hello') return
      clearTimeout(helloTimeout)

      if (message.version !== PROTOCOL_VERSION) {
        send(socket, { t: 'rejected', reason: 'version' })
        socket.close()
        return
      }
      if (clients.size >= MAX_PLAYERS) {
        send(socket, { t: 'rejected', reason: 'full' })
        socket.close()
        return
      }

      client = { id: nextPlayerId++, socket, alive: true, state: null }
      clients.set(client.id, client)
      send(socket, { t: 'welcome', id: client.id, players: [...clients.keys()] })
      broadcast({ t: 'join', id: client.id }, client.id)
      console.log(`Spieler ${client.id} verbunden (${clients.size}/${MAX_PLAYERS})`)
      return
    }

    if (message.t === 'state') {
      const state = sanitizeState(message.state)
      if (state) client.state = state
    }
  })

  socket.on('pong', () => {
    if (client) client.alive = true
  })

  socket.on('close', () => {
    clearTimeout(helloTimeout)
    if (!client) return
    clients.delete(client.id)
    broadcast({ t: 'leave', id: client.id })
    console.log(`Spieler ${client.id} getrennt (${clients.size}/${MAX_PLAYERS})`)
  })
})

setInterval(() => {
  for (const client of clients.values()) {
    if (!client.alive) {
      client.socket.terminate()
      continue
    }
    client.alive = false
    client.socket.ping()
  }
}, HEARTBEAT_INTERVAL_MS)

// Ein gemeinsamer Snapshot für alle - jeder Client ignoriert darin seinen
// eigenen Eintrag. Bei max. 8 Spielern ist das billiger und einfacher als
// pro Empfänger eine eigene Liste zu bauen.
setInterval(() => {
  if (clients.size === 0) return
  const players = []
  for (const client of clients.values()) {
    if (client.state) players.push({ id: client.id, state: client.state })
  }
  broadcast({ t: 'snapshot', time: performance.now(), players })
}, 1000 / TICK_RATE)

httpServer.listen(PORT, () => {
  console.log(`Dusk Arena Server läuft auf Port ${PORT}`)
})
