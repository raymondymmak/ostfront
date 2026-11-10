export function teachAttemptKey(day: string, attemptId: string): string {
  return `teach:attempt:${day}:${attemptId}`
}

export function teachBeliefKey(attemptId: string): string {
  return `teach:belief:${attemptId}`
}

/** Teach artifacts share campaign TTL policy. */
export const TEACH_TTL_SECONDS = 30 * 24 * 60 * 60
