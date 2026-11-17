/** Chronicle Escape handling is suppressed while news cards are on screen (news is topmost). */
export function chronicleHandlesEscapeKey(newsCardsActive: boolean): boolean {
  return !newsCardsActive
}

/** Escape while news is showing dismisses the whole queue (Skip all). */
export function newsEscapeDismissesQueue(key: string, newsCardsActive: boolean): boolean {
  return newsCardsActive && key === "Escape"
}