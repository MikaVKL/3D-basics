// Nachrichten Client <-> Server (von beiden importiert: kein Three.js/DOM)

import type { Team } from '../team.ts'

// Bei jeder inkompatiblen Änderung erhöhen (alte, gecachte Clients werden abgewiesen)
export const PROTOCOL_VERSION = 11

export const MAX_PLAYERS = 8
export const MAX_NAME_LENGTH = 16
export const DEFAULT_SERVER_PORT = 8080

export type PlayerId = number

// Zustände pro Sekunde
export const TICK_RATE = 20

// Zustand eines Spielers (Position = Augenhöhe, nur Yaw); flach, damit 1:1 JSON
export interface PlayerNetworkState {
  position: Vec3
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

// health/shield/isAlive kommen immer vom Server (auch fürs eigene HUD)
export interface SnapshotEntry {
  id: PlayerId
  state: PlayerNetworkState
  // Sendezeit laut Uhr des Spielers (Interpolations-Zeitachse)
  time: number
  spawnProtected: boolean
}

export type Scores = Record<Team, number>

export interface Vec3 {
  x: number
  y: number
  z: number
}

// Wird bei jeder Änderung komplett neu geschickt (max. 8 Spieler)
export interface RosterEntry {
  id: PlayerId
  name: string
  team: Team
  kills: number
  deaths: number
}

export type ClientMessage =
  | { t: 'hello'; version: number; name: string }
  | { t: 'setName'; name: string }
  // life = Nummer des Lebens; Zustände aus früheren Leben verwirft der Server
  | { t: 'state'; state: PlayerNetworkState; time: number; life: number }
  | { t: 'hit'; target: PlayerId }
  // Nur für die Leuchtspur bei den anderen
  | { t: 'shot'; from: Vec3; to: Vec3 }

export type RejectReason = 'full' | 'version'

export type KickReason = 'afk'

export type ServerMessage =
  // spawnIndex -> SPAWN_POINTS
  | {
      t: 'welcome'
      id: PlayerId
      team: Team
      spawnIndex: number
      scores: Scores
      killsToWin: number
    }
  | { t: 'roster'; players: RosterEntry[] }
  | { t: 'rejected'; reason: RejectReason }
  | { t: 'kicked'; reason: KickReason }
  | { t: 'kill'; killer: PlayerId; victim: PlayerId; scores: Scores }
  // team ändert sich beim Team-Ausgleich
  | { t: 'respawn'; id: PlayerId; spawnIndex: number; life: number; team: Team }
  | { t: 'roundEnd'; winner: Team; nextRoundIn: number }
  | { t: 'roundStart'; scores: Scores }
  | { t: 'shot'; id: PlayerId; from: Vec3; to: Vec3 }
  // Nur an den Getroffenen (Richtungsanzeiger)
  | { t: 'hurt'; by: PlayerId }
  | { t: 'snapshot'; players: SnapshotEntry[] }
