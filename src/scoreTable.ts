import type { PlayerId, RosterEntry } from './shared/protocol'
import { TeamLabel, type Team } from './team'

// Punktetabelle (Tab gedrückt halten): pro Team die Spieler mit Kills und
// Toden, beste zuerst. Wird nur neu gebaut, wenn sie sichtbar ist.
export class ScoreTable {
  private readonly container: HTMLElement

  constructor(container: HTMLElement) {
    this.container = container
  }

  setVisible(visible: boolean) {
    this.container.classList.toggle('hidden', !visible)
  }

  get visible(): boolean {
    return !this.container.classList.contains('hidden')
  }

  render(roster: ReadonlyMap<PlayerId, RosterEntry>, localId: PlayerId | null) {
    if (!this.visible) return
    this.container.replaceChildren()
    if (roster.size === 0) {
      const note = document.createElement('p')
      note.className = 'score-table-note'
      note.textContent = 'Offline - Punktetabelle nur im Multiplayer'
      this.container.append(note)
      return
    }
    for (const team of ['red', 'blue'] as Team[]) {
      const players = [...roster.values()]
        .filter((p) => p.team === team)
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      const column = document.createElement('div')
      column.className = `score-team ${team}`
      const heading = document.createElement('h2')
      heading.textContent = `Team ${TeamLabel[team]}`
      column.append(heading)
      const header = this.row('Name', 'K', 'T')
      header.classList.add('header')
      column.append(header)
      for (const p of players) {
        const row = this.row(p.name, String(p.kills), String(p.deaths))
        if (p.id === localId) row.classList.add('own')
        column.append(row)
      }
      this.container.append(column)
    }
  }

  // textContent statt innerHTML - Namen kommen von anderen Spielern
  private row(name: string, kills: string, deaths: string): HTMLElement {
    const row = document.createElement('div')
    row.className = 'score-row'
    for (const text of [name, kills, deaths]) {
      const cell = document.createElement('span')
      cell.textContent = text
      row.append(cell)
    }
    return row
  }
}
