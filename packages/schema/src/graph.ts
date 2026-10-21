import { z } from "zod/v4";
import { Confidence, LocalizedLabel, Slug, Timestamp, Ulid, Admiralty, compareTimestamps } from "./primitives.ts";

/** canonicalKey = "<type>:<normalized value>" (fixes D-020, D-021: one key per real-world identifier). */
export const CanonicalKey = z.string().regex(/^[a-z][a-z0-9_.-]*:.+$/, "<type>:<normalized>");

export const Entity = z
  .object({
    id: Ulid,
    type: Slug,
    canonicalKey: CanonicalKey,
    labels: LocalizedLabel,
    props: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((e) => e.canonicalKey.startsWith(`${e.type}:`), {
    message: "canonicalKey must start with the entity type",
    path: ["canonicalKey"],
  });
export type Entity = z.infer<typeof Entity>;

/** Output of identifier detection (5.6). */
export const Identifier = z.object({
  type: Slug,
  raw: z.string().min(1),
  normalized: z.string().min(1),
  validator: z.string().min(1).nullable(),
  confidence: Confidence,
  span: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
});
export type Identifier = z.infer<typeof Identifier>;

/** D3: negative results ("searched, found nothing") and errors are first-class observations. */
export const Observation = z
  .object({
    id: Ulid,
    entityId: Ulid.optional(),
    claimId: Ulid.optional(),
    transformId: Slug,
    evidenceId: Ulid,
    observedAt: Timestamp,
    kind: z.enum(["positive", "negative", "error"]),
    note: z.string().optional(),
  })
  .refine((o) => (o.entityId === undefined) !== (o.claimId === undefined), { message: "exactly one of entityId or claimId" });
export type Observation = z.infer<typeof Observation>;

/** An edge is a Claim with a typed predicate (fixes D-025). Object is either another entity or a literal value.
 *  ADR-33: `occurredFrom/occurredTo` is the OCCURRENCE window (نافذة الحدوث) — when the event
 *  is believed to have happened, uncertainty expressed as an interval («تقريباً 2019» = the
 *  whole year, «قبل 2020-03» = open start). It is INDEPENDENT of `validFrom/validTo` (how long
 *  the claim was true in the world) and of the observation's `observedAt`; the three clocks
 *  never substitute for one another. */
export const Claim = z
  .object({
    id: Ulid,
    subjectId: Ulid,
    predicate: Slug,
    objectId: Ulid.optional(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    validFrom: Timestamp.nullable().default(null),
    validTo: Timestamp.nullable().default(null),
    occurredFrom: Timestamp.nullable().default(null),
    occurredTo: Timestamp.nullable().default(null),
    confidence: Confidence,
    admiralty: Admiralty.optional(),
    explanation: z.string().min(1),
  })
  .refine((c) => (c.objectId === undefined) !== (c.value === undefined), { message: "exactly one of objectId or value" })
  .refine((c) => !c.validFrom || !c.validTo || compareTimestamps(c.validFrom, c.validTo) <= 0, {
    message: "validFrom <= validTo",
    path: ["validTo"],
  })
  .refine((c) => !c.occurredFrom || !c.occurredTo || compareTimestamps(c.occurredFrom, c.occurredTo) <= 0, {
    message: "occurredFrom <= occurredTo",
    path: ["occurredTo"],
  });
export type Claim = z.infer<typeof Claim>;

/** D9: explainable, reversible merges. */
export const MergeDecision = z
  .object({
    id: Ulid,
    entityIds: z.array(Ulid).min(2),
    survivorId: Ulid,
    reasons: z.array(z.string().min(1)).min(1),
    decidedBy: z.string().min(1),
    decidedAt: Timestamp,
    reverted: z.boolean().default(false),
  })
  .refine((m) => m.entityIds.includes(m.survivorId), { message: "survivor must be one of entityIds", path: ["survivorId"] })
  .refine((m) => new Set(m.entityIds).size === m.entityIds.length, { message: "entityIds must be unique", path: ["entityIds"] });
export type MergeDecision = z.infer<typeof MergeDecision>;
