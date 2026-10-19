/** Stay with the newest chronicle entry unless the reader has moved away from it. */
export function chronicleFollowsLatest(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  if (scrollHeight <= clientHeight + 1) return true
  return scrollHeight - scrollTop - clientHeight <= 48
}
