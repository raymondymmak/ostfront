/**
 * Pure helpers for demo-check step 16 queue assertions.
 */

/** @param {string | null | undefined} text */
export function normalizeOrderLine(text) {
  return (text ?? "").replace(/\s+/g, " ").trim()
}

/** @param {string[]} lines */
export function queueOrderLinesChanged(before, after) {
  const a = before.map(normalizeOrderLine).filter(Boolean).sort()
  const b = after.map(normalizeOrderLine).filter(Boolean).sort()
  if (a.length !== b.length) return true
  return a.some((line, index) => line !== b[index])
}

/** @param {string[]} queueLines @param {string} cardLabel */
export function queueIncludesAcceptedLabel(queueLines, cardLabel) {
  const want = normalizeOrderLine(cardLabel).toLowerCase()
  if (!want) return false
  return queueLines.map(normalizeOrderLine).some((line) => {
    const got = line.toLowerCase()
    return got === want || got.includes(want)
  })
}

/**
 * @param {string[]} before
 * @param {string[]} after
 * @param {string} cardLabel
 */
export function assertQueueReflectsAdvisorAction(before, after, cardLabel) {
  if (!queueOrderLinesChanged(before, after)) {
    return { ok: false, message: "queue order lines unchanged" }
  }
  if (!queueIncludesAcceptedLabel(after, cardLabel)) {
    return {
      ok: false,
      message: `queue missing accepted order "${normalizeOrderLine(cardLabel)}"`,
    }
  }
  return { ok: true, message: "queue updated" }
}
