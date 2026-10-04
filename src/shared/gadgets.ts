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
    minTime: number // Sekunden, wenn man knapp hinsieht (Rand des Blickfelds)
    viewAngle: number // Grad zur Blickrichtung, ab hier keine Wirkung (Knall im Rücken)
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
    blind: { range: 22, maxTime: 3, minTime: 0.6, viewAngle: 100 },
  },
}

export const DEFAULT_GADGET: GadgetId = 'smoke'

export function isGadgetId(value: unknown): value is GadgetId {
  return typeof value === 'string' && Object.hasOwn(GADGETS, value)
}

// Blenddauer in Sekunden für jemanden in `distance` m Abstand, dessen Blick `angleDeg` Grad
// neben dem Knall liegt (0 = direkt hinein); 0 = keine Wirkung
export function blindDuration(stats: GadgetStats, distance: number, angleDeg: number): number {
  const blind = stats.blind
  if (!blind || distance > blind.range || angleDeg > blind.viewAngle) return 0
  const angleFactor = 1 - angleDeg / blind.viewAngle
  const distanceFactor = 1 - 0.5 * (distance / blind.range)
  return (blind.minTime + (blind.maxTime - blind.minTime) * angleFactor) * distanceFactor
}
