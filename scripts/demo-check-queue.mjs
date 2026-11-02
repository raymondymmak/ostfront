/**
 * Pure helpers for demo-check step 16 queue assertions.
 */

/** @param {string | null | undefined} text */
export function normalizeOrderLine(text) {
  return (text ?? "").replace(/\s+/g, " ").trim()
}

/** @param {string[]} lines */
function lineCounts(lines) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const line of lines.map(normalizeOrderLine).filter(Boolean)) {
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }
  return counts
}

/** @param {string[]} lines */
export function queueOrderLinesChanged(before, after) {
  const a = before.map(normalizeOrderLine).filter(Boolean).sort()
  const b = after.map(normalizeOrderLine).filter(Boolean).sort()
  if (a.length !== b.length) return true
  return a.some((line, index) => line !== b[index])
}

/**
 * @param {string[]} before
 * @param {string[]} after
 * @param {string} expectedLine
 */
export function lineNewlyPresentInQueue(before, after, expectedLine) {
  const want = normalizeOrderLine(expectedLine)
  if (!want) return false
  const beforeCount = lineCounts(before).get(want) ?? 0
  const afterCount = lineCounts(after).get(want) ?? 0
  return afterCount > beforeCount
}

/**
 * @param {string[]} before
 * @param {string[]} after
 * @param {string[]} expectedLines
 */
export function assertQueueReflectsAdvisorAction(before, after, expectedLines) {
  const expected = expectedLines.map(normalizeOrderLine).filter(Boolean)
  if (!expected.length) {
    return { ok: false, message: "card has no expected queue lines" }
  }
  if (!queueOrderLinesChanged(before, after)) {
    return { ok: false, message: "queue order lines unchanged" }
  }
  for (const line of expected) {
    if (!lineNewlyPresentInQueue(before, after, line)) {
      return {
        ok: false,
        message: `queue missing newly filed line "${line}"`,
      }
    }
  }
  return { ok: true, message: "queue updated" }
}
