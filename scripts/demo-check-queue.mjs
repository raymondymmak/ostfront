/**
 * Pure helpers for demo-check step 16 queue assertions.
 */

/** @param {string | null | undefined} text */
export function normalizeOrderLine(text) {
  return (text ?? "").replace(/\s+/g, " ").trim()
}

/** @param {string} name */
export function normalizePlaceName(name) {
  return normalizeOrderLine(name).toLowerCase()
}

/**
 * @typedef {{
 *   kind: string,
 *   from: string,
 *   to?: string,
 *   fromName: string,
 *   toName?: string,
 *   unitIds: string[],
 *   unitKind?: string,
 *   buildId?: string,
 * }} QueueEntrySnapshot
 */

/** @param {QueueEntrySnapshot} entry */
export function columnKey(entry) {
  return `${entry.kind}|${entry.from}|${entry.to ?? ""}`
}

/** @param {QueueEntrySnapshot} a @param {QueueEntrySnapshot} b */
export function entriesEqual(a, b) {
  if (columnKey(a) !== columnKey(b)) return false
  if ((a.unitKind ?? "") !== (b.unitKind ?? "")) return false
  if ((a.buildId ?? "") !== (b.buildId ?? "")) return false
  const left = [...(a.unitIds ?? [])].sort()
  const right = [...(b.unitIds ?? [])].sort()
  if (left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}

/** @param {QueueEntrySnapshot} queueEntry @param {QueueEntrySnapshot} cardOrder */
export function queueEntryContainsCardOrder(queueEntry, cardOrder) {
  if (columnKey(queueEntry) !== columnKey(cardOrder)) return false
  if (cardOrder.kind === "fortify" || cardOrder.kind === "recruit" || cardOrder.kind === "cancelRecruit") {
    if ((queueEntry.unitKind ?? "") !== (cardOrder.unitKind ?? "")) return false
    if ((queueEntry.buildId ?? "") !== (cardOrder.buildId ?? "")) return false
    return true
  }
  const want = new Set(cardOrder.unitIds ?? [])
  const have = new Set(queueEntry.unitIds ?? [])
  for (const id of want) {
    if (!have.has(id)) return false
  }
  return true
}

/**
 * @param {QueueEntrySnapshot[]} cardOrders
 * @param {Set<string>} cardUnits
 */
function cardColumnKeys(cardOrders) {
  return new Set(cardOrders.map((order) => columnKey(order)))
}

/**
 * @param {QueueEntrySnapshot} entry
 * @param {QueueEntrySnapshot[]} cardOrders
 * @param {Set<string>} cardUnits
 */
export function entryRelatedToCard(entry, cardOrders, cardUnits) {
  if ((entry.unitIds ?? []).some((id) => cardUnits.has(id))) return true
  return cardColumnKeys(cardOrders).has(columnKey(entry))
}

/** @param {string} label */
export function parseAttackCardLabel(label) {
  const trimmed = normalizeOrderLine(label)
  const match = trimmed.match(/^Attack\s+(.+?)\s+from\s+(.+)$/i)
  if (!match) return null
  const target = normalizeOrderLine(match[1])
  const origins = splitLabelPlaces(match[2])
  return { target, origins }
}

/** @param {string} chunk */
function splitLabelPlaces(chunk) {
  return chunk
    .split(/\s*,\s*|\s+and\s+/i)
    .map((part) => normalizeOrderLine(part))
    .filter(Boolean)
}

/**
 * @param {string} cardLabel
 * @param {QueueEntrySnapshot[]} cardOrders
 */
export function assertCardLabelMatchesOrders(cardLabel, cardOrders) {
  if (!cardOrders.length) {
    return { ok: false, message: "card has no order snapshots" }
  }
  const attacks = cardOrders.filter((order) => order.kind === "attack")
  if (attacks.length === cardOrders.length) {
    const parsed = parseAttackCardLabel(cardLabel)
    if (!parsed) {
      return { ok: false, message: "attack card label is not parseable" }
    }
    const targetName = normalizePlaceName(parsed.target)
    const targets = new Set(attacks.map((order) => normalizePlaceName(order.toName ?? order.to ?? "")))
    if (targets.size !== 1 || !targets.has(targetName)) {
      return { ok: false, message: "attack card label target does not match orders" }
    }
    const orderOrigins = attacks.map((order) => normalizePlaceName(order.fromName)).sort()
    const labelOrigins = [...parsed.origins].map(normalizePlaceName).sort()
    if (orderOrigins.length !== labelOrigins.length) {
      return { ok: false, message: "attack card label origin count does not match orders" }
    }
    for (let index = 0; index < orderOrigins.length; index += 1) {
      if (orderOrigins[index] !== labelOrigins[index]) {
        return { ok: false, message: "attack card label origins do not match orders" }
      }
    }
    return { ok: true, message: "label matches attack orders" }
  }
  if (cardOrders.length === 1 && cardOrders[0].kind === "fortify") {
    const parsed = normalizeOrderLine(cardLabel).match(/^Fortify\s+(.+)$/i)
    if (!parsed) return { ok: false, message: "fortify card label is not parseable" }
    if (normalizePlaceName(parsed[1]) !== normalizePlaceName(cardOrders[0].fromName)) {
      return { ok: false, message: "fortify card label does not match order province" }
    }
    return { ok: true, message: "label matches fortify order" }
  }
  if (cardOrders.length === 1 && cardOrders[0].kind === "recruit") {
    const parsed = normalizeOrderLine(cardLabel).match(/^Raise\s+(.+?)\s+at\s+(.+)$/i)
    if (!parsed) return { ok: false, message: "recruit card label is not parseable" }
    if (normalizePlaceName(parsed[2]) !== normalizePlaceName(cardOrders[0].fromName)) {
      return { ok: false, message: "recruit card label province does not match order" }
    }
    return { ok: true, message: "label matches recruit order" }
  }
  return { ok: true, message: "label check skipped for mixed card types" }
}

/**
 * @param {{
 *   before: QueueEntrySnapshot[],
 *   after: QueueEntrySnapshot[],
 *   cardOrders: QueueEntrySnapshot[],
 *   cardLabel: string,
 *   mode: "accept" | "override",
 * }} input
 */
export function assertQueueReflectsAdvisorAction(input) {
  const { before, after, cardOrders, cardLabel } = input
  if (!cardOrders.length) {
    return { ok: false, message: "card has no order snapshots" }
  }

  const labelCheck = assertCardLabelMatchesOrders(cardLabel, cardOrders)
  if (!labelCheck.ok) return labelCheck

  const cardUnits = new Set(cardOrders.flatMap((order) => order.unitIds ?? []))

  for (const prior of before) {
    if (entryRelatedToCard(prior, cardOrders, cardUnits)) continue
    const stillThere = after.some((next) => entriesEqual(prior, next))
    if (!stillThere) {
      return {
        ok: false,
        message: `unrelated queue entry changed or removed (${prior.kind} ${prior.fromName}${prior.toName ? ` → ${prior.toName}` : ""})`,
      }
    }
  }

  for (const cardOrder of cardOrders) {
    const filed = after.some((entry) => queueEntryContainsCardOrder(entry, cardOrder))
    if (!filed) {
      return {
        ok: false,
        message: `queue missing card order (${cardOrder.kind} ${cardOrder.fromName}${cardOrder.toName ? ` → ${cardOrder.toName}` : ""})`,
      }
    }
  }

  return { ok: true, message: "queue reflects advisor action" }
}
