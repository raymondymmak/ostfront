import { z } from "zod"

export const UnitSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  faction: z.enum(["central", "russia"]),
  strength: z.number().min(0).max(100),
  morale: z.number().min(0).max(100),
  kind: z.enum(["infantry", "cavalry", "artillery"]),
})

export const ProvinceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  terrain: z.enum(["plains", "forest", "marsh", "mountain", "urban"]),
  neighbors: z.array(z.string()),
  rail: z.array(z.string()),
  owner: z.enum(["central", "russia"]),
  controller: z.enum(["central", "russia"]),
  supply: z.number().min(0).max(100),
  unrest: z.number().min(0).max(100),
  fort: z.number().min(0).max(3),
  units: z.array(UnitSchema),
  depot: z.enum(["central", "russia"]).optional(),
  supplyModifier: z.number().min(-40).max(40).default(0),
})

export const GameStateSchema = z.object({
  version: z.literal(1),
  turn: z.number().int().min(0),
  date: z.string(),
  seed: z.number(),
  provinces: z.array(ProvinceSchema).min(1),
})

export const ProposalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("move"),
    unit: z.string(),
    to: z.string(),
  }),
  z.object({
    type: z.literal("attack"),
    from: z.string(),
    target: z.string(),
    units: z.array(z.string()),
  }),
  z.object({
    type: z.literal("fortify"),
    province: z.string(),
  }),
  z.object({
    type: z.literal("modify"),
    province: z.string(),
    field: z.enum(["unrest", "supply"]),
    delta: z.number(),
    reason: z.string(),
  }),
])

export const GameEventSchema = z.object({
  type: z.enum(["partisans", "strike", "epidemic", "breakthrough"]),
  province: z.string(),
  note: z.string().optional(),
})

export const GMTurnSchema = z.object({
  narration: z.string(),
  proposals: z.array(ProposalSchema),
  events: z.array(GameEventSchema),
  diplomacy: z.array(z.string()),
})

export const PlayerOrderSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("move"),
    unitId: z.string(),
    to: z.string(),
  }),
  z.object({
    type: z.literal("attack"),
    from: z.string(),
    target: z.string(),
    unitIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal("fortify"),
    provinceId: z.string(),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string().max(2000),
  }),
])

export const TurnRequestSchema = z.object({
  state: GameStateSchema,
  orders: z.array(PlayerOrderSchema).max(40),
})

export const GM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["narration", "proposals", "events", "diplomacy"],
  properties: {
    narration: { type: "string" },
    diplomacy: { type: "array", items: { type: "string" } },
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "province"],
        properties: {
          type: {
            type: "string",
            enum: ["partisans", "strike", "epidemic", "breakthrough"],
          },
          province: { type: "string" },
          note: { type: "string" },
        },
      },
    },
    proposals: {
      type: "array",
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "unit", "to"],
            properties: {
              type: { const: "move" },
              unit: { type: "string" },
              to: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "from", "target", "units"],
            properties: {
              type: { const: "attack" },
              from: { type: "string" },
              target: { type: "string" },
              units: { type: "array", items: { type: "string" } },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "province"],
            properties: {
              type: { const: "fortify" },
              province: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "province", "field", "delta", "reason"],
            properties: {
              type: { const: "modify" },
              province: { type: "string" },
              field: { type: "string", enum: ["unrest", "supply"] },
              delta: { type: "number" },
              reason: { type: "string" },
            },
          },
        ],
      },
    },
  },
} as const
