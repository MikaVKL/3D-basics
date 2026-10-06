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
  type RoundStat,
} from '../src/shared/protocol.ts'
import { ARENA_BOUNDS, SPAWN_POINTS } from '../src/shared/arenaLayout.ts'
import { checkMovement, createMovementCheck, type MovementCheck } from '../src/shared/movementRules.ts'
import {
  MAX_HEALTH,
  MAX_SHIELD,
  RESPAWN_DELAY,
  SPAWN_PROTECTION,
  KILLS_TO_WIN,
  ROUND_END_PAUSE,
  HEADSHOT_MULTIPLIER,
  applyDamage,
  regenerateShield,
  type Vitals,
} from '../src/shared/gameRules.ts'
import { WEAPONS, DEFAULT_LOADOUT, isWeaponId, isLoadout, loadoutSlots, damageFactor, type Loadout } from '../src/shared/weapons.ts'
import { GADGETS, isGadgetId } from '../src/shared/gadgets.ts'
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
  headshots: number
  socket: WebSocket
  alive: boolean
  team: Team
  // null, bis der Client seinen ersten Zustand geschickt hat
  state: PlayerNetworkState | null
  stateTime: number // Client-Uhr zum Zeitpunkt des letzten Zustands
  // Zählt Respawns; Zustände aus einem früheren Leben werden verworfen
  life: number
  // Gewählte Waffen: loadout gilt in diesem Leben, pendingLoadout ab dem nächsten Spawn
  loadout: Loadout
  pendingLoadout: Loadout
  vitals: Vitals
  respawnAt: number | null // performance.now()-Zeitpunkt, solange tot
  protectedUntil: number // Spawn-Schutz bis zu diesem performance.now()-Zeitpunkt
  hitBudget: RateBudget
  shotBudget: RateBudget
  gadgetReadyAt: number // performance.now(), ab dann ist der nächste Wurf erlaubt
  movement: MovementCheck // Basis der Bewegungsprüfung (Spawn-Punkt des Servers)
  movementViolations: number
  lastCorrectionAt: number
  correctionTimes: number[] // Zeitpunkte der letzten Korrekturen (Rauswurf bei Häufung)
  lastStateAt: number
  lastActivityAt: number
  removing: boolean // wird gerade entfernt (Close läuft noch)
  ping: number | null // vom Client gemeldet (nur Anzeige)
  pingShown: number | null // zuletzt in der Spielerliste verschickt
}

const clients = new Map<PlayerId, Client>()
let nextPlayerId = 1
let scores: Scores = { red: 0, blue: 0 }
// Per Umgebungsvariable änderbar (kürzere Runden, Tests)
const KILLS_TO_WIN_ACTIVE = Number(process.env.KILLS_TO_WIN) || KILLS_TO_WIN
// Pause nach Rundenende (Sekunden), für Tests mit langsamen Browsern länger einstellbar
const ROUND_END_PAUSE_ACTIVE = Number(process.env.ROUND_END_PAUSE) || ROUND_END_PAUSE
// Start der nächsten Runde während der Sieger-Anzeige, sonst null
let nextRoundAt: number | null = null
let roundWinner: Team | null = null
let roundStats: RoundStat[] = []

// Im Schnitt höchstens so schnell, wie die Waffe feuert; der kleine Vorrat
// fängt Netzwerk-Schwankungen ab (Pakete kommen oft gebündelt an)
interface RateBudget {
  tokens: number
  updatedAt: number
}
const RATE_BURST = 3

function takeRateToken(budget: RateBudget, intervalSeconds: number, now: number): boolean {
  budget.tokens = Math.min(RATE_BURST, budget.tokens + (now - budget.updatedAt) / (intervalSeconds * 1000))
  budget.updatedAt = now
  if (budget.tokens < 1) return false
  budget.tokens -= 1
  return true
}

// Ping-Werte in der Spielerliste: höchstens alle 2 s und nur bei spürbarer
// Änderung neu verschicken (die Liste geht an alle). Relativ, denn der Ping
// schwankt im WLAN leicht um mehr als ein paar ms.
const PING_ROSTER_INTERVAL_MS = 2000
const PING_ROSTER_MIN_CHANGE = 10 // ms
const PING_ROSTER_MIN_RATIO = 0.15
setInterval(() => {
  const changed = [...clients.values()].some(
    (c) =>
      c.ping !== null &&
      (c.pingShown === null ||
        Math.abs(c.ping - c.pingShown) >= Math.max(PING_ROSTER_MIN_CHANGE, c.pingShown * PING_ROSTER_MIN_RATIO))
  )
  if (changed) broadcastRoster()
}, PING_ROSTER_INTERVAL_MS)

// Zuschlag auf die Waffenreichweite: der Schütze sieht das Ziel ~100ms
// verzögert (Interpolation + Ping), Messer-Ziele können so weiter weg sein
const HIT_RANGE_TOLERANCE = 2

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
    ping: c.ping,
  }))
  for (const c of clients.values()) c.pingShown = c.ping
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

function sendRaw(socket: WebSocket, data: string) {
  if (socket.readyState !== WebSocket.OPEN) return
  withSimulatedLatency(socket, 'out', () => socket.send(data))
}

function send(socket: WebSocket, message: ServerMessage) {
  sendRaw(socket, JSON.stringify(message))
}

// Einmal in Text umwandeln, nicht je Empfänger (der Snapshot ist die größte Nachricht, 20x/s an alle)
function broadcast(message: ServerMessage, exceptId?: PlayerId) {
  const data = JSON.stringify(message)
  for (const client of clients.values()) {
    if (client.id !== exceptId) sendRaw(client.socket, data)
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
function sanitizeState(raw: unknown, team: Team, loadout: Loadout): PlayerNetworkState | null {
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
    sliding: Boolean(s.sliding),
    eyeHeight: isFiniteNumber(s.eyeHeight) ? Math.min(2, Math.max(0.5, s.eyeHeight)) : s.crouching ? 1 : 1.7,
    sprinting: Boolean(s.sprinting),
    lean: isFiniteNumber(s.lean) ? Math.min(1, Math.max(-1, s.lean)) : 0,
    shield: s.shield,
    maxShield: s.maxShield,
    // Team bestimmt der Server
    team,
    // Nur Waffen aus dem gewählten Loadout (sonst die erste), sonst gäbe man sich unterwegs die stärkste
    weapon: isWeaponId(s.weapon) && loadoutSlots(loadout).includes(s.weapon) ? s.weapon : loadoutSlots(loadout)[0],
  }
}

// Zurücksetzen höchstens alle 500 ms; wer trotzdem weitermacht (5 Korrekturen in
// 10 s), fliegt zurück ins Menü
const CORRECTION_INTERVAL_MS = 500
const CORRECTIONS_BEFORE_KICK = 5
const CORRECTION_WINDOW_MS = 10000

function correctMovement(client: Client, now: number) {
  if (now - client.lastCorrectionAt < CORRECTION_INTERVAL_MS) return
  client.lastCorrectionAt = now
  client.correctionTimes = client.correctionTimes.filter((t) => now - t < CORRECTION_WINDOW_MS)
  client.correctionTimes.push(now)
  if (client.correctionTimes.length >= CORRECTIONS_BEFORE_KICK) {
    console.log(`Spieler ${client.id} bewegt sich unmöglich - zurück zum Startbildschirm`)
    client.removing = true
    send(client.socket, { t: 'kicked', reason: 'movement' })
    setTimeout(() => client.socket.close(), 500)
    return
  }
  const { x, y, z } = client.movement
  send(client.socket, { t: 'correct', position: { x, y, z } })
}

// off: keine Prüfung, log: Verstöße nur melden (Beobachtung), enforce: ablehnen
const MOVEMENT_MODE = process.env.MOVEMENT_CHECK ?? 'enforce'

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
  client.loadout = client.pendingLoadout
  client.gadgetReadyAt = 0 // jedes Leben beginnt mit bereitem Gadget
  client.movement = createMovementCheck(SPAWN_POINTS[spawnIndex], client.life, now)
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
  nextRoundAt = now + ROUND_END_PAUSE_ACTIVE * 1000
  roundStats = [...clients.values()]
    .map((c) => ({ id: c.id, name: c.name, team: c.team, kills: c.kills, deaths: c.deaths, headshots: c.headshots }))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.headshots - a.headshots)
  broadcast({ t: 'roundEnd', winner, nextRoundIn: ROUND_END_PAUSE_ACTIVE, stats: roundStats })
  console.log(`Runde vorbei, Team ${winner} gewinnt (${scores.red}:${scores.blue})`)
}

function startRound(now: number) {
  nextRoundAt = null
  roundWinner = null
  scores = { red: 0, blue: 0 }
  for (const client of clients.values()) {
    client.kills = 0
    client.deaths = 0
    client.headshots = 0
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

      const loadout = isLoadout(message.loadout)
        ? { primary: message.loadout.primary, secondary: message.loadout.secondary }
        : { ...DEFAULT_LOADOUT }
      const team = pickTeam()
      const spawnIndex = pickSpawnIndex(team)
      const id = nextPlayerId++
      client = {
        id,
        name: sanitizeName(message.name, id),
        kills: 0,
        deaths: 0,
        headshots: 0,
        socket,
        alive: true,
        team,
        state: null,
        stateTime: 0,
        life: 0,
        loadout,
        pendingLoadout: loadout,
        vitals: fullVitals(),
        respawnAt: null,
        protectedUntil: performance.now() + SPAWN_PROTECTION * 1000,
        hitBudget: { tokens: RATE_BURST, updatedAt: performance.now() },
        shotBudget: { tokens: RATE_BURST, updatedAt: performance.now() },
        gadgetReadyAt: 0,
        movement: createMovementCheck(SPAWN_POINTS[spawnIndex], 0, performance.now()),
        movementViolations: 0,
        lastCorrectionAt: 0,
        correctionTimes: [],
        lastStateAt: performance.now(),
        lastActivityAt: performance.now(),
        removing: false,
        ping: null,
        pingShown: null,
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
        send(socket, { t: 'roundEnd', winner: roundWinner, nextRoundIn, stats: roundStats })
      }
      console.log(
        `Spieler ${client.id} "${client.name}" verbunden, Team ${team}, Spawn ${spawnIndex} (${clients.size}/${MAX_PLAYERS})`
      )
      return
    }

    if (message.t === 'loadout') {
      if (isLoadout(message.loadout)) {
        client.pendingLoadout = { primary: message.loadout.primary, secondary: message.loadout.secondary }
      }
    } else if (message.t === 'state') {
      if (message.life !== client.life || !isFiniteNumber(message.time)) return
      const state = sanitizeState(message.state, client.team, client.loadout)
      if (state) {
        const now = performance.now()
        if (MOVEMENT_MODE !== 'off' && !checkMovement(client.movement, state.position, now)) {
          client.movementViolations++
          // Nicht jeden Zustand melden: nach dem ersten alle 20 Verstöße
          if (client.movementViolations % 20 === 1) {
            console.log(
              `Bewegungsprüfung: Spieler ${client.id} zu weit/zu schnell (${client.movementViolations}. Verstoß, ${MOVEMENT_MODE})`
            )
          }
          if (MOVEMENT_MODE === 'enforce') {
            // Zustand nicht übernehmen; das Leben-Zeitfenster bleibt gültig
            client.lastStateAt = now
            correctMovement(client, now)
            return
          }
        }
        client.lastStateAt = now
        if (isActivity(client.state, state)) client.lastActivityAt = now
        client.state = state
        client.stateTime = message.time
      }
    } else if (message.t === 'ping') {
      // Zählt bewusst nicht als Aktivität (AFK-Erkennung)
      if (isFiniteNumber(message.time)) send(socket, { t: 'pong', time: message.time })
      if (isFiniteNumber(message.rtt)) client.ping = Math.round(Math.min(9999, Math.max(0, message.rtt)))
    } else if (message.t === 'hit') {
      handleHit(client, message.target, message.headshot === true, message.pellets, message.headPellets)
    } else if (message.t === 'shot') {
      handleShot(client, message.from, message.to, message.hit)
    } else if (message.t === 'gadget') {
      handleGadget(client, message.kind, message.from, message.to, message.flight, message.velocity)
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
function handleHit(shooter: Client, targetId: unknown, headshotFlag: boolean, rawPellets?: unknown, rawHeadPellets?: unknown) {
  const target = typeof targetId === 'number' ? clients.get(targetId) : undefined
  if (!target || target === shooter) return
  if (!isAlive(shooter) || !isAlive(target)) return
  if (target.team === shooter.team) return
  if (!shooter.state || !target.state) return

  const now = performance.now()
  if (nextRoundAt !== null) return
  if (isProtected(target, now)) return
  // Waffe laut letztem Zustand: der kommt über dieselbe Verbindung vor dem Treffer an
  const weapon = WEAPONS[shooter.state.weapon]
  const a = shooter.state.position
  const b = target.state.position
  const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  if (distance > weapon.range + HIT_RANGE_TOLERANCE) return
  if (!takeRateToken(shooter.hitBudget, weapon.fireInterval, now)) return
  // Körner (Schrot): Zahl getroffener Körner und davon Kopftreffer, begrenzt auf die Waffe;
  // ohne Angabe (Einzelschuss) 1 Korn, Kopf laut headshot-Flag
  const pelletsHit = isFiniteNumber(rawPellets) ? Math.min(weapon.pellets, Math.max(1, Math.floor(rawPellets))) : 1
  const headPellets = isFiniteNumber(rawHeadPellets)
    ? Math.min(pelletsHit, Math.max(0, Math.floor(rawHeadPellets)))
    : headshotFlag ? pelletsHit : 0
  const headshot = headPellets > 0
  // Angreifen beendet den eigenen Spawn-Schutz (Messer schickt keinen "shot")
  shooter.protectedUntil = 0
  if (headshot) shooter.headshots += 1

  // Schaden fällt mit der Entfernung (nur Schrot); zugunsten des Schützen ~0,5 m Körperradius abziehen
  const perPellet = weapon.damage * damageFactor(weapon, Math.max(0, distance - 0.5))
  const killed = applyDamage(target.vitals, perPellet * (pelletsHit - headPellets + headPellets * HEADSHOT_MULTIPLIER))
  send(target.socket, { t: 'hurt', by: shooter.id })
  if (killed) {
    target.respawnAt = now + RESPAWN_DELAY * 1000
    scores[shooter.team] += 1
    shooter.kills += 1
    target.deaths += 1
    broadcast({ t: 'kill', killer: shooter.id, victim: target.id, scores, headshot, weapon: shooter.state.weapon })
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

// Reine Optik/Ton (beim Messer nur der Stich), trotzdem gefiltert (sonst
// beliebige Spuren bei allen)
function handleShot(shooter: Client, rawFrom: unknown, rawTo: unknown, hit: unknown) {
  const from = sanitizeVec3(rawFrom)
  const to = sanitizeVec3(rawTo)
  if (!from || !to || !shooter.state || !isAlive(shooter)) return

  const now = performance.now()
  const p = shooter.state.position
  if (Math.hypot(from.x - p.x, from.y - p.y, from.z - p.z) > MAX_MUZZLE_OFFSET) return
  if (Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) > MAX_TRACER_LENGTH) return
  if (!takeRateToken(shooter.shotBudget, WEAPONS[shooter.state.weapon].fireInterval, now)) return
  shooter.lastActivityAt = now
  shooter.protectedUntil = 0

  broadcast({ t: 'shot', id: shooter.id, from, to, hit: hit === true, weapon: shooter.state.weapon }, shooter.id)
}

const GADGET_COOLDOWN_TOLERANCE = 1 // s, Ping-Bündelung
const GADGET_ORIGIN_TOLERANCE = 3 // m um die Spielerposition

// Wurf prüfen (Abklingzeit, Weite, Flugzeit) und an die anderen weitergeben; die Wolke selbst
// ist reine Optik, Schüsse gehen durch
function handleGadget(thrower: Client, rawKind: unknown, rawFrom: unknown, rawTo: unknown, rawFlight: unknown, rawVelocity?: unknown) {
  if (!isGadgetId(rawKind)) return
  const from = sanitizeVec3(rawFrom)
  const to = sanitizeVec3(rawTo)
  if (!from || !to || !isFiniteNumber(rawFlight) || !thrower.state || !isAlive(thrower)) return
  const stats = GADGETS[rawKind]
  const now = performance.now()
  if (nextRoundAt !== null) return
  if (now < thrower.gadgetReadyAt - GADGET_COOLDOWN_TOLERANCE * 1000) return
  const p = thrower.state.position
  if (Math.hypot(from.x - p.x, from.y - p.y, from.z - p.z) > GADGET_ORIGIN_TOLERANCE) return
  if (Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) > stats.maxThrowDistance) return
  if (rawFlight < 0 || rawFlight > stats.maxFlightTime) return
  thrower.gadgetReadyAt = now + stats.cooldown * 1000
  thrower.lastActivityAt = now
  // Startgeschwindigkeit nur weitergeben, wenn sie zur Wurfstärke passt (sonst zeigen die anderen einen einfachen Bogen)
  const velocity = sanitizeVec3(rawVelocity)
  const speed = velocity ? Math.hypot(velocity.x, velocity.y, velocity.z) : 0
  const validVelocity = velocity && speed <= (stats.throwSpeed * (1 + stats.throwLift)) * 1.05 ? velocity : undefined
  broadcast({ t: 'gadget', id: thrower.id, kind: rawKind, from, to, flight: rawFlight, ...(validVelocity ? { velocity: validVelocity } : {}) }, thrower.id)
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
