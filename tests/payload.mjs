// Kaputte Verbindungen (Server): ein ungültiger WebSocket-Frame oder eine übergroße Nachricht beendet nur die eigene
// Verbindung - der Server läuft weiter, normale Spieler merken nichts. Die größten echten Nachrichten (Zustand,
// Gadget-Wurf) bleiben weit unter der Größengrenze.
//
//   node tests/payload.mjs
import WebSocket from 'ws'
import { startServers, SERVER_URL, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const { PROTOCOL_VERSION } = await import('../src/shared/protocol.ts')

function connect(name) {
  const socket = new WebSocket(SERVER_URL)
  const c = { socket, welcome: null, closeCode: null, snapshots: 0 }
  socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', version: PROTOCOL_VERSION, name, loadout: { primary: 'shotgun', secondary: 'heavyPistol' }, team: 'blue' })))
  socket.on('message', (data) => {
    const message = JSON.parse(String(data))
    if (message.t === 'welcome') c.welcome = message
    if (message.t === 'snapshot') c.snapshots++
  })
  socket.on('close', (code) => (c.closeCode = code))
  socket.on('error', () => {})
  return c
}

try {
  const good = connect('Normal')
  const bad = connect('Riesig')
  await wait(500)
  const state = {
    position: { x: -27.123, y: 12.345, z: -27.123 }, yaw: -3.141, health: 100, maxHealth: 100, isAlive: true, crouching: false, sliding: false,
    eyeHeight: 1.234, sprinting: false, lean: -0.123, shield: 25, maxShield: 25, team: 'blue', weapon: 'heavyPistol',
  }
  const biggest = JSON.stringify({ t: 'state', state, time: 123456789, life: 123 })
  const gadget = JSON.stringify({ t: 'gadget', kind: 'grapple', from: { x: -27.123, y: 12.345, z: -27.123 }, to: { x: -27.123, y: 12.345, z: -27.123 }, flight: 1.234, velocity: { x: -19.123, y: -19.123, z: -19.123 } })
  check('Echte Nachrichten liegen weit unter der Grenze (< 1024 Zeichen)', biggest.length < 1024 && gadget.length < 1024, `Zustand ${biggest.length}, Gadget ${gadget.length}`)

  // Ungültiger Frame (reservierter Opcode, unmaskiert) direkt auf die Leitung
  const broken = connect('Kaputt')
  await wait(400)
  broken.socket._socket.write(Buffer.from([0x8f, 0x00]))
  await wait(600)
  check('Ungültiger Frame: Server läuft weiter', servers.serverExitCode() === null, servers.serverErrors().split('\n').find((l) => l.includes('Error')) ?? '')
  check('Ungültiger Frame: nur diese Verbindung endet', broken.closeCode !== null && good.closeCode === null, `kaputt ${broken.closeCode}, normal ${good.closeCode}`)

  bad.socket.send(JSON.stringify({ t: 'setName', name: 'x'.repeat(1024 * 1024) }))
  await wait(700)
  check('1 MB große Nachricht: Verbindung wird geschlossen (1009)', bad.closeCode === 1009, String(bad.closeCode))
  const before = good.snapshots
  good.socket.send(biggest)
  await wait(500)
  check('Der andere Spieler bleibt verbunden und bekommt weiter Zustände', good.closeCode === null && good.snapshots > before, `${good.closeCode}, ${good.snapshots - before} Snapshots`)
  check('Server läuft ohne Fehler weiter', servers.serverExitCode() === null && servers.serverErrors() === '', servers.serverErrors())
  good.socket.close()
} finally {
  servers.stop()
  finish()
}
