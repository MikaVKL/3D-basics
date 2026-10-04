// Gadgets (Fähigkeiten neben den Waffen): Werte für Client und Server

export type GadgetId = 'smoke'

export interface GadgetStats {
  label: string
  cooldown: number // Sekunden bis zum nächsten Wurf (am Anfang jedes Lebens bereit)
  maxThrowDistance: number // Meter Flugweite, die der Server zulässt (mit Zuschlag)
  maxFlightTime: number // Sekunden
  radius: number // Meter Rauchwolke
  duration: number // Sekunden, die der Rauch steht
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
}

export const DEFAULT_GADGET: GadgetId = 'smoke'

export function isGadgetId(value: unknown): value is GadgetId {
  return typeof value === 'string' && Object.hasOwn(GADGETS, value)
}
