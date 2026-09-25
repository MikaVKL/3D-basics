import {
  PROTOCOL_VERSION,
  DEFAULT_SERVER_PORT,
  TICK_RATE,
  type ClientMessage,
  type ServerMessage,
  type PlayerId,
  type PlayerNetworkState,
  type SnapshotEntry,
  type Scores,
  type Vec3,
  type RosterEntry,
  type KickReason,
} from './shared/protocol'
import type { Team } from './team'

// idle = Server vorhanden, aber man ist (noch) nicht beigetreten - z.B. auf
// dem Startbildschirm oder nach einer Weile im Menü
export type ConnectionStatus = 'offline' | 'idle' | 'connecting' | 'online' | 'full' | 'outdated'

// Server-Adresse: ?server=... in der URL hat Vorrang (praktisch zum Testen
// eines Builds gegen einen lokalen Server), dann VITE_SERVER_URL aus dem
// Build. Im Dev-Modus wird automatisch derselbe Rechner angenommen -
// location.hostname statt "localhost", damit auch Tablets im WLAN, die den
// Vite-Server per IP öffnen, den Spielserver finden.
// null = kein Server konfiguriert -> reiner Singleplayer.
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
  // Server hat uns aufgenommen und Team + Spawn-Punkt festgelegt
  onWelcome: (team: Team, spawnIndex: number, scores: Scores, killsToWin: number) => void
  // Snapshot ohne den eigenen Eintrag
  onSnapshot: (players: SnapshotEntry[]) => void
  // Eigenes Leben/Schild laut Server
  onOwnVitals: (health: number, shield: number, spawnProtected: boolean) => void
  onKill: (killer: PlayerId, victim: PlayerId, scores: Scores) => void
  onRespawn: (id: PlayerId, spawnIndex: number, team: Team) => void
  onRoundEnd: (winner: Team, nextRoundIn: number) => void
  onRoundStart: (scores: Scores) => void
  onRemoteShot: (from: Vec3, to: Vec3) => void
  // Wir wurden von Spieler "by" getroffen
  onHurt: (by: PlayerId) => void
  // Verbindung weg (oder nie zustande gekommen) - zurück in den Singleplayer
  onDisconnect: () => void
  // Server hat uns entfernt (z.B. AFK) - kein automatisches Neuverbinden
  onKicked: (reason: KickReason) => void
}

const RECONNECT_MIN_MS = 2000
const RECONNECT_MAX_MS = 15000

// Verbindung zum Spielserver. Das Spiel läuft ohne Verbindung ganz normal
// als Singleplayer weiter - bricht die Verbindung ab, wird im Hintergrund
// neu verbunden (wichtig bei kostenlosem Hosting, das nach Inaktivität
// einschläft und beim ersten Aufruf erst hochfahren muss).
//
// Beigetreten wird erst mit join() (Klick auf "Spielen"), verlassen mit
// leave() (länger im Menü) - sonst standen Leute, die nur auf dem
// Startbildschirm waren oder den Tab im Hintergrund hatten, als Spieler in
// der Punktetabelle.
export class NetworkClient {
  status: ConnectionStatus
  // Seit wann (performance.now) ohne Erfolg verbunden wird - für den HUD-
  // Hinweis, dass ein eingeschlafener Gratis-Server gerade aufwacht
  connectingSince: number | null = null
  localId: PlayerId | null = null
  readonly remotePlayers = new Set<PlayerId>()
  // Alle verbundenen Spieler inkl. uns selbst (Namen, Team, Kills/Tode)
  readonly roster = new Map<PlayerId, RosterEntry>()

  private readonly url: string | null
  private socket: WebSocket | null = null
  private reconnectDelay = RECONNECT_MIN_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private readonly handlers: NetworkHandlers
  private life = 0
  // Soll gerade eine Verbindung bestehen? Steuert das Neuverbinden
  private wantOnline = false

  constructor(handlers: NetworkHandlers) {
    this.handlers = handlers
    this.url = resolveServerUrl()
    this.status = this.url ? 'idle' : 'offline'
    if (!this.url) return
    // Gratis-Server schon beim Laden der Seite wecken (reine HTTP-Anfrage,
    // man tritt dadurch nicht bei) - so ist er meist wach, bis man
    // tatsächlich auf "Spielen" klickt
    fetch(this.url.replace(/^ws/, 'http'), { mode: 'no-cors' }).catch(() => {})
    setInterval(() => {
      if (this.status !== 'online') return
      this.send({
        t: 'state',
        state: roundState(this.handlers.getLocalState()),
        time: Math.round(performance.now()),
        life: this.life,
      })
    }, 1000 / TICK_RATE)
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
    // Schließt sich die alte Verbindung gerade noch, verbindet der
    // close-Handler danach sofort neu (siehe dort)
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
      this.send({ t: 'hello', version: PROTOCOL_VERSION, name: this.handlers.getName() })
    })

    socket.addEventListener('message', (event) => {
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
      // Bei "voll" oder "veraltet" hilft stumpfes Neuverbinden nicht bzw.
      // nur verzögert - "voll" wird trotzdem langsam weiter probiert, da
      // ja jemand gehen kann.
      if (this.status === 'outdated') return
      if (!this.wantOnline) {
        this.status = 'idle'
        this.connectingSince = null
        return
      }
      // Gerade erst (wieder) beigetreten, während die alte Verbindung noch
      // zuging: sofort neu verbinden statt Wartezeit
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
        // Selbst sofort schließen statt auf den Server zu warten - sonst
        // hing ein schneller Klick auf "Spielen" noch an der alten Verbindung
        this.socket?.close()
        this.handlers.onKicked(message.reason)
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
        this.handlers.onKill(message.killer, message.victim, message.scores)
        break
      case 'respawn':
        if (message.id === this.localId) this.life = message.life
        this.handlers.onRespawn(message.id, message.spawnIndex, message.team)
        break
      case 'roundEnd':
        this.handlers.onRoundEnd(message.winner, message.nextRoundIn)
        break
      case 'roundStart':
        this.handlers.onRoundStart(message.scores)
        break
      case 'shot':
        this.handlers.onRemoteShot(message.from, message.to)
        break
      case 'hurt':
        this.handlers.onHurt(message.by)
        break
    }
  }

  nameOf(id: PlayerId): string {
    return this.roster.get(id)?.name ?? `Spieler ${id}`
  }

  sendName(name: string) {
    this.send({ t: 'setName', name })
  }

  sendHit(target: PlayerId) {
    this.send({ t: 'hit', target })
  }

  sendShot(from: Vec3, to: Vec3) {
    const r = (v: Vec3) => ({ x: round(v.x), y: round(v.y), z: round(v.z) })
    this.send({ t: 'shot', from: r(from), to: r(to) })
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    }
  }
}

// Millimeter bzw. ~0.06° Genauigkeit reichen völlig - spart bei 20 Nachrichten
// pro Sekunde spürbar JSON-Länge gegenüber vollen Float-Nachkommastellen.
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
