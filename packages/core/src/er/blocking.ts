/**
 * P4-004 (ROADMAP 5.14 الحجب) — blocking: the candidate-pair generator.
 *
 * Spec keys: (1) the normalized identifier, (2) the first 3 characters of the
 * comparison key + country. Two records are candidates iff they share ANY
 * block key. Blocking trades completeness of SCORING (only candidates are
 * scored) for recall of TRUE duplicates — T-ER-003 asserts recall = 100% on the
 * reference set.
 */
import { erComparisonKey } from "./compare.ts";
import type { ErRecord } from "./types.ts";

/**
 * The block keys of one record. Deterministic and pure. The identifier key is
 * lowercased (identifiers are P1-007 canonical keys — already normalized, but
 * case is not part of their identity here).
 */
export function blockKeys(record: ErRecord): string[] {
  const keys: string[] = [];
  for (const id of record.identifiers ?? []) {
    keys.push(`id:${id.toLowerCase()}`);
  }
  const k3 = erComparisonKey(record.name).slice(0, 3);
  if (k3.length > 0) {
    keys.push(`name3:${k3}:${(record.country ?? "").toLowerCase()}`);
  }
  return keys;
}
