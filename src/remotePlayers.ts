import * as THREE from 'three'
import { PlayerAvatar } from './playerAvatar'
import type { PlayerId, PlayerNetworkState, SnapshotEntry } from './shared/protocol'
import type { Damageable } from './damageable'

// Fremde Spieler werden leicht verzögert gezeigt, damit fast immer zwei
// Zustände zum Interpolieren vorliegen. Interpoliert wird auf der Uhr des
// SENDERS: Client- und Server-Takt laufen nicht synchron, auf der
// Server-Zeitachse ruckelte es (Stillstand, dann doppelter Sprung).
const INTERPOLATION_DELAY_MS = 100
// Anpassung an dauerhaft höheren Ping pro Zustand (niedrigerer: sofort)
const CLOCK_ADAPT_RATE = 0.02
const MAX_BUFFERED_SNAPSHOTS = 30

interface Sample {
  time: number // Uhr des Senders
  state: PlayerNetworkState
}

interface RemotePlayer {
  avatar: PlayerAvatar
  samples: Sample[]
  // Sender-Uhr minus eigene Uhr, am schnellsten Paket ausgerichtet
  // (Jitter fängt der Interpolations-Puffer auf)
  clockOffset: number | null
  spawnProtected: boolean
}

export class RemotePlayers {
  private readonly players = new Map<PlayerId, RemotePlayer>()

  private readonly scene: THREE.Scene
  private readonly shootables: THREE.Object3D[]
  private readonly onHit: (id: PlayerId) => void

  // shootables: Liste der Waffe (Hüllen werden ein-/ausgetragen)
  constructor(scene: THREE.Scene, shootables: THREE.Object3D[], onHit: (id: PlayerId) => void) {
    this.scene = scene
    this.shootables = shootables
    this.onHit = onHit
  }

  applySnapshot(entries: SnapshotEntry[]) {
    const now = performance.now()
    for (const entry of entries) {
      const player = this.players.get(entry.id) ?? this.add(entry.id, entry.state)
      if (player.spawnProtected !== entry.spawnProtected) {
        player.spawnProtected = entry.spawnProtected
        player.avatar.setProtected(entry.spawnProtected)
      }
      const last = player.samples[player.samples.length - 1]
      // Wiederholter Zustand (nichts Neues seit dem letzten Tick)
      if (last && entry.time <= last.time) continue

      const offset = entry.time - now
      if (player.clockOffset === null || offset > player.clockOffset) player.clockOffset = offset
      else player.clockOffset += (offset - player.clockOffset) * CLOCK_ADAPT_RATE

      player.samples.push({ time: entry.time, state: entry.state })
      if (player.samples.length > MAX_BUFFERED_SNAPSHOTS) player.samples.shift()
    }
  }

  private add(id: PlayerId, state: PlayerNetworkState): RemotePlayer {
    const player: RemotePlayer = { avatar: new PlayerAvatar(state.team), samples: [], clockOffset: null, spawnProtected: false }
    // Schaden wird nur gemeldet - ob er zählt, entscheidet der Server
    const damageable: Damageable = {
      get isAlive() {
        const latest = player.samples[player.samples.length - 1]
        return latest ? latest.state.isAlive : true
      },
      get invulnerable() {
        return player.spawnProtected
      },
      takeDamage: () => {
        player.avatar.flash()
        this.onHit(id)
      },
    }
    player.avatar.mesh.userData.damageable = damageable
    this.scene.add(player.avatar.mesh)
    this.shootables.push(player.avatar.mesh)
    this.players.set(id, player)
    return player
  }

  private remove(id: PlayerId, player: RemotePlayer) {
    this.scene.remove(player.avatar.mesh)
    const index = this.shootables.indexOf(player.avatar.mesh)
    if (index !== -1) this.shootables.splice(index, 1)
    player.avatar.dispose()
    this.players.delete(id)
  }

  // Alte Samples verwerfen, sonst gleitet die Figur von der Todesstelle zum Spawn
  handleRespawn(id: PlayerId) {
    const player = this.players.get(id)
    if (player) player.samples.length = 0
  }

  // Hüllen von nicht (mehr) verbundenen Spielern werden entfernt
  update(deltaSeconds: number, connectedIds: ReadonlySet<PlayerId>) {
    for (const [id, player] of this.players) {
      if (!connectedIds.has(id)) this.remove(id, player)
    }
    const now = performance.now()
    for (const player of this.players.values()) {
      if (player.samples.length > 0 && player.clockOffset !== null) {
        const renderTime = now + player.clockOffset - INTERPOLATION_DELAY_MS
        player.avatar.applyState(interpolate(player.samples, renderTime))
      }
      player.avatar.update(deltaSeconds)
    }
  }

  getPosition(id: PlayerId): THREE.Vector3 | null {
    return this.players.get(id)?.avatar.mesh.position.clone() ?? null
  }

  get count(): number {
    return this.players.size
  }
}

function interpolate(samples: Sample[], renderTime: number): PlayerNetworkState {
  while (samples.length > 2 && samples[1].time <= renderTime) samples.shift()

  const [from, to] = samples
  // Zu wenig Daten: letzten Zustand halten statt raten
  if (!to || renderTime <= from.time) return from.state
  if (renderTime >= to.time) return to.state

  const t = (renderTime - from.time) / (to.time - from.time)
  const a = from.state
  const b = to.state
  return {
    // Nur Bewegung wird geglättet
    ...b,
    position: {
      x: THREE.MathUtils.lerp(a.position.x, b.position.x, t),
      y: THREE.MathUtils.lerp(a.position.y, b.position.y, t),
      z: THREE.MathUtils.lerp(a.position.z, b.position.z, t),
    },
    yaw: lerpAngle(a.yaw, b.yaw, t),
  }
}

// Über den kürzeren Weg drehen (sonst volle Drehung bei ±180°)
function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2)
  if (diff > Math.PI) diff -= Math.PI * 2
  if (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}
