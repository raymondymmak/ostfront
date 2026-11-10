const PREFIX = "campaign"

export function campaignHeadKey(gameId: string): string {
  return `${PREFIX}:${gameId}:head`
}

export function campaignTurnKey(gameId: string, turn: number): string {
  return `${PREFIX}:${gameId}:turn:${turn}`
}
