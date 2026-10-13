/**
 * P2-004 — transform output contract (T-RULE-03).
 *
 * Every transform's output must pass `TransformOutputSchema` before it is stored.
 * Findings are the unit of analysis: each one is a *partial* claim (predicate +
 * object value or object id + confidence + explanation) that the engine binds to a
 * subject entity. No raw text is ever used as an identifier (D-018): object values
 * are typed by `objectType` and validated by the identifier validators.
 */
import { z } from "zod";

/** A single finding produced by a transform. */
export const TransformFindingSchema = z.object({
  /** Typed predicate, e.g. "resolves_to", "has_technology", "has_certificate". */
  predicate: z.string().min(1),
  /** The object of the claim: a typed value (e.g. an IP, a host, a technology). */
  objectType: z.string().min(1),
  objectValue: z.string().min(1),
  /** Optional reference to an existing entity id (e.g. a linked entity). */
  objectId: z.string().optional(),
  /** Confidence in [0, 1]. */
  confidence: z.number().min(0).max(1),
  /** Human-readable explanation of how the finding was derived. */
  explanation: z.string().min(1),
});

/** The full output of a transform run. */
export const TransformOutputSchema = z.object({
  findings: z.array(TransformFindingSchema),
  /** Optional structured data the transform wants to persist alongside findings. */
  data: z.record(z.string(), z.unknown()).optional(),
});

export type TransformFinding = z.infer<typeof TransformFindingSchema>;
export type TransformOutput = z.infer<typeof TransformOutputSchema>;
