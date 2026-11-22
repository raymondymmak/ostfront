/** Province ids sent with `/api/teach/resolve` (selection + queue endpoints). */
export function teachSelectedProvinceIds(
  selectedId: string | null,
  queue: ReadonlyArray<{ from: string; to?: string | null }>,
): string[] {
  const ids = [
    selectedId,
    ...queue.map((order) => order.from),
    ...queue.map((order) => order.to ?? null),
  ]
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))]
}
