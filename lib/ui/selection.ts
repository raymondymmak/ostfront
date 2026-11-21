/** Click-to-select: second click on the same province clears selection. */
export function toggleSelection(current: string | null, clicked: string): string | null {
  return clicked === current ? null : clicked
}