import {
  PROTOCOL_VERSION,
  DEFAULT_SERVER_PORT,
  TICK_RATE,
  type ClientMessage,
  type ServerMessage,
  type PlayerId,
  type PlayerNetworkState,
  type SnapshotEntry,
} from './shared/protocol'

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'full' | 'outdated'

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

const RECONNECT_MIN_MS = 2000
const RECONNECT_MAX_MS = 15000

// Verbindung zum Spielserver. Das Spiel läuft ohne Verbindung ganz normal
// als Singleplayer weiter - bricht die Verbindung ab, wird im Hintergrund
// neu verbunden (wichtig bei kostenlosem Hosting, das nach Inaktivität
// einschläft und beim ersten Aufruf erst hochfahren muss).
export class NetworkClient {
  status: ConnectionStatus = 'offline'
  localId: PlayerId | null = null
  readonly remotePlayers = new Set<PlayerId>()

  private readonly url: string | null
  private socket: WebSocket | null = null
  private reconnectDelay = RECONNECT_MIN_MS
  private readonly getLocalState: () => PlayerNetworkState
  private readonly onSnapshot: (serverTime: number, players: SnapshotEntry[]) => void

  constructor(
    getLocalState: () => PlayerNetworkState,
    onSnapshot: (serverTime: number, players: SnapshotEntry[]) => void
  ) {
    this.getLocalState = getLocalState
    this.onSnapshot = onSnapshot
    this.url = resolveServerUrl()
    if (!this.url) return
    this.connect()
    setInterval(() => {
      if (this.status === 'online') this.send({ t: 'state', state: roundState(this.getLocalState()) })
    }, 1000 / TICK_RATE)
  }

  get playerCount(): number {
    return this.localId === null ? 0 : this.remotePlayers.size + 1
  }

  private connect() {
    this.status = 'connecting'
    const socket = new WebSocket(this.url!)
    this.socket = socket

    socket.addEventListener('open', () => {
      this.send({ t: 'hello', version: PROTOCOL_VERSION })
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
      this.socket = null
      this.localId = null
      this.remotePlayers.clear()
      // Bei "voll" oder "veraltet" hilft stumpfes Neuverbinden nicht bzw.
      // nur verzögert - "voll" wird trotzdem langsam weiter probiert, da
      // ja jemand gehen kann.
      if (this.status === 'outdated') return
      if (this.status !== 'full') this.status = 'offline'
      setTimeout(() => this.connect(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
    })
  }

  private handleMessage(message: ServerMessage) {
    switch (message.t) {
      case 'welcome':
        this.status = 'online'
        this.reconnectDelay = RECONNECT_MIN_MS
        this.localId = message.id
        this.remotePlayers.clear()
        for (const id of message.players) {
          if (id !== message.id) this.remotePlayers.add(id)
        }
        break
      case 'join':
        this.remotePlayers.add(message.id)
        break
      case 'leave':
        this.remotePlayers.delete(message.id)
        break
      case 'rejected':
        this.status = message.reason === 'full' ? 'full' : 'outdated'
        break
      case 'snapshot':
        this.onSnapshot(
          message.time,
          message.players.filter((entry) => entry.id !== this.localId)
        )
        break
    }
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    }
  }
}

// Millimeter bzw. ~0.06° Genauigkeit reichen völlig - spart bei 20 Nachrichten
// pro Sekunde spürbar JSON-Länge gegenüber vollen Float-Nachkommastellen.
function roundState(state: PlayerNetworkState): PlayerNetworkState {
  const r = (value: number) => Math.round(value * 1000) / 1000
  return {
    ...state,
    position: { x: r(state.position.x), y: r(state.position.y), z: r(state.position.z) },
    yaw: r(state.yaw),
  }
}
