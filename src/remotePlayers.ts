import * as THREE from 'three'
import { PlayerAvatar } from './playerAvatar'
import type { PlayerId, PlayerNetworkState, SnapshotEntry } from './shared/protocol'

// Fremde Spieler werden absichtlich etwas "in der Vergangenheit" gezeigt:
// So liegen fast immer zwei Snapshots vor, zwischen denen weich
// interpoliert werden kann - statt dass Figuren bei jedem Paket (20x/s)
// ruckartig springen oder bei Netz-Schwankungen stehen bleiben.
const INTERPOLATION_DELAY_MS = 100
const MAX_BUFFERED_SNAPSHOTS = 30

interface Sample {
  time: number // Server-Zeit
  state: PlayerNetworkState
}

interface RemotePlayer {
  avatar: PlayerAvatar
  samples: Sample[]
}

export class RemotePlayers {
  private readonly players = new Map<PlayerId, RemotePlayer>()
  // Differenz Server-Uhr minus lokale Uhr. Wird geglättet, damit einzelne
  // verspätete Pakete die Darstellungszeit nicht hin- und herspringen lassen.
  private clockOffset: number | null = null

  private readonly scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  applySnapshot(serverTime: number, entries: SnapshotEntry[]) {
    const offset = serverTime - performance.now()
    this.clockOffset =
      this.clockOffset === null ? offset : this.clockOffset + (offset - this.clockOffset) * 0.1

    for (const entry of entries) {
      let player = this.players.get(entry.id)
      if (!player) {
        player = { avatar: new PlayerAvatar(entry.state.team), samples: [] }
        this.scene.add(player.avatar.mesh)
        this.players.set(entry.id, player)
      }
      player.samples.push({ time: serverTime, state: entry.state })
      if (player.samples.length > MAX_BUFFERED_SNAPSHOTS) player.samples.shift()
    }
  }

  // connectedIds: wer laut Server gerade verbunden ist - alle anderen
  // Hüllen werden entfernt (Spieler gegangen oder eigene Verbindung weg).
  update(connectedIds: ReadonlySet<PlayerId>) {
    for (const [id, player] of this.players) {
      if (!connectedIds.has(id)) {
        this.scene.remove(player.avatar.mesh)
        player.avatar.dispose()
        this.players.delete(id)
      }
    }
    if (this.clockOffset === null) return

    const renderTime = performance.now() + this.clockOffset - INTERPOLATION_DELAY_MS
    for (const player of this.players.values()) {
      player.avatar.applyState(interpolate(player.samples, renderTime))
    }
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
