import { z } from "zod/v4";
import { Sensitivity } from "./primitives.ts";

/**
 * One identifier type in the catalog (5.6, P1-003): packages/core/identifiers/<category>.yaml. Examples may contain
 * `{{N:c}}` (N copies of character c), expanded only at run time, so secret-shaped examples (API keys, tokens) are
 * never stored as literal strings in the repository.
 */
export const IdentifierCategory = z.enum([
  "Email",
  "Messaging",
  "Phone",
  "Network",
  "Domain",
  "Social",
  "Crypto",
  "Documents",
  "Device",
  "Finance",
  "Hash",
  "API",
  "DarkWeb",
]);

export const IdentifierSpec = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    category: IdentifierCategory,
    labels: z.object({ en: z.string().min(1), ar: z.string().min(1) }),
    description: z.string().min(1),
    icon: z.string().optional(),
    color: z.string().optional(),
    patterns: z.array(z.string().min(2)).min(1),
    flags: z
      .string()
      .regex(/^[imsu]*$/)
      .optional(),
    /** Structural validator name from @ir/core/validate (null: the pattern is the only check). */
    validator: z.string().nullable(),
    /** Nearby words that raise confidence; `required` types are only proposed when one is present (D-009). */
    context: z
      .object({ keywords: z.array(z.string().min(2)).default([]), required: z.boolean().default(false) })
      .default({ keywords: [], required: false }),
    examples: z.object({ positive: z.array(z.string().min(1)).min(1), negative: z.array(z.string()).min(1) }),
    sensitivity: Sensitivity,
    transforms: z.array(z.string()).default([]),
  })
  .strict();
export type IdentifierSpec = z.infer<typeof IdentifierSpec>;
