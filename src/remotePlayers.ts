import * as THREE from 'three'
import { PlayerAvatar } from './playerAvatar'
import type { PlayerId, PlayerNetworkState, SnapshotEntry } from './shared/protocol'
import type { Damageable } from './damageable'

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
  private readonly shootables: THREE.Object3D[]
  private readonly onHit: (id: PlayerId) => void

  // shootables: dieselbe Liste, die die Waffe durchsucht - fremde Hüllen
  // werden dort ein-/ausgetragen. onHit: Treffer an den Server melden.
  constructor(scene: THREE.Scene, shootables: THREE.Object3D[], onHit: (id: PlayerId) => void) {
    this.scene = scene
    this.shootables = shootables
    this.onHit = onHit
  }

  applySnapshot(serverTime: number, entries: SnapshotEntry[]) {
    const offset = serverTime - performance.now()
    this.clockOffset =
      this.clockOffset === null ? offset : this.clockOffset + (offset - this.clockOffset) * 0.1

    for (const entry of entries) {
      let player = this.players.get(entry.id)
      if (!player) {
        player = this.add(entry.id, entry.state)
      }
      player.samples.push({ time: serverTime, state: entry.state })
      if (player.samples.length > MAX_BUFFERED_SNAPSHOTS) player.samples.shift()
    }
  }

  private add(id: PlayerId, state: PlayerNetworkState): RemotePlayer {
    const player: RemotePlayer = { avatar: new PlayerAvatar(state.team), samples: [] }
    // Die Waffe behandelt fremde Spieler wie jedes andere Damageable (siehe
    // damageable.ts) - Schaden wird hier aber nicht lokal verrechnet,
    // sondern nur gemeldet. Ob der Treffer zählt, entscheidet der Server.
    const damageable: Damageable = {
      get isAlive() {
        const latest = player.samples[player.samples.length - 1]
        return latest ? latest.state.isAlive : true
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
    if (this.clockOffset === null) return

    const renderTime = performance.now() + this.clockOffset - INTERPOLATION_DELAY_MS
    for (const player of this.players.values()) {
      if (player.samples.length > 0) player.avatar.applyState(interpolate(player.samples, renderTime))
      player.avatar.update(deltaSeconds)
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
