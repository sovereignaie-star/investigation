/**
 * P4-005 — the pinned production ER model: `er-model/1`.
 *
 * The cases are UNLABELED: `estimateWeights` cannot run on production data
 * (it needs duplicatePairs ground truth). The production model is therefore a
 * VERSIONED FROZEN model with a documented, reproducible training origin —
 * not a runtime estimation:
 *
 * - Origin: `estimateWeights(generateReferenceSet(42).train)` — the reference
 *   generator at the #306 merge (commit cd8e585), seed 42, TRAIN split only.
 * - The weights below are the frozen constants of that measurement. The
 *   consistency test (T-MODEL-001) re-derives them and compares — if the
 *   generator ever changes, the test breaks VISIBLY and forces a version bump
 *   (er-model/2), never a silent drift.
 * - The thresholds are the DECLARED constants of fellegi-sunter.ts
 *   (STRONG_THRESHOLD / REVIEW_THRESHOLD) — never estimated from any data.
 *   T-MODEL-001 verifies the model's threshold reference equals the constants
 *   the scoring path actually consumes.
 * - Comparison policy: compare.ts (Arabic-normalizing key + Jaro-Winkler).
 *
 * Every suggestion/accept response carries `modelVersion`; an accept that
 * names a different version is rejected (the model is part of the contract).
 */

import type { ErRecord } from "./types.ts";

/** The pinned model's version — part of the suggestion/accept contract. */
export const ER_MODEL_VERSION = "er-model/1";

/** The frozen FsWeights — measured once from the reference TRAIN split (seed 42). */
export const ER_MODEL_WEIGHTS = {
  name: 2.4594680761493155,
  namePartial: -4.045280608562864,
  nameDisagree: -3.4863551900024623,
  date: 4.8230898601738925,
  datePartial: 2.1840325305586337,
  dateDisagree: -4.153382997125105,
  address: 2.5714519349491036,
  addressDisagree: -1.6010388807464357,
} as const;

/** The model's threshold reference — must equal the declared scoring constants (T-MODEL-001). */
export const ER_MODEL_THRESHOLDS = {
  strong: 4.0,
  review: 1.0,
} as const;

/** The declared comparison policy — the compare.ts key + Jaro-Winkler. */
export const ER_MODEL_COMPARISON_POLICY = "compare.ts: Arabic-normalizing key + Jaro-Winkler" as const;

/** The documented training origin (reproducible: generator SHA, seed, split). */
export const ER_MODEL_ORIGIN = {
  source: "estimateWeights(generateReferenceSet(42).train)",
  generatorCommit: "cd8e585 (#306 merge)",
  seed: 42,
  split: "train",
  measuredAt: "2026-10-21",
} as const;

/**
 * The thin Entity→ErRecord adapter (P4-005). A FIXED documented policy — it
 * never depends on the UI language and never fabricates a field:
 *
 * - id: the entity's permanent id (stable across merges — the survivor's id).
 * - name: labels.ar ?? labels.en ?? canonicalKey — a fixed policy, documented
 *   here, identical for every caller.
 * - country: props.country ?? props.countryCode (uppercased, trimmed).
 * - birthDate: props.birthDate ?? props.dateOfBirth.
 * - addresses: props.address (string) and/or props.addresses (string[]).
 * - identifiers: [canonicalKey] — the entity's primary identifier is its
 *   canonical key, already in the `<type>:<normalized>` P1-007 form.
 *
 * Absent fields stay ABSENT (undefined/empty) — the FS scoring treats them as
 * neutral, and the estimation policy (fellegi-sunter.ts) conditions on
 * presence.
 */
export interface EntityLike {
  id: string;
  canonicalKey: string;
  labels: { ar?: string; en?: string };
  props: Record<string, unknown>;
}

const asString = (v: unknown): string | undefined => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined);

export function toErRecord(e: EntityLike): ErRecord {
  const props = e.props ?? {};
  const addresses: string[] = [];
  const single = asString(props.address);
  if (single) addresses.push(single);
  if (Array.isArray(props.addresses)) {
    for (const a of props.addresses) {
      const s = asString(a);
      if (s && !addresses.includes(s)) addresses.push(s);
    }
  }
  const country = asString(props.country) ?? asString(props.countryCode);
  return {
    id: e.id,
    name: asString(e.labels?.ar) ?? asString(e.labels?.en) ?? e.canonicalKey,
    country: country ? country.toUpperCase() : undefined,
    birthDate: asString(props.birthDate) ?? asString(props.dateOfBirth),
    addresses: addresses.length > 0 ? addresses : undefined,
    identifiers: [e.canonicalKey],
  };
}
