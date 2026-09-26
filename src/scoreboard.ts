import type { Team } from './team'

// Kills pro Team
export class Scoreboard {
  private scores: Record<Team, number> = { red: 0, blue: 0 }

  // Online zählt der Server
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
