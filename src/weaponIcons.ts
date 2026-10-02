import { WEAPONS, type WeaponId } from './shared/weapons'

// Umriss-Symbole der Waffen (Kill-Feed, Waffenfeld). Feste Strings, kein
// Nutzerinhalt - daher innerHTML unbedenklich.
const WEAPON_ICONS: Record<WeaponId, string> = {
  pistol: 'M2 2h17v4h-8l-1.5 6h-4l1.5-6H2z',
  rifle: 'M1 4h20V2h7v3h3v2H19l-2.5 5h-3l1.5-5H9l-2.5 4H2l1-3H1z',
  shotgun: 'M1 4h24V2h3v3h3v2h-5l-2 3h-3l1-3H7l-2 4H2l1-4H1z',
  knife: 'M1 4.5h8v3H1zM9.5 3h1.5v6H9.5zM11 4.5h13l6 1.5-6 1.5H11z',
}

export function weaponIcon(weapon: WeaponId, scale = 1): HTMLElement {
  const icon = document.createElement('span')
  icon.className = 'weapon-icon'
  icon.dataset.weapon = weapon
  icon.title = WEAPONS[weapon].label
  icon.innerHTML = `<svg viewBox="0 0 32 12" width="${32 * scale}" height="${12 * scale}"><path d="${WEAPON_ICONS[weapon]}" fill="currentColor"/></svg>`
  return icon
}
