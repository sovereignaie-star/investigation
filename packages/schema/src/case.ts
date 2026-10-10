import { z } from "zod/v4";
import { Slug, Timestamp, Ulid } from "./primitives.ts";

/** E-01: every case states its purpose and a legitimate basis chosen from a closed list. */
export const LegalBasis = z.enum([
  "due_diligence",
  "fraud_investigation",
  "security_incident",
  "threat_intelligence",
  "journalism",
  "litigation_support",
  "compliance_kyc",
  "academic_research",
  "self_assessment",
  "training_simulation",
]);

/** E-09: retention policy per case. */
export const Retention = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("days"), days: z.number().int().min(1).max(36500) }),
  z.object({ mode: z.literal("until"), until: Timestamp }),
  z.object({ mode: z.literal("indefinite"), reason: z.string().min(3) }),
]);

export const CaseSensitivity = z.enum(["standard", "sensitive", "restricted"]);

export const Case = z.object({
  id: Ulid,
  title: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(10, "E-01: purpose must be stated (>= 10 chars)").max(2000),
  legalBasis: LegalBasis,
  createdAt: Timestamp,
  retention: Retention,
  sensitivity: CaseSensitivity,
  ownerId: z.string().min(1),
  tags: z.array(Slug).default([]),
});
export type Case = z.infer<typeof Case>;

/** What a caller supplies to open a new case (P1-018); id, createdAt and defaults are filled in by the store. */
export const CaseInit = Case.omit({ id: true, createdAt: true, ownerId: true, retention: true, sensitivity: true, tags: true }).extend({
  ownerId: z.string().min(1).optional(),
  retention: Retention.optional(),
  sensitivity: CaseSensitivity.optional(),
  tags: z.array(Slug).optional(),
});
export type CaseInit = z.input<typeof CaseInit>;
