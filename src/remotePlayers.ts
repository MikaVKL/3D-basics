import * as THREE from 'three'
import { PlayerAvatar } from './playerAvatar'
import type { PlayerId, PlayerNetworkState, SnapshotEntry } from './shared/protocol'
import type { Damageable } from './damageable'

// Fremde Spieler werden absichtlich etwas "in der Vergangenheit" gezeigt:
// So liegen fast immer zwei Zustände vor, zwischen denen weich
// interpoliert werden kann - statt dass Figuren bei jedem Paket (20x/s)
// ruckartig springen oder bei Netz-Schwankungen stehen bleiben.
//
// Interpoliert wird auf der Uhr des jeweiligen SENDERS, nicht des Servers:
// Server- und Client-Takt (beide 20Hz) laufen nicht synchron, dadurch
// enthielt mal ein Server-Tick keinen neuen Zustand und der nächste zwei -
// auf der Server-Zeitachse stand die Figur dann kurz und sprang danach
// doppelt so weit (bei 150ms Ping gemessen: p90 12 statt 6 m/s).
const INTERPOLATION_DELAY_MS = 100
// Wie schnell sich die Uhr-Schätzung an einen dauerhaft höheren Ping
// anpasst (Anteil pro Zustand). Niedrigerer Ping wird sofort übernommen.
const CLOCK_ADAPT_RATE = 0.02
const MAX_BUFFERED_SNAPSHOTS = 30

interface Sample {
  time: number // Uhr des Senders
  state: PlayerNetworkState
}

interface RemotePlayer {
  avatar: PlayerAvatar
  samples: Sample[]
  // Sender-Uhr minus eigene Uhr, bezogen auf das schnellste bisher
  // angekommene Paket - langsamere (Jitter) werden durch den
  // Interpolations-Puffer aufgefangen, statt die Zeitachse zu verschieben.
  clockOffset: number | null
  // Direkt aus dem neuesten Snapshot, nicht interpoliert
  spawnProtected: boolean
}

export class RemotePlayers {
  private readonly players = new Map<PlayerId, RemotePlayer>()

  private readonly scene: THREE.Scene
  private readonly shootables: THREE.Object3D[]
  private readonly onHit: (id: PlayerId) => void

  // shootables: dieselbe Liste, die die Waffe durchsucht - fremde Hüllen
  // werden dort ein-/ausgetragen. onHit: Treffer an den Server melden.
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
      // Server schickt denselben Zustand erneut, wenn seit dem letzten Tick
      // nichts Neues vom Spieler kam - kein neuer Stützpunkt
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
    // Die Waffe behandelt fremde Spieler wie jedes andere Damageable (siehe
    // damageable.ts) - Schaden wird hier aber nicht lokal verrechnet,
    // sondern nur gemeldet. Ob der Treffer zählt, entscheidet der Server.
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

  // Nach einem Respawn nicht von der Todes-Stelle zum Spawn-Punkt gleiten:
  // alte Samples verwerfen, der nächste Snapshot setzt die Hülle direkt.
  handleRespawn(id: PlayerId) {
    const player = this.players.get(id)
    if (player) player.samples.length = 0
  }

  // connectedIds: wer laut Server gerade verbunden ist - alle anderen
  // Hüllen werden entfernt (Spieler gegangen oder eigene Verbindung weg).
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

  // Aktuell dargestellte Position (Körpermitte) eines Spielers
  getPosition(id: PlayerId): THREE.Vector3 | null {
    return this.players.get(id)?.avatar.mesh.position.clone() ?? null
  }

  get count(): number {
    return this.players.size
  }
}

function interpolate(samples: Sample[], renderTime: number): PlayerNetworkState {
  // Ältere Samples, die nicht mehr gebraucht werden, verwerfen
  while (samples.length > 2 && samples[1].time <= renderTime) samples.shift()

  const [from, to] = samples
  // Kein zweiter Wert (noch zu wenig Daten oder Pakete bleiben aus): letzten
  // bekannten Zustand halten statt zu raten.
  if (!to || renderTime <= from.time) return from.state
  if (renderTime >= to.time) return to.state

  const t = (renderTime - from.time) / (to.time - from.time)
  const a = from.state
  const b = to.state
  return {
    // Zustände wie Ducken/Team/Leben springen, nur Bewegung wird geglättet
    ...b,
    position: {
      x: THREE.MathUtils.lerp(a.position.x, b.position.x, t),
      y: THREE.MathUtils.lerp(a.position.y, b.position.y, t),
      z: THREE.MathUtils.lerp(a.position.z, b.position.z, t),
    },
    yaw: lerpAngle(a.yaw, b.yaw, t),
  }
}

// Über den kürzeren Weg drehen - sonst dreht sich eine Figur beim Übergang
// von +179° auf -179° einmal fast komplett um sich selbst.
function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2)
  if (diff > Math.PI) diff -= Math.PI * 2
  if (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}
