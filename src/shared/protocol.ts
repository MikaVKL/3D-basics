// Nachrichtenformat zwischen Client und Server. Diese Datei wird von BEIDEN
// Seiten importiert (Client über Vite, Server direkt über Node) - darum
// keine Imports von Three.js oder DOM-Code hier drin.

import type { Team } from '../team.ts'

// Wird bei jeder inkompatiblen Protokolländerung erhöht. Sonst könnte ein
// Browser mit gecachtem, altem Client-Code einen neueren Server mit
// Nachrichten füttern, die dieser falsch versteht.
export const PROTOCOL_VERSION = 4

export const MAX_PLAYERS = 8
export const DEFAULT_SERVER_PORT = 8080

export type PlayerId = number

// Wie oft Client und Server Zustände verschicken (pro Sekunde).
export const TICK_RATE = 20

// Was jeder Client pro Tick über sich selbst schickt: Position (Kamera/
// Augenhöhe), Blickrichtung (nur Yaw - Pitch ist rein lokal für die eigene
// Kamera relevant) und Leben. Absichtlich ein flaches Objekt aus Zahlen
// (kein THREE.Vector3), damit es 1:1 als JSON verschickt werden kann.
export interface PlayerNetworkState {
  position: { x: number; y: number; z: number }
  yaw: number
  health: number
  maxHealth: number
  isAlive: boolean
  crouching: boolean
  sprinting: boolean
  shield: number
  maxShield: number
  team: Team
}

// health/shield/isAlive im Snapshot stammen immer vom Server, nicht vom
// jeweiligen Client - auch der eigene Eintrag wird so zur Quelle für das
// eigene Leben-HUD.
export interface SnapshotEntry {
  id: PlayerId
  state: PlayerNetworkState
}

export type Scores = Record<Team, number>

export type ClientMessage =
  | { t: 'hello'; version: number }
  | { t: 'state'; state: PlayerNetworkState }
  // "Ich habe Spieler X getroffen" - der Server prüft und entscheidet
  | { t: 'hit'; target: PlayerId }

export type RejectReason = 'full' | 'version'

export type ServerMessage =
  // spawnIndex = Index in SPAWN_POINTS (shared/arenaLayout.ts)
  | {
      t: 'welcome'
      id: PlayerId
      players: PlayerId[]
      team: Team
      spawnIndex: number
      scores: Scores
    }
  | { t: 'join'; id: PlayerId }
  | { t: 'leave'; id: PlayerId }
  | { t: 'rejected'; reason: RejectReason }
  | { t: 'kill'; killer: PlayerId; victim: PlayerId; scores: Scores }
  | { t: 'respawn'; id: PlayerId; spawnIndex: number }
  // time = Server-Uhr in ms, nur relativ zu anderen Snapshots aussagekräftig
  | { t: 'snapshot'; time: number; players: SnapshotEntry[] }
