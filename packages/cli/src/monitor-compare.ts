/**
 * P4-009 — the monitor's comparison state (UC-10).
 *
 * A check re-runs the transform and compares WHAT THE TRANSFORM RETURNED, not the whole case projection:
 * every run appends new claim ids, evidence and observations, so a case-level diff would report "change"
 * on every check. The comparable state is therefore the run's findings, normalized:
 *
 *   - identity: (predicate, objectType, objectValue, objectId) — content, never run-local ids;
 *   - kept: the finding's substance — predicate, object, confidence, explanation and the P2-031 time
 *     fields (a source reporting a new validity window IS a real change);
 *   - excluded: execution data — the `evidence` request ids and `derivedFrom`, which differ per run.
 *
 * Findings are sorted by key, so the state of two runs with the same substance in a different order is
 * equal. This module is pure (no case, no clock): the scheduler and the check command build on it.
 */
import type { TransformFinding } from "@ir/transforms";

/** One normalized finding — the comparable substance of a transform result. */
export interface MonitorFinding {
  readonly predicate: string;
  readonly objectType: string;
  readonly objectValue: string;
  readonly objectId?: string;
  readonly confidence: number;
  readonly explanation: string;
  readonly observedAt?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
}

/** The finding's identity key: predicate + typed object (never run-local ids). */
export function monitorFindingKey(f: MonitorFinding): string {
  return `${f.predicate}|${f.objectType}|${f.objectValue}${f.objectId !== undefined ? `|${f.objectId}` : ""}`;
}

/** Normalizes one finding: the substance kept, the execution data dropped. */
function normalizeFinding(f: TransformFinding): MonitorFinding {
  return {
    predicate: f.predicate,
    objectType: f.objectType,
    objectValue: f.objectValue,
    ...(f.objectId !== undefined ? { objectId: f.objectId } : {}),
    confidence: f.confidence,
    explanation: f.explanation,
    ...(f.observedAt !== undefined ? { observedAt: f.observedAt } : {}),
    ...(f.validFrom !== undefined ? { validFrom: f.validFrom } : {}),
    ...(f.validTo !== undefined ? { validTo: f.validTo } : {}),
  };
}

/**
 * The comparable state of a run: its findings, normalized and sorted by identity key. Order and evidence
 * request ids do not affect the state; counts are NOT the signature (content is).
 */
export function monitorFindingState(findings: readonly TransformFinding[]): MonitorFinding[] {
  return findings
    .map(normalizeFinding)
    .sort((a, b) => (monitorFindingKey(a) < monitorFindingKey(b) ? -1 : monitorFindingKey(a) > monitorFindingKey(b) ? 1 : 0));
}

/** What changed between two comparison states, by finding key. */
export interface FindingStateDiff {
  /** true when the two states hold the same substance. */
  readonly equal: boolean;
  /** keys present only in the current state. */
  readonly added: string[];
  /** keys present only in the baseline state. */
  readonly removed: string[];
  /** keys present in both whose full record differs. */
  readonly changed: string[];
}

/** The full record of a normalized finding, for content comparison (order-insensitive by construction). */
function recordOf(f: MonitorFinding): string {
  // key order in the literal below is fixed, so two equal substances serialize identically.
  return JSON.stringify([
    f.predicate,
    f.objectType,
    f.objectValue,
    f.objectId ?? null,
    f.confidence,
    f.explanation,
    f.observedAt ?? null,
    f.validFrom ?? null,
    f.validTo ?? null,
  ]);
}

/**
 * Compares a current state against a baseline. A key that exists in both but whose record differs is
 * "changed"; a key that moved (different objectId) is old-removed + new-added, because identity is content.
 */
export function compareFindingStates(baseline: readonly MonitorFinding[], current: readonly MonitorFinding[]): FindingStateDiff {
  const base = new Map(baseline.map((f) => [monitorFindingKey(f), f]));
  const cur = new Map(current.map((f) => [monitorFindingKey(f), f]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [key, f] of cur) {
    const b = base.get(key);
    if (b === undefined) added.push(key);
    else if (recordOf(b) !== recordOf(f)) changed.push(key);
  }
  for (const key of base.keys()) if (!cur.has(key)) removed.push(key);
  return { equal: added.length === 0 && removed.length === 0 && changed.length === 0, added, removed, changed };
}
