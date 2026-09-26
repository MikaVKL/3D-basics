import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import {
  PROTOCOL_VERSION,
  MAX_PLAYERS,
  MAX_NAME_LENGTH,
  DEFAULT_SERVER_PORT,
  TICK_RATE,
  type ClientMessage,
  type PlayerNetworkState,
  type ServerMessage,
  type PlayerId,
  type Scores,
  type Vec3,
  type RosterEntry,
} from '../src/shared/protocol.ts'
import { ARENA_BOUNDS, SPAWN_POINTS } from '../src/shared/arenaLayout.ts'
import {
  MAX_HEALTH,
  MAX_SHIELD,
  RESPAWN_DELAY,
  SPAWN_PROTECTION,
  KILLS_TO_WIN,
  ROUND_END_PAUSE,
  FIRE_COOLDOWN,
  HIT_DAMAGE,
  applyDamage,
  regenerateShield,
  type Vitals,
} from '../src/shared/gameRules.ts'
import type { Team } from '../src/team.ts'

// Läuft direkt als TypeScript (Node-Type-Stripping, kein Build-Schritt)

const PORT = Number(process.env.PORT) || DEFAULT_SERVER_PORT
// Kommagetrennte erlaubte Origins; leer (lokal) = alle erlaubt
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const HELLO_TIMEOUT_MS = 5000
// Erkennt tote Verbindungen (WLAN weg o.ä.)
const HEARTBEAT_INTERVAL_MS = 10000
// Keine Zustände trotz offener Verbindung = eingefrorener Tab (z.B. iPad
// im Hintergrund beantwortet noch Pings) -> entfernen
const STALE_STATE_MS = 15000
// So lange ohne Bewegung, Umschauen oder Schuss -> zurück zum Startbildschirm
const AFK_TIMEOUT_MS = 90000

interface Client {
  id: PlayerId
  name: string
  kills: number
  deaths: number
  socket: WebSocket
  alive: boolean
  team: Team
  // null, bis der Client seinen ersten Zustand geschickt hat
  state: PlayerNetworkState | null
  stateTime: number // Client-Uhr zum Zeitpunkt des letzten Zustands
  // Zählt Respawns; Zustände aus einem früheren Leben werden verworfen
  life: number
  vitals: Vitals
  respawnAt: number | null // performance.now()-Zeitpunkt, solange tot
  protectedUntil: number // Spawn-Schutz bis zu diesem performance.now()-Zeitpunkt
  lastHitAt: number
  lastShotAt: number
  lastStateAt: number
  lastActivityAt: number
  removing: boolean // wird gerade entfernt (Close läuft noch)
}

const clients = new Map<PlayerId, Client>()
let nextPlayerId = 1
let scores: Scores = { red: 0, blue: 0 }
// Per Umgebungsvariable änderbar (kürzere Runden, Tests)
const KILLS_TO_WIN_ACTIVE = Number(process.env.KILLS_TO_WIN) || KILLS_TO_WIN
// Start der nächsten Runde während der Sieger-Anzeige, sonst null
let nextRoundAt: number | null = null
let roundWinner: Team | null = null

// Etwas dichter als die Feuerrate erlaubt (Netzwerk-Schwankungen), aber
// kein Skript-Dauerfeuer
const MIN_HIT_INTERVAL_MS = FIRE_COOLDOWN * 1000 * 0.6
// Arena-Diagonale ~90m
const MAX_HIT_DISTANCE = 100

function isAlive(client: Client): boolean {
  return client.vitals.health > 0
}

// Leer -> "Spieler <id>"
function sanitizeName(raw: unknown, id: PlayerId): string {
  const name = typeof raw === 'string'
    ? raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
    : ''
  return name || `Spieler ${id}`
}

function broadcastRoster() {
  const players: RosterEntry[] = [...clients.values()].map((c) => ({
    id: c.id,
    name: c.name,
    team: c.team,
    kills: c.kills,
    deaths: c.deaths,
  }))
  broadcast({ t: 'roster', players })
}

function isProtected(client: Client, now: number): boolean {
  return now < client.protectedUntil
}

function fullVitals(): Vitals {
  return { health: MAX_HEALTH, shield: MAX_SHIELD, shieldRegenCooldown: 0 }
}

// Nur zum Testen: simulierter Ping (Hälfte pro Richtung) + Jitter
const SIMULATED_LATENCY_MS = Number(process.env.SIMULATED_LATENCY_MS) || 0
const SIMULATED_JITTER_MS = Number(process.env.SIMULATED_JITTER_MS) || 0
const lastDelivery = new WeakMap<WebSocket, { in: number; out: number }>()

function withSimulatedLatency(socket: WebSocket, direction: 'in' | 'out', deliver: () => void) {
  if (SIMULATED_LATENCY_MS === 0 && SIMULATED_JITTER_MS === 0) return deliver()
  const now = performance.now()
  const last = lastDelivery.get(socket) ?? { in: 0, out: 0 }
  // Reihenfolge erhalten wie bei TCP
  const at = Math.max(
    last[direction],
    now + SIMULATED_LATENCY_MS / 2 + Math.random() * SIMULATED_JITTER_MS
  )
  last[direction] = at
  lastDelivery.set(socket, last)
  setTimeout(() => {
    if (socket.readyState === WebSocket.OPEN) deliver()
  }, at - now)
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState !== WebSocket.OPEN) return
  const data = JSON.stringify(message)
  withSimulatedLatency(socket, 'out', () => socket.send(data))
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

// Fängt nur Unsinn ab, prüft keine Bewegung
const BOUNDS_MARGIN = 2
const MAX_HEIGHT = 30

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// Nur bekannte, plausible Felder - kein Client soll beliebige Daten an
// alle weiterreichen können
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
    // Team bestimmt der Server
    team,
  }
}

// Schwellen, damit Rundungsrauschen nicht als Aktivität zählt
function isActivity(before: PlayerNetworkState | null, after: PlayerNetworkState): boolean {
  if (!before) return true
  const a = before.position
  const b = after.position
  return (
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 0.05 ||
    Math.abs(before.yaw - after.yaw) > 0.01 ||
    before.crouching !== after.crouching
  )
}

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

// Punkt mit dem größten Abstand zum nächsten Gegner; belegte Punkte
// (Teamkameraden) nur, wenn nichts anderes frei ist
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

// Nach Tod, zu Rundenbeginn und beim Team-Wechsel
function respawn(client: Client, now: number) {
  client.respawnAt = null
  client.vitals = fullVitals()
  client.protectedUntil = now + SPAWN_PROTECTION * 1000
  const spawnIndex = pickSpawnIndex(client.team)
  // Sofort am Spawn führen, sonst sehen andere kurz die alte Position
  if (client.state) client.state = { ...client.state, position: { ...SPAWN_POINTS[spawnIndex] } }
  client.life += 1
  broadcast({ t: 'respawn', id: client.id, spawnIndex, life: client.life, team: client.team })
}

function teamSizes(): Scores {
  const sizes = { red: 0, blue: 0 }
  for (const client of clients.values()) sizes[client.team] += 1
  return sizes
}

// Ab 2 Spielern Unterschied wechselt der zuletzt Beigetretene des größeren Teams
function balanceTeams(now: number): boolean {
  let changed = false
  for (;;) {
    const sizes = teamSizes()
    if (Math.abs(sizes.red - sizes.blue) < 2) return changed
    const bigger: Team = sizes.red > sizes.blue ? 'red' : 'blue'
    const newest = [...clients.values()].filter((c) => c.team === bigger).at(-1)!
    newest.team = bigger === 'red' ? 'blue' : 'red'
    respawn(newest, now)
    console.log(`Team-Ausgleich: Spieler ${newest.id} wechselt zu ${newest.team}`)
    changed = true
  }
}

function endRound(winner: Team, now: number) {
  roundWinner = winner
  nextRoundAt = now + ROUND_END_PAUSE * 1000
  broadcast({ t: 'roundEnd', winner, nextRoundIn: ROUND_END_PAUSE })
  console.log(`Runde vorbei, Team ${winner} gewinnt (${scores.red}:${scores.blue})`)
}

function startRound(now: number) {
  nextRoundAt = null
  roundWinner = null
  scores = { red: 0, blue: 0 }
  for (const client of clients.values()) {
    client.kills = 0
    client.deaths = 0
  }
  broadcast({ t: 'roundStart', scores })
  balanceTeams(now)
  for (const client of clients.values()) respawn(client, now)
  broadcastRoster()
}

// HTTP-Statusseite (Health-Check des Hostings, Aufwecken)
const httpServer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(`Dusk Arena Server - ${clients.size}/${MAX_PLAYERS} Spieler\n`)
})

const wss = new WebSocketServer({
  server: httpServer,
  verifyClient: ({ origin }: { origin: string }) =>
    ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin),
})

wss.on('connection', (socket) => {
  let client: Client | null = null

  const helloTimeout = setTimeout(() => socket.close(), HELLO_TIMEOUT_MS)

  socket.on('message', (data) => withSimulatedLatency(socket, 'in', () => handleMessage(data)))

  function handleMessage(data: unknown) {
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
      const id = nextPlayerId++
      client = {
        id,
        name: sanitizeName(message.name, id),
        kills: 0,
        deaths: 0,
        socket,
        alive: true,
        team,
        state: null,
        stateTime: 0,
        life: 0,
        vitals: fullVitals(),
        respawnAt: null,
        protectedUntil: performance.now() + SPAWN_PROTECTION * 1000,
        lastHitAt: 0,
        lastShotAt: 0,
        lastStateAt: performance.now(),
        lastActivityAt: performance.now(),
        removing: false,
      }
      clients.set(client.id, client)
      send(socket, {
        t: 'welcome',
        id: client.id,
        team,
        spawnIndex,
        scores,
        killsToWin: KILLS_TO_WIN_ACTIVE,
      })
      broadcastRoster()
      if (nextRoundAt !== null && roundWinner !== null) {
        const nextRoundIn = Math.max(0, (nextRoundAt - performance.now()) / 1000)
        send(socket, { t: 'roundEnd', winner: roundWinner, nextRoundIn })
      }
      console.log(
        `Spieler ${client.id} "${client.name}" verbunden, Team ${team}, Spawn ${spawnIndex} (${clients.size}/${MAX_PLAYERS})`
      )
      return
    }

    if (message.t === 'state') {
      if (message.life !== client.life || !isFiniteNumber(message.time)) return
      const state = sanitizeState(message.state, client.team)
      if (state) {
        const now = performance.now()
        client.lastStateAt = now
        if (isActivity(client.state, state)) client.lastActivityAt = now
        client.state = state
        client.stateTime = message.time
      }
    } else if (message.t === 'hit') {
      handleHit(client, message.target)
    } else if (message.t === 'shot') {
      handleShot(client, message.from, message.to)
    } else if (message.t === 'setName') {
      client.name = sanitizeName(message.name, client.id)
      broadcastRoster()
    }
  }

  socket.on('pong', () => {
    if (client) client.alive = true
  })

  socket.on('close', () => {
    clearTimeout(helloTimeout)
    if (!client) return
    clients.delete(client.id)
    // Neue Runde, sobald niemand mehr da ist
    if (clients.size === 0) {
      scores = { red: 0, blue: 0 }
      nextRoundAt = null
      roundWinner = null
    } else {
      balanceTeams(performance.now())
    }
    broadcastRoster()
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

// Der Schütze meldet Treffer (er sieht Gegner ~100ms verzögert, eine
// Server-Berechnung würde echte Treffer ablehnen); geprüft wird nur, was
// ohne Lag-Ausgleich sicher geht
function handleHit(shooter: Client, targetId: unknown) {
  const target = typeof targetId === 'number' ? clients.get(targetId) : undefined
  if (!target || target === shooter) return
  if (!isAlive(shooter) || !isAlive(target)) return
  if (target.team === shooter.team) return
  if (!shooter.state || !target.state) return

  const now = performance.now()
  if (nextRoundAt !== null) return
  if (isProtected(target, now)) return
  if (now - shooter.lastHitAt < MIN_HIT_INTERVAL_MS) return
  const a = shooter.state.position
  const b = target.state.position
  if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > MAX_HIT_DISTANCE) return
  shooter.lastHitAt = now

  const killed = applyDamage(target.vitals, HIT_DAMAGE)
  send(target.socket, { t: 'hurt', by: shooter.id })
  if (killed) {
    target.respawnAt = now + RESPAWN_DELAY * 1000
    scores[shooter.team] += 1
    shooter.kills += 1
    target.deaths += 1
    broadcast({ t: 'kill', killer: shooter.id, victim: target.id, scores })
    broadcastRoster()
    if (scores[shooter.team] >= KILLS_TO_WIN_ACTIVE) endRound(shooter.team, now)
    console.log(`Spieler ${shooter.id} hat Spieler ${target.id} eliminiert (${scores.red}:${scores.blue})`)
  }
}

function sanitizeVec3(raw: unknown): Vec3 | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y) || !isFiniteNumber(v.z)) return null
  return { x: v.x, y: v.y, z: v.z }
}

const MAX_MUZZLE_OFFSET = 3
const MAX_TRACER_LENGTH = 120

// Reine Optik, trotzdem gefiltert (sonst beliebige Spuren bei allen)
function handleShot(shooter: Client, rawFrom: unknown, rawTo: unknown) {
  const from = sanitizeVec3(rawFrom)
  const to = sanitizeVec3(rawTo)
  if (!from || !to || !shooter.state || !isAlive(shooter)) return

  const now = performance.now()
  if (now - shooter.lastShotAt < MIN_HIT_INTERVAL_MS) return
  const p = shooter.state.position
  if (Math.hypot(from.x - p.x, from.y - p.y, from.z - p.z) > MAX_MUZZLE_OFFSET) return
  if (Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) > MAX_TRACER_LENGTH) return
  shooter.lastShotAt = now
  shooter.lastActivityAt = now
  shooter.protectedUntil = 0

  broadcast({ t: 'shot', id: shooter.id, from, to }, shooter.id)
}

let lastTickAt = performance.now()

// Ein gemeinsamer Snapshot für alle (Clients ignorieren den eigenen Eintrag)
setInterval(() => {
  const now = performance.now()
  const deltaSeconds = (now - lastTickAt) / 1000
  lastTickAt = now
  if (clients.size === 0) return

  if (nextRoundAt !== null && now >= nextRoundAt) startRound(now)

  for (const client of clients.values()) {
    if (client.removing) continue
    if (now - client.lastStateAt > STALE_STATE_MS) {
      console.log(`Spieler ${client.id} sendet nichts mehr (Tab eingefroren?) - entfernt`)
      client.removing = true
      client.socket.terminate()
    } else if (now - client.lastActivityAt > AFK_TIMEOUT_MS) {
      console.log(`Spieler ${client.id} ist AFK - zurück zum Startbildschirm`)
      client.removing = true
      send(client.socket, { t: 'kicked', reason: 'afk' })
      // Kurz warten, damit die Nachricht vor dem Schließen ankommt
      setTimeout(() => client.socket.close(), 500)
    }
  }

  const players = []
  for (const client of clients.values()) {
    if (client.respawnAt !== null && now >= client.respawnAt) {
      respawn(client, now)
    } else if (isAlive(client)) {
      regenerateShield(client.vitals, deltaSeconds)
    }

    if (client.state) {
      players.push({
        id: client.id,
        time: client.stateTime,
        spawnProtected: isProtected(client, now),
        state: {
          ...client.state,
          health: client.vitals.health,
          shield: Math.round(client.vitals.shield * 10) / 10,
          isAlive: isAlive(client),
        },
      })
    }
  }
  broadcast({ t: 'snapshot', players })
}, 1000 / TICK_RATE)

httpServer.listen(PORT, () => {
  console.log(`Dusk Arena Server läuft auf Port ${PORT}`)
  if (SIMULATED_LATENCY_MS || SIMULATED_JITTER_MS) {
    console.log(`Simulierter Ping: ${SIMULATED_LATENCY_MS}ms (hin + zurück) + bis ${SIMULATED_JITTER_MS}ms Jitter je Richtung`)
  }
  if (ALLOWED_ORIGINS.length > 0) console.log(`Erlaubte Origins: ${ALLOWED_ORIGINS.join(', ')}`)
})
