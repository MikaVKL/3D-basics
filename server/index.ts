import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import {
  PROTOCOL_VERSION,
  MAX_PLAYERS,
  DEFAULT_SERVER_PORT,
  type ClientMessage,
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

      client = { id: nextPlayerId++, socket, alive: true }
      clients.set(client.id, client)
      send(socket, { t: 'welcome', id: client.id, players: [...clients.keys()] })
      broadcast({ t: 'join', id: client.id }, client.id)
      console.log(`Spieler ${client.id} verbunden (${clients.size}/${MAX_PLAYERS})`)
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

httpServer.listen(PORT, () => {
  console.log(`Dusk Arena Server läuft auf Port ${PORT}`)
})
