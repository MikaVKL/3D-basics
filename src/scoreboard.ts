import type { Team } from './team'

// Einfacher Kill-Counter pro Team. Bewusst als eigene, kleine Klasse statt
// direkt in main.ts - weapon.ts ruft addKill() über einen Callback auf
// (siehe main.ts), ohne selbst etwas über Punktestände wissen zu müssen.
export class Scoreboard {
  private scores: Record<Team, number> = { red: 0, blue: 0 }

  // Im Multiplayer zählt der Server, der Client übernimmt nur den Stand
  setScores(scores: Record<Team, number>) {
    this.scores = { ...scores }
  }

  addKill(killerTeam: Team) {
    this.scores[killerTeam] += 1
  }

  getScore(team: Team): number {
    return this.scores[team]
  }
}
