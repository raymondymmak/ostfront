const chains = new Map<string, Promise<unknown>>()

/** Serialize campaign mutations per game id (in-memory store and tests). */
export function runCampaignSerialized<T>(gameId: string, work: () => Promise<T>): Promise<T> {
  const tail = chains.get(gameId) ?? Promise.resolve()
  const next = tail.catch(() => undefined).then(work)
  chains.set(
    gameId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

export function resetCampaignSerializeForTests(): void {
  chains.clear()
}
