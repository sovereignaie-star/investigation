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
 * Findings are sorted deterministically (key, then full record), so equal substance in a different order
 * is an equal state. Two findings MAY share one key (same predicate and object, different confidence):
 * they are compared as a MULTISET per key — never silently merged into one (the P4-009 round-3 fix),
 * so gaining or losing one of them is a detected change. This module is pure (no case, no clock);
 * the scheduler and the check command build on it.
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

/**
 * The finding's identity key: a JSON array — an unambiguous encoding, so a "|" (or any character)
 * inside a value can never forge a different finding's key. objectId is part of identity: a
 * different target is a different finding (old removed + new added).
 */
export function monitorFindingKey(f: MonitorFinding): string {
  return JSON.stringify([f.predicate, f.objectType, f.objectValue, f.objectId ?? null]);
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

/** The full record of a normalized finding, for content comparison. Key order is fixed, so equal substances serialize identically. */
function recordOf(f: MonitorFinding): string {
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
 * The comparable state of a run: its findings, normalized and deterministically sorted (key, then full
 * record). Order and evidence request ids do not affect the state; counts are NOT the signature
 * (content is). Duplicate keys are KEPT — the state is a multiset, never a deduped map.
 */
export function monitorFindingState(findings: readonly TransformFinding[]): MonitorFinding[] {
  return findings.map(normalizeFinding).sort((a, b) => {
    const ka = monitorFindingKey(a);
    const kb = monitorFindingKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : recordOf(a) < recordOf(b) ? -1 : 1;
  });
}

/** What changed between two comparison states, by finding key. */
export interface FindingStateDiff {
  /** true when the two states hold the same substance. */
  readonly equal: boolean;
  /** keys present only in the current state. */
  readonly added: string[];
  /** keys present only in the baseline state. */
  readonly removed: string[];
  /** keys present in both whose record MULTISET differs (gained or lost a duplicate, or a record changed). */
  readonly changed: string[];
}

/** Groups a state's records by key, preserving every record (multiset). */
function groupByKey(state: readonly MonitorFinding[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of state) {
    const k = monitorFindingKey(f);
    const list = groups.get(k);
    if (list) list.push(recordOf(f));
    else groups.set(k, [recordOf(f)]);
  }
  return groups;
}

/** Compares two sorted record multisets (both sides are already in the deterministic state order). */
function sameRecords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}

/**
 * Compares a current state against a baseline, per key, as MULTISETS: a key that exists on both sides
 * but whose records differ (a changed record, or a gained/lost duplicate) is "changed"; a key that
 * exists on only one side is added/removed. Nothing is silently merged away.
 */
export function compareFindingStates(baseline: readonly MonitorFinding[], current: readonly MonitorFinding[]): FindingStateDiff {
  const base = groupByKey(baseline);
  const cur = groupByKey(current);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [key, records] of cur) {
    const b = base.get(key);
    if (b === undefined) added.push(key);
    else if (!sameRecords(b, records)) changed.push(key);
  }
  for (const [key] of base) if (!cur.has(key)) removed.push(key);
  return { equal: added.length === 0 && removed.length === 0 && changed.length === 0, added, removed, changed };
}
