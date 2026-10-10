import { z } from "zod/v4";
import { Case } from "./case.ts";
import { Claim, Entity, Identifier, MergeDecision, Observation } from "./graph.ts";
import { AuditEvent, Evidence, LedgerEntry, TransformManifest, ViewState } from "./evidence.ts";

/** The data model of ROADMAP 5.4, by name. */
export const SCHEMAS = {
  Case,
  Entity,
  Identifier,
  Observation,
  Claim,
  Evidence,
  LedgerEntry,
  MergeDecision,
  AuditEvent,
  TransformManifest,
  ViewState,
} as const;

/** JSON Schema (draft 2020-12) for every model; used by other languages, the API spec and case-pack validation. */
export function toJsonSchemas(): Record<keyof typeof SCHEMAS, unknown> {
  const out = {} as Record<keyof typeof SCHEMAS, unknown>;
  for (const [name, schema] of Object.entries(SCHEMAS) as [keyof typeof SCHEMAS, z.ZodType][]) {
    out[name] = {
      $id: `https://github.com/sovereignaie-star/investigation/schema/${name}.schema.json`,
      title: name,
      ...z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
    };
  }
  return out;
}
