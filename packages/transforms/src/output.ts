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
  /**
   * P2-036 — the evidence this finding was derived from: the `requestId` of every `ctx.http` response it rests on
   * (`TransformHttpResponse.requestId`, assigned by the runner when the request is issued). The runner refuses an
   * output whose findings do not say which response produced them once the run made a request: nothing is bound to
   * "the last response" by guess. Every id must name a request of the same run that received a response.
   */
  evidence: z.array(z.number().int().nonnegative()).min(1).optional(),
  /**
   * P2-036 — set instead of `evidence` when the finding is computed from the transform's input alone (a static rule
   * of the transform, no source response). The caller binds it to the run record, never to a source response.
   */
  derivedFrom: z.literal("input").optional(),
});

/** The full output of a transform run. */
export const TransformOutputSchema = z.object({
  findings: z.array(TransformFindingSchema),
  /** Optional structured data the transform wants to persist alongside findings. */
  data: z.record(z.string(), z.unknown()).optional(),
});

export type TransformFinding = z.infer<typeof TransformFindingSchema>;
export type TransformOutput = z.infer<typeof TransformOutputSchema>;
