// Einstellungen des Spielers (Menü), im Browser gemerkt.

export interface Settings {
  sensitivity: number // Faktor auf die Grundempfindlichkeit
  fov: number // Grad (senkrecht)
  volume: number // 0..1
  music: number // 0..1, Hintergrundmusik
  minimap: boolean
}

export type NumericSettingKey = 'sensitivity' | 'fov' | 'volume' | 'music'

export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, fov: 75, volume: 1, music: 0.5, minimap: true }

export const SETTING_RANGES: Record<NumericSettingKey, { min: number; max: number; step: number }> = {
  sensitivity: { min: 0.3, max: 8, step: 0.05 },
  fov: { min: 60, max: 110, step: 1 },
  volume: { min: 0, max: 1, step: 0.05 },
  music: { min: 0, max: 1, step: 0.05 },
}

const STORAGE_KEY = 'duskArena.settings'

export function clampSetting(key: NumericSettingKey, value: unknown): number {
  const { min, max } = SETTING_RANGES[key]
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : DEFAULT_SETTINGS[key]
}

// Kaputte oder fehlende Werte fallen einzeln auf den Standard zurück
export function loadSettings(): Settings {
  let stored: Partial<Record<keyof Settings, unknown>> = {}
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (typeof parsed === 'object' && parsed !== null) stored = parsed
  } catch {
    // localStorage gesperrt oder kein gültiges JSON: Standard
  }
  return {
    sensitivity: clampSetting('sensitivity', stored.sensitivity),
    fov: clampSetting('fov', stored.fov),
    volume: clampSetting('volume', stored.volume),
    music: clampSetting('music', stored.music),
    minimap: typeof stored.minimap === 'boolean' ? stored.minimap : DEFAULT_SETTINGS.minimap,
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // privater Modus: gilt dann nur für diese Sitzung
  }
}
