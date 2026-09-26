export type Team = 'red' | 'blue'

export const TeamColor: Record<Team, number> = {
  red: 0xff4d5a,
  blue: 0x4da6ff,
}

export const TeamLabel: Record<Team, string> = {
  red: 'Rot',
  blue: 'Blau',
}

export function opposingTeam(team: Team): Team {
  return team === 'red' ? 'blue' : 'red'
}
