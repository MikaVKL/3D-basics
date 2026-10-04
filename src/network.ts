import {
  PROTOCOL_VERSION,
  DEFAULT_SERVER_PORT,
  TICK_RATE,
  type ClientMessage,
  type ServerMessage,
  type PlayerId,
  type RoundStat,
  type PlayerNetworkState,
  type SnapshotEntry,
  type Scores,
  type Vec3,
  type RosterEntry,
  type KickReason,
} from './shared/protocol'
import type { Team } from './team'
import type { Loadout, WeaponId } from './shared/weapons'
import type { GadgetId } from './shared/gadgets'

// idle = Server vorhanden, aber nicht beigetreten (Startbildschirm/Menü)
export type ConnectionStatus = 'offline' | 'idle' | 'connecting' | 'online' | 'full' | 'outdated'

// ?server=... > VITE_SERVER_URL > im Dev derselbe Rechner (hostname statt
// localhost, damit Tablets im WLAN ihn finden). null = nur Singleplayer.
function resolveServerUrl(): string | null {
  const fromQuery = new URLSearchParams(location.search).get('server')
  if (fromQuery) return fromQuery
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined
  if (configured) return configured
  if (import.meta.env.DEV) return `ws://${location.hostname}:${DEFAULT_SERVER_PORT}`
  return null
}

export interface NetworkHandlers {
  getLocalState: () => PlayerNetworkState
  getName: () => string
  getLoadout: () => Loadout
  onWelcome: (team: Team, spawnIndex: number, scores: Scores, killsToWin: number) => void
  // Snapshot ohne den eigenen Eintrag
  onSnapshot: (players: SnapshotEntry[]) => void
  onOwnVitals: (health: number, shield: number, spawnProtected: boolean) => void
  onKill: (killer: PlayerId, victim: PlayerId, scores: Scores, headshot: boolean, weapon: WeaponId) => void
  onRespawn: (id: PlayerId, spawnIndex: number, team: Team) => void
  onRoundEnd: (winner: Team, nextRoundIn: number, stats: RoundStat[]) => void
  onRoundStart: (scores: Scores) => void
  onRemoteShot: (from: Vec3, to: Vec3, hit: boolean, weapon: WeaponId, shooter: PlayerId) => void
  onRemoteGadget: (kind: GadgetId, from: Vec3, to: Vec3, flight: number, thrower: PlayerId) => void
  onHurt: (by: PlayerId) => void
  // Zurück in den Singleplayer
  onDisconnect: () => void
  // Vom Server entfernt (AFK) - kein automatisches Neuverbinden
  onKicked: (reason: KickReason) => void
  // Server setzt uns an die letzte gültige Position zurück
  onCorrect: (position: Vec3) => void
}

const PING_INTERVAL_MS = 1000
const PING_SAMPLES = 5
const BACKGROUND_STATE_INTERVAL_MS = 1000
const RECONNECT_MIN_MS = 2000
const RECONNECT_MAX_MS = 15000

// Ohne Verbindung läuft das Spiel als Singleplayer; Abbrüche werden im
// Hintergrund neu verbunden. join() beim Klick auf "Spielen", leave() nach
// einer Weile im Menü - damit Abwesende nicht in der Tabelle stehen.
export class NetworkClient {
  status: ConnectionStatus
  // Seit wann erfolglos verbunden wird (HUD-Hinweis "Server wird geweckt")
  connectingSince: number | null = null
  localId: PlayerId | null = null
  readonly remotePlayers = new Set<PlayerId>()
  // Alle Spieler inkl. uns selbst
  readonly roster = new Map<PlayerId, RosterEntry>()
  // Hin und zurück in ms (Median der letzten Messungen), null = unbekannt
  ping: number | null = null
  // performance.now() der letzten Server-Nachricht (Stillstand erkennen)
  private lastMessageAt = 0
  private pingSamples: number[] = []
  private lastStateSentAt = 0

  private readonly url: string | null
  private socket: WebSocket | null = null
  private reconnectDelay = RECONNECT_MIN_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private readonly handlers: NetworkHandlers
  private life = 0
  private wantOnline = false

  constructor(handlers: NetworkHandlers) {
    this.handlers = handlers
    this.url = resolveServerUrl()
    this.status = this.url ? 'idle' : 'offline'
    if (!this.url) return
    // Gratis-Server schon beim Laden wecken (HTTP, ohne beizutreten)
    fetch(this.url.replace(/^ws/, 'http'), { mode: 'no-cors' }).catch(() => {})
    setInterval(() => {
      if (this.status !== 'online') return
      // Im Hintergrund-Tab reicht 1x pro Sekunde (die Browser drosseln die
      // Timer dort ohnehin, aber nicht alle und nicht gleich)
      const now = performance.now()
      if (document.hidden && now - this.lastStateSentAt < BACKGROUND_STATE_INTERVAL_MS) return
      this.lastStateSentAt = now
      this.send({
        t: 'state',
        state: roundState(this.handlers.getLocalState()),
        time: Math.round(performance.now()),
        life: this.life,
      })
    }, 1000 / TICK_RATE)
    setInterval(() => {
      if (this.status === 'online') this.send({ t: 'ping', time: performance.now(), rtt: this.ping })
    }, PING_INTERVAL_MS)
  }

  // Wie lange online schon nichts mehr vom Server kam (sonst 0)
  get silentFor(): number {
    return this.status === 'online' ? performance.now() - this.lastMessageAt : 0
  }

  get playerCount(): number {
    return this.localId === null ? 0 : this.remotePlayers.size + 1
  }

  get hasServer(): boolean {
    return this.url !== null
  }

  join() {
    if (!this.url || this.wantOnline) return
    this.wantOnline = true
    this.reconnectDelay = RECONNECT_MIN_MS
    this.connectingSince ??= performance.now()
    // Alte Verbindung schließt noch -> close-Handler verbindet sofort neu
    if (!this.socket) this.connect()
    else this.status = 'connecting'
  }

  leave() {
    if (!this.wantOnline) return
    this.wantOnline = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.connectingSince = null
    if (this.status !== 'outdated') this.status = 'idle'
    this.socket?.close()
  }

  private connect() {
    this.reconnectTimer = null
    this.status = 'connecting'
    this.connectingSince ??= performance.now()
    const socket = new WebSocket(this.url!)
    this.socket = socket

    socket.addEventListener('open', () => {
      this.send({ t: 'hello', version: PROTOCOL_VERSION, name: this.handlers.getName(), loadout: this.handlers.getLoadout() })
    })

    socket.addEventListener('message', (event) => {
      this.lastMessageAt = performance.now()
      let message: ServerMessage
      try {
        message = JSON.parse(event.data as string)
      } catch {
        return
      }
      this.handleMessage(message)
    })

    socket.addEventListener('close', () => {
      const wasJoining = this.status === 'connecting' && this.localId !== null
      if (this.localId !== null) this.handlers.onDisconnect()
      this.socket = null
      this.localId = null
      this.remotePlayers.clear()
      this.roster.clear()
      this.resetPing()
      // "Veraltet": Neuverbinden sinnlos; "voll": langsam weiter probieren
      if (this.status === 'outdated') return
      if (!this.wantOnline) {
        this.status = 'idle'
        this.connectingSince = null
        return
      }
      if (wasJoining) {
        this.connect()
        return
      }
      if (this.status !== 'full') this.status = 'offline'
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
    })
  }

  private handleMessage(message: ServerMessage) {
    switch (message.t) {
      case 'welcome':
        this.status = 'online'
        this.connectingSince = null
        this.reconnectDelay = RECONNECT_MIN_MS
        this.localId = message.id
        this.life = 0
        this.resetPing()
        this.handlers.onWelcome(message.team, message.spawnIndex, message.scores, message.killsToWin)
        break
      case 'roster':
        this.roster.clear()
        this.remotePlayers.clear()
        for (const entry of message.players) {
          this.roster.set(entry.id, entry)
          if (entry.id !== this.localId) this.remotePlayers.add(entry.id)
        }
        break
      case 'kicked':
        this.wantOnline = false
        // Sofort selbst schließen, damit ein schneller Wiederbeitritt nicht hängt
        this.socket?.close()
        this.handlers.onKicked(message.reason)
        break
      case 'correct':
        this.handlers.onCorrect(message.position)
        break
      case 'rejected':
        this.status = message.reason === 'full' ? 'full' : 'outdated'
        this.connectingSince = null
        break
      case 'snapshot': {
        const own = message.players.find((entry) => entry.id === this.localId)
        if (own) this.handlers.onOwnVitals(own.state.health, own.state.shield, own.spawnProtected)
        this.handlers.onSnapshot(message.players.filter((entry) => entry.id !== this.localId))
        break
      }
      case 'kill':
        this.handlers.onKill(message.killer, message.victim, message.scores, message.headshot, message.weapon)
        break
      case 'respawn':
        if (message.id === this.localId) this.life = message.life
        this.handlers.onRespawn(message.id, message.spawnIndex, message.team)
        break
      case 'roundEnd':
        this.handlers.onRoundEnd(message.winner, message.nextRoundIn, message.stats ?? [])
        break
      case 'roundStart':
        this.handlers.onRoundStart(message.scores)
        break
      case 'shot':
        this.handlers.onRemoteShot(message.from, message.to, message.hit, message.weapon, message.id)
        break
      case 'gadget':
        this.handlers.onRemoteGadget(message.kind, message.from, message.to, message.flight, message.id)
        break
      case 'hurt':
        this.handlers.onHurt(message.by)
        break
      case 'pong':
        this.addPingSample(performance.now() - message.time)
        break
    }
  }

  nameOf(id: PlayerId): string {
    return this.roster.get(id)?.name ?? `Spieler ${id}`
  }

  sendName(name: string) {
    this.send({ t: 'setName', name })
  }

  // Median statt Mittelwert: einzelne Ausreißer (Ruckler) verfälschen nichts
  private addPingSample(sample: number) {
    if (!(sample >= 0)) return
    this.pingSamples.push(sample)
    if (this.pingSamples.length > PING_SAMPLES) this.pingSamples.shift()
    const sorted = [...this.pingSamples].sort((a, b) => a - b)
    this.ping = Math.round(sorted[sorted.length >> 1])
  }

  private resetPing() {
    this.pingSamples = []
    this.ping = null
  }

  sendLoadout(loadout: Loadout) {
    this.send({ t: 'loadout', loadout })
  }

  sendHit(target: PlayerId, headshot: boolean, pellets?: { hit: number; head: number }) {
    this.send(pellets ? { t: 'hit', target, headshot, pellets: pellets.hit, headPellets: pellets.head } : { t: 'hit', target, headshot })
  }

  sendShot(from: Vec3, to: Vec3, hit: boolean) {
    const r = (v: Vec3) => ({ x: round(v.x), y: round(v.y), z: round(v.z) })
    this.send({ t: 'shot', from: r(from), to: r(to), hit })
  }

  sendGadget(kind: GadgetId, from: Vec3, to: Vec3, flight: number) {
    const r = (v: Vec3) => ({ x: round(v.x), y: round(v.y), z: round(v.z) })
    this.send({ t: 'gadget', kind, from: r(from), to: r(to), flight: round(flight) })
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    }
  }
}

// Millimeter-Genauigkeit reicht, spart JSON-Länge
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function roundState(state: PlayerNetworkState): PlayerNetworkState {
  const r = round
  return {
    ...state,
    position: { x: r(state.position.x), y: r(state.position.y), z: r(state.position.z) },
    yaw: r(state.yaw),
  }
}
