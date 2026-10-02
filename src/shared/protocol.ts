// Nachrichten Client <-> Server (von beiden importiert: kein Three.js/DOM)

import type { Team } from '../team.ts'
import type { Loadout, WeaponId } from './weapons.ts'

// Bei jeder inkompatiblen Änderung erhöhen (alte, gecachte Clients werden abgewiesen)
export const PROTOCOL_VERSION = 20

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
  sliding: boolean
  // Tatsächliche Augenhöhe (geht beim Ducken fließend), für die Fußhöhe
  eyeHeight: number
  sprinting: boolean
  shield: number
  maxShield: number
  team: Team
  weapon: WeaponId
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
  ping: number | null // vom Spieler gemessen, null = noch unbekannt
}

// Statistik einer Runde (Rundenende), sortiert: meiste Kills zuerst
export interface RoundStat {
  id: PlayerId
  name: string
  team: Team
  kills: number
  deaths: number
  headshots: number // Treffer am Kopf
}

export type ClientMessage =
  // loadout: gewählte Waffen für dieses Leben (fehlt/ungültig = Standard)
  | { t: 'hello'; version: number; name: string; loadout?: Loadout }
  // Neue Wahl: gilt ab dem nächsten Spawn
  | { t: 'loadout'; loadout: Loadout }
  | { t: 'setName'; name: string }
  // life = Nummer des Lebens; Zustände aus früheren Leben verwirft der Server
  | { t: 'state'; state: PlayerNetworkState; time: number; life: number }
  // Schrot: pellets = Körner dieses Schusses, die den Gegner trafen, headPellets davon am Kopf
  | { t: 'hit'; target: PlayerId; headshot: boolean; pellets?: number; headPellets?: number }
  // Laufzeitmessung: Server schickt time unverändert als 'pong' zurück
  | { t: 'ping'; time: number; rtt: number | null } // rtt: zuletzt gemessener Ping
  // Nur für die Leuchtspur bei den anderen
  | { t: 'shot'; from: Vec3; to: Vec3; hit: boolean }

export type RejectReason = 'full' | 'version'

export type KickReason = 'afk' | 'movement'

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
  // Bewegung war unplausibel (zu weit/zu schnell): zurück an die letzte gültige Stelle
  | { t: 'correct'; position: Vec3 }
  | { t: 'kill'; killer: PlayerId; victim: PlayerId; scores: Scores; headshot: boolean; weapon: WeaponId }
  // team ändert sich beim Team-Ausgleich
  | { t: 'respawn'; id: PlayerId; spawnIndex: number; life: number; team: Team }
  // stats fehlt bei älteren Servern
  | { t: 'roundEnd'; winner: Team; nextRoundIn: number; stats?: RoundStat[] }
  | { t: 'roundStart'; scores: Scores }
  // hit: Schuss hat etwas getroffen (Einschlagfunken statt Schuss ins Leere)
  | { t: 'shot'; id: PlayerId; from: Vec3; to: Vec3; hit: boolean; weapon: WeaponId }
  // Nur an den Getroffenen (Richtungsanzeiger)
  | { t: 'hurt'; by: PlayerId }
  | { t: 'pong'; time: number }
  | { t: 'snapshot'; players: SnapshotEntry[] }
