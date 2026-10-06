// Gadgets (Fähigkeiten neben den Waffen): Werte für Client und Server

export type GadgetId = 'smoke' | 'flash'
export const GADGET_IDS: GadgetId[] = ['smoke', 'flash']

export interface GadgetStats {
  label: string
  cooldown: number // Sekunden bis zum nächsten Wurf (am Anfang jedes Lebens bereit)
  maxThrowDistance: number // Meter Flugweite, die der Server zulässt (mit Zuschlag)
  maxFlightTime: number // Sekunden
  radius: number // Meter Rauchwolke
  duration: number // Sekunden, die der Rauch steht
  // Nur Blendgranate: Wirkung auf jeden, der zum Knall sieht (auch Werfer und Team)
  blind?: {
    range: number // Meter, weiter weg passiert nichts
    maxTime: number // Sekunden bei Blick direkt hinein und nah
    fullAngle: number // Grad: bis hierhin (fast direkt hingesehen) volle Wirkung
    viewAngle: number // Grad zur Blickrichtung, ab hier keine Wirkung (am Bildschirmrand/außerhalb)
  }
}

export const GADGETS: Record<GadgetId, GadgetStats> = {
  smoke: {
    label: 'Rauchgranate',
    cooldown: 25,
    maxThrowDistance: 40,
    maxFlightTime: 3,
    radius: 3.2,
    duration: 8,
  },
  flash: {
    label: 'Blendgranate',
    cooldown: 30,
    maxThrowDistance: 40,
    maxFlightTime: 3,
    radius: 0,
    duration: 0.3,
    blind: { range: 22, maxTime: 3, fullAngle: 15, viewAngle: 70 },
  },
}

export const DEFAULT_GADGET: GadgetId = 'smoke'

export function isGadgetId(value: unknown): value is GadgetId {
  return typeof value === 'string' && Object.hasOwn(GADGETS, value)
}

// Wirkung nach Blickwinkel: 1 = direkt hingesehen (bis fullAngle), fällt quadratisch auf 0 bei viewAngle
// (~Bildschirmrand; Knall außerhalb des Bildes bleibt fast ohne Wirkung)
function aimFactor(blind: NonNullable<GadgetStats['blind']>, angleDeg: number): number {
  if (angleDeg >= blind.viewAngle) return 0
  const t = Math.min(1, (blind.viewAngle - angleDeg) / (blind.viewAngle - blind.fullAngle))
  return t * t
}

// Blenddauer in Sekunden für jemanden in `distance` m Abstand, dessen Blick `angleDeg` Grad
// neben dem Knall liegt (0 = direkt hinein); 0 = keine Wirkung (zu kurz, um aufzufallen)
export function blindDuration(stats: GadgetStats, distance: number, angleDeg: number): number {
  const blind = stats.blind
  if (!blind || distance > blind.range) return 0
  const distanceFactor = 1 - 0.5 * (distance / blind.range)
  const seconds = blind.maxTime * aimFactor(blind, angleDeg) * distanceFactor
  return seconds < 0.08 ? 0 : seconds
}

// Wie weiß der Schleier wird (0..1): direkt hingesehen voll, schräg nur noch ein Hauch
export function blindStrength(stats: GadgetStats, angleDeg: number): number {
  const blind = stats.blind
  if (!blind) return 0
  const factor = aimFactor(blind, angleDeg)
  return factor <= 0 ? 0 : Math.min(1, 0.2 + factor)
}
