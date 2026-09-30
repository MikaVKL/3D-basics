import type { PlayerId, RoundStat } from './shared/protocol'

// Statistik am Rundenende (unter dem Siegertext). Bei vielen Spielern die
// besten, plus die eigene Zeile, damit man sich immer findet.
const MAX_ROWS = 6

export function renderRoundStats(container: HTMLElement, stats: readonly RoundStat[], localId: PlayerId | null) {
  container.replaceChildren()
  if (stats.length === 0) return

  const rows = stats.slice(0, MAX_ROWS).map((stat, index) => ({ stat, rank: index + 1 }))
  const ownIndex = stats.findIndex((stat) => stat.id === localId)
  if (ownIndex >= MAX_ROWS) rows.push({ stat: stats[ownIndex], rank: ownIndex + 1 })

  container.append(row(['', 'Name', 'K', 'T', 'Kopf'], 'header'))
  for (const { stat, rank } of rows) {
    // Bester der Runde: Stern (nur wenn er überhaupt getroffen hat)
    const badge = rank === 1 && stat.kills > 0 ? '★' : String(rank)
    const line = row([badge, stat.name, String(stat.kills), String(stat.deaths), String(stat.headshots)], stat.team)
    if (stat.id === localId) line.classList.add('own')
    if (rank === 1 && stat.kills > 0) line.classList.add('mvp')
    container.append(line)
  }
}

// textContent statt innerHTML - Namen kommen von anderen Spielern
function row(cells: string[], className: string): HTMLElement {
  const element = document.createElement('div')
  element.className = `round-stat-row ${className}`
  for (const text of cells) {
    const cell = document.createElement('span')
    cell.textContent = text
    element.append(cell)
  }
  return element
}
