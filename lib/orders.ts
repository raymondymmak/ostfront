export type QueuedOrder = {
  id: string
  kind: "move" | "attack" | "fortify"
  from: string
  to?: string
  unitIds: string[]
}
