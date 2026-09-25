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
  type Scores,
} from '../src/shared/protocol.ts'
import { ARENA_BOUNDS, SPAWN_POINTS } from '../src/shared/arenaLayout.ts'
import {
  MAX_HEALTH,
  MAX_SHIELD,
  RESPAWN_DELAY,
  FIRE_COOLDOWN,
  HIT_DAMAGE,
  applyDamage,
  regenerateShield,
  type Vitals,
} from '../src/shared/gameRules.ts'
import type { Team } from '../src/team.ts'

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
  team: Team
  // null, bis der Client seinen ersten Zustand geschickt hat
  state: PlayerNetworkState | null
  vitals: Vitals
  respawnAt: number | null // performance.now()-Zeitpunkt, solange tot
  lastHitAt: number
}

const clients = new Map<PlayerId, Client>()
let nextPlayerId = 1
let scores: Scores = { red: 0, blue: 0 }

// Treffer-Meldungen dürfen etwas dichter kommen als die Feuerrate, weil
// Netzwerk-Schwankungen zwei Pakete zusammenschieben können - aber nicht
// beliebig dicht (sonst wäre Dauerfeuer per Skript möglich).
const MIN_HIT_INTERVAL_MS = FIRE_COOLDOWN * 1000 * 0.6
// Weiter kann man in der Arena ohnehin nicht schießen (Diagonale ~90m)
const MAX_HIT_DISTANCE = 100

function isAlive(client: Client): boolean {
  return client.vitals.health > 0
}

function fullVitals(): Vitals {
  return { health: MAX_HEALTH, shield: MAX_SHIELD, shieldRegenCooldown: 0 }
}

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

// Etwas Spielraum um die Arena herum - soll nur Unsinn abfangen, keine
// Bewegung prüfen (das kommt in einem späteren Schritt).
const BOUNDS_MARGIN = 2
const MAX_HEIGHT = 30

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// Nimmt nur bekannte Felder mit plausiblen Werten - der Rest der Nachricht
// wird verworfen, damit kein Client beliebige Daten an alle anderen
// weiterreichen kann.
function sanitizeState(raw: unknown, team: Team): PlayerNetworkState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as Record<string, any>
  const p = s.position
  if (typeof p !== 'object' || p === null) return null
  const numbers = [p.x, p.y, p.z, s.yaw, s.health, s.maxHealth, s.shield, s.maxShield]
  if (!numbers.every(isFiniteNumber)) return null
  if (
    p.x < ARENA_BOUNDS.minX - BOUNDS_MARGIN ||
    p.x > ARENA_BOUNDS.maxX + BOUNDS_MARGIN ||
    p.z < ARENA_BOUNDS.minZ - BOUNDS_MARGIN ||
    p.z > ARENA_BOUNDS.maxZ + BOUNDS_MARGIN ||
    Math.abs(p.y) > MAX_HEIGHT
  ) {
    return null
  }
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
    // Team bestimmt ausschließlich der Server, egal was der Client meldet
    team,
  }
}

// Neue Spieler kommen ins kleinere Team, bei Gleichstand zufällig.
function pickTeam(): Team {
  let red = 0
  let blue = 0
  for (const client of clients.values()) {
    if (client.team === 'red') red++
    else blue++
  }
  if (red !== blue) return red < blue ? 'red' : 'blue'
  return Math.random() < 0.5 ? 'red' : 'blue'
}

// Spawn-Punkt, dessen nächster lebender Gegner am weitesten weg ist - so
// spawnt man nicht direkt vor einem Gegner. Punkte, auf denen gerade
// jemand steht, fallen weg (sonst stecken Teamkameraden ineinander),
// solange es noch freie gibt.
const SPAWN_OCCUPIED_RADIUS = 3

function pickSpawnIndex(team: Team): number {
  const living = [...clients.values()].filter((c) => c.state && isAlive(c))
  const enemies = living.filter((c) => c.team !== team).map((c) => c.state!.position)
  const everyone = living.map((c) => c.state!.position)
  const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.hypot(a.x - b.x, a.z - b.z)

  const indices = SPAWN_POINTS.map((_, index) => index)
  const free = indices.filter((index) =>
    everyone.every((p) => distance(p, SPAWN_POINTS[index]) > SPAWN_OCCUPIED_RADIUS)
  )
  const candidates = free.length > 0 ? free : indices

  if (enemies.length === 0) return candidates[Math.floor(Math.random() * candidates.length)]

  let bestIndex = candidates[0]
  let bestDistance = -1
  for (const index of candidates) {
    const nearest = Math.min(...enemies.map((e) => distance(e, SPAWN_POINTS[index])))
    if (nearest > bestDistance) {
      bestDistance = nearest
      bestIndex = index
    }
  }
  return bestIndex
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

      const team = pickTeam()
      const spawnIndex = pickSpawnIndex(team)
      client = {
        id: nextPlayerId++,
        socket,
        alive: true,
        team,
        state: null,
        vitals: fullVitals(),
        respawnAt: null,
        lastHitAt: 0,
      }
      clients.set(client.id, client)
      send(socket, {
        t: 'welcome',
        id: client.id,
        players: [...clients.keys()],
        team,
        spawnIndex,
        scores,
      })
      broadcast({ t: 'join', id: client.id }, client.id)
      console.log(
        `Spieler ${client.id} verbunden, Team ${team}, Spawn ${spawnIndex} (${clients.size}/${MAX_PLAYERS})`
      )
      return
    }

    if (message.t === 'state') {
      const state = sanitizeState(message.state, client.team)
      if (state) client.state = state
    } else if (message.t === 'hit') {
      handleHit(client, message.target)
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
    // Neue Runde, sobald niemand mehr da ist
    if (clients.size === 0) scores = { red: 0, blue: 0 }
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

// Der Schütze meldet, wen er getroffen hat (er sieht die Welt ~100ms
// verzögert, siehe remotePlayers.ts - der Server würde mit eigener
// Treffer-Berechnung ständig echte Treffer ablehnen). Geprüft wird
// deshalb nur, was sich ohne Lag-Ausgleich sicher prüfen lässt.
function handleHit(shooter: Client, targetId: unknown) {
  const target = typeof targetId === 'number' ? clients.get(targetId) : undefined
  if (!target || target === shooter) return
  if (!isAlive(shooter) || !isAlive(target)) return
  if (target.team === shooter.team) return
  if (!shooter.state || !target.state) return

  const now = performance.now()
  if (now - shooter.lastHitAt < MIN_HIT_INTERVAL_MS) return
  const a = shooter.state.position
  const b = target.state.position
  if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > MAX_HIT_DISTANCE) return
  shooter.lastHitAt = now

  if (applyDamage(target.vitals, HIT_DAMAGE)) {
    target.respawnAt = now + RESPAWN_DELAY * 1000
    scores[shooter.team] += 1
    broadcast({ t: 'kill', killer: shooter.id, victim: target.id, scores })
    console.log(`Spieler ${shooter.id} hat Spieler ${target.id} eliminiert (${scores.red}:${scores.blue})`)
  }
}

let lastTickAt = performance.now()

// Ein gemeinsamer Snapshot für alle - jeder Client ignoriert darin seinen
// eigenen Eintrag. Bei max. 8 Spielern ist das billiger und einfacher als
// pro Empfänger eine eigene Liste zu bauen.
setInterval(() => {
  const now = performance.now()
  const deltaSeconds = (now - lastTickAt) / 1000
  lastTickAt = now
  if (clients.size === 0) return

  const players = []
  for (const client of clients.values()) {
    if (client.respawnAt !== null && now >= client.respawnAt) {
      client.respawnAt = null
      client.vitals = fullVitals()
      const spawnIndex = pickSpawnIndex(client.team)
      // Sofort am Spawn-Punkt führen, nicht erst wenn der Client seine neue
      // Position schickt - sonst tauchen andere kurz an der Todesstelle auf.
      if (client.state) client.state = { ...client.state, position: { ...SPAWN_POINTS[spawnIndex] } }
      broadcast({ t: 'respawn', id: client.id, spawnIndex })
    } else if (isAlive(client)) {
      regenerateShield(client.vitals, deltaSeconds)
    }

    if (client.state) {
      players.push({
        id: client.id,
        state: {
          ...client.state,
          health: client.vitals.health,
          shield: Math.round(client.vitals.shield * 10) / 10,
          isAlive: isAlive(client),
        },
      })
    }
  }
  broadcast({ t: 'snapshot', time: now, players })
}, 1000 / TICK_RATE)

httpServer.listen(PORT, () => {
  console.log(`Dusk Arena Server läuft auf Port ${PORT}`)
})
