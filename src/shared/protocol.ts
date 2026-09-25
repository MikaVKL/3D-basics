// Nachrichtenformat zwischen Client und Server. Diese Datei wird von BEIDEN
// Seiten importiert (Client über Vite, Server direkt über Node) - darum
// keine Imports von Three.js oder DOM-Code hier drin.

// Wird bei jeder inkompatiblen Protokolländerung erhöht. Sonst könnte ein
// Browser mit gecachtem, altem Client-Code einen neueren Server mit
// Nachrichten füttern, die dieser falsch versteht.
export const PROTOCOL_VERSION = 1

export const MAX_PLAYERS = 8
export const DEFAULT_SERVER_PORT = 8080

export type PlayerId = number

export type ClientMessage = { t: 'hello'; version: number }

export type RejectReason = 'full' | 'version'

export type ServerMessage =
  | { t: 'welcome'; id: PlayerId; players: PlayerId[] }
  | { t: 'join'; id: PlayerId }
  | { t: 'leave'; id: PlayerId }
  | { t: 'rejected'; reason: RejectReason }
