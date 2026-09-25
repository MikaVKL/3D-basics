// Nachrichtenformat zwischen Client und Server. Diese Datei wird von BEIDEN
// Seiten importiert (Client über Vite, Server direkt über Node) - darum
// keine Imports von Three.js oder DOM-Code hier drin.

import type { Team } from '../team.ts'

// Wird bei jeder inkompatiblen Protokolländerung erhöht. Sonst könnte ein
// Browser mit gecachtem, altem Client-Code einen neueren Server mit
// Nachrichten füttern, die dieser falsch versteht.
export const PROTOCOL_VERSION = 10

export const MAX_PLAYERS = 8
export const MAX_NAME_LENGTH = 16
export const DEFAULT_SERVER_PORT = 8080

export type PlayerId = number

// Wie oft Client und Server Zustände verschicken (pro Sekunde).
export const TICK_RATE = 20

// Was jeder Client pro Tick über sich selbst schickt: Position (Kamera/
// Augenhöhe), Blickrichtung (nur Yaw - Pitch ist rein lokal für die eigene
// Kamera relevant) und Leben. Absichtlich ein flaches Objekt aus Zahlen
// (kein THREE.Vector3), damit es 1:1 als JSON verschickt werden kann.
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

// health/shield/isAlive im Snapshot stammen immer vom Server, nicht vom
// jeweiligen Client - auch der eigene Eintrag wird so zur Quelle für das
// eigene Leben-HUD.
export interface SnapshotEntry {
  id: PlayerId
  state: PlayerNetworkState
  // Sendezeitpunkt laut Uhr des jeweiligen Spielers (ms) - Empfänger
  // interpolieren auf dieser Zeitachse, siehe remotePlayers.ts
  time: number
  spawnProtected: boolean
}

export type Scores = Record<Team, number>

export interface Vec3 {
  x: number
  y: number
  z: number
}

// Spielerliste mit Namen und Statistik - kommt bei jeder Änderung
// (Beitritt, Verlassen, Name, Kill) komplett neu, bei max. 8 Spielern
// einfacher und robuster als einzelne Änderungsnachrichten
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
  // time = eigene Uhr (performance.now), life = Nummer des aktuellen Lebens
  // (siehe 'respawn') - Zustände aus einem früheren Leben verwirft der Server
  | { t: 'state'; state: PlayerNetworkState; time: number; life: number }
  // "Ich habe Spieler X getroffen" - der Server prüft und entscheidet
  | { t: 'hit'; target: PlayerId }
  // Jeder Schuss, nur für die Leuchtspur bei den anderen
  | { t: 'shot'; from: Vec3; to: Vec3 }

export type RejectReason = 'full' | 'version'

export type ServerMessage =
  // spawnIndex = Index in SPAWN_POINTS (shared/arenaLayout.ts)
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
  | { t: 'kill'; killer: PlayerId; victim: PlayerId; scores: Scores }
  // team: bei Team-Ausgleich wechselt ein Spieler per Respawn die Seite
  | { t: 'respawn'; id: PlayerId; spawnIndex: number; life: number; team: Team }
  // Runde vorbei - bis zur nächsten Runde zählen keine Treffer
  | { t: 'roundEnd'; winner: Team; nextRoundIn: number }
  | { t: 'roundStart'; scores: Scores }
  | { t: 'shot'; id: PlayerId; from: Vec3; to: Vec3 }
  // Nur an den Getroffenen: wer geschossen hat (für den Richtungsanzeiger)
  | { t: 'hurt'; by: PlayerId }
  | { t: 'snapshot'; players: SnapshotEntry[] }
