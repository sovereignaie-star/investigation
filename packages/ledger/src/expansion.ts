/**
 * P2-002 — expansion: transform findings become typed claims with edges to EVERY parent (D-019).
 *
 * After a transform runs on a subject entity (the "parent"), its findings must be bound to that
 * subject and recorded in the ledger as Claims with typed predicates. The D-019 fix this module
 * exists for: when the same finding is discovered from more than one parent, a claim is created
 * for EACH parent — the graph is a graph, not a tree, and a node discovered from several parents
 * keeps all its edges.
 *
 * A finding's object is either:
 *   - a typed identifier value (objectType is a catalog identifier type): the value is normalized
 *     to a canonical key, an entity is created for it (or aliased onto the existing node for that
 *     key, D-020), and the claim links subject → object as a graph edge; or
 *   - a literal attribute (objectType is not an identifier type, e.g. "technology", "http_status"):
 *     the claim carries the literal value and shows up as a node attribute, not an edge.
 *
 * Every claim is recorded with a positive observation citing the evidence that produced it — one per evidence
 * record when the finding names several (P2-036: `Finding.evidenceIds`, never "the last response") — so the
 * graph, table and coverage projections stay consistent (P1-016). A finding whose object value
 * cannot be normalized to its declared type is recorded as an error observation, never a claim
 * (fail-closed, D-018: no raw text is ever used as an identifier).
 */
import { isoNow, systemClock, ulidFactory, type Clock } from "@ir/core";
import { canonicalKey } from "@ir/core";
import { specById } from "@ir/core/identifiers";
import type { Ledger } from "./ledger.ts";

/** Structural shape of a transform finding (P2-004 TransformFindingSchema); kept local to avoid a
 * workspace cycle (transforms → engine → …). The engine's run loop passes outputs through this. */
export interface Finding {
  predicate: string;
  objectType: string;
  objectValue: string;
  objectId?: string;
  confidence: number;
  explanation: string;
  /**
   * P2-036 — the ledger evidence ids this finding rests on (one per source response it was derived from). When set,
   * the claim gets one positive observation per id; when absent, `ExpandOptions.evidenceId` is the single record
   * backing the whole output (a run with one source of evidence, e.g. a local file). One of the two is required:
   * a finding is never recorded without the evidence that proves it.
   */
  evidenceIds?: string[];
  /**
   * P2-031 — capture time from the receiver/source (ISO-8601 UTC). When present and valid it becomes the
   * observation's observedAt; when absent the processing time is used (the old behavior). Invalid → fail-closed.
   */
  observedAt?: string;
  /** P2-031 — claim validity window (ISO-8601 UTC), passed through to the Claim. `validTo` must not precede `validFrom`. */
  validFrom?: string;
  validTo?: string;
}

/** P2-031 — true when `value` is a valid ISO-8601 UTC timestamp (the shape the ledger stores). */
function isIsoUtc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** P2-031 — validates a finding's optional time fields; returns the rejection reason or null when they are usable. */
function timeFieldRejection(finding: Finding): string | null {
  if (finding.observedAt !== undefined && !isIsoUtc(finding.observedAt)) return "observedAt is not ISO-8601 UTC";
  if (finding.validFrom !== undefined && !isIsoUtc(finding.validFrom)) return "validFrom is not ISO-8601 UTC";
  if (finding.validTo !== undefined && !isIsoUtc(finding.validTo)) return "validTo is not ISO-8601 UTC";
  if (finding.validFrom !== undefined && finding.validTo !== undefined && Date.parse(finding.validTo) < Date.parse(finding.validFrom)) {
    return `validTo (${finding.validTo}) precedes validFrom (${finding.validFrom})`;
  }
  return null;
}

export interface TransformOutputLike {
  findings: Finding[];
  data?: Record<string, unknown>;
}

export interface ExpandOptions {
  /** The ledger to append entity/claim/observation events to. */
  ledger: Ledger;
  /** The transform that produced the findings. */
  transformId: string;
  /**
   * The evidence id that backs findings that carry no `evidenceIds` of their own, and the evidence cited by
   * `recordOutcome`. A multi-request run binds each finding through `Finding.evidenceIds` instead (P2-036).
   */
  evidenceId?: string;
  /** Clock for ids/timestamps; defaults to the system clock. */
  clock?: Clock;
  /** Id factory; defaults to a monotonic ULID factory on the clock. */
  newId?: () => string;
}

export interface ExpandResult {
  /** Entity ids created or reused for finding objects (in finding order). */
  objectEntityIds: string[];
  /** Claim ids appended, one per finding (each bound to the subject). */
  claimIds: string[];
  /** Findings whose object was a literal attribute (no entity created). */
  attributeCount: number;
  /** Findings whose object value failed normalization (recorded as error observations). */
  rejectedCount: number;
}

/**
 * Records a negative observation (D3: "searched, found nothing" is first-class evidence) or an
 * error observation for a subject. Used when a transform returns no findings (negative) or fails
 * (error) — the coverage projection then shows the cell as checked-with-no-result / failed, never
 * as untouched. P2-006.
 */
export function recordOutcome(subjectId: string, kind: "negative" | "error", opts: ExpandOptions, note?: string): string {
  if (!opts.evidenceId) throw new Error(`recordOutcome(${kind}): an outcome observation must cite an evidence id`);
  const clock = opts.clock ?? systemClock;
  const id = opts.newId ?? ulidFactory(clock);
  const observationId = id();
  opts.ledger.append("observation.added", {
    id: observationId,
    entityId: subjectId,
    transformId: opts.transformId,
    evidenceId: opts.evidenceId,
    observedAt: isoNow(clock),
    kind,
    ...(note ? { note } : {}),
  });
  return observationId;
}

/** True when the finding's objectType is a catalog identifier type (so it becomes an entity/edge). */
export function isIdentifierType(objectType: string): boolean {
  return specById(objectType) !== undefined;
}

/**
 * Appends the ledger events for one transform output against one subject id. Returns the ids
 * created. Call once per parent with the same output: each call creates its own claim, so a
 * finding discovered from N parents yields N edges (D-019).
 */
export function expandFindings(output: TransformOutputLike, subjectId: string, opts: ExpandOptions): ExpandResult {
  const clock = opts.clock ?? systemClock;
  const id = opts.newId ?? ulidFactory(clock);
  const now = isoNow(clock);
  const objectEntityIds: string[] = [];
  const claimIds: string[] = [];
  let attributeCount = 0;
  let rejectedCount = 0;

  for (const finding of output.findings) {
    const evidenceIds = findingEvidence(finding, opts);
    const claimId = id();
    // P2-031 — optional time fields are validated fail-closed BEFORE any claim is made: an invalid
    // ISO-8601 timestamp or a validTo preceding its validFrom is recorded as an error observation.
    const timeRejection = timeFieldRejection(finding);
    if (timeRejection !== null) {
      rejectedCount++;
      opts.ledger.append("observation.added", {
        id: id(),
        entityId: subjectId,
        transformId: opts.transformId,
        evidenceId: evidenceIds[0],
        observedAt: now,
        kind: "error",
        note: `finding time fields rejected: ${timeRejection}`,
      });
      continue;
    }
    // P2-031 — the capture time from the source when the finding provides one, else the processing time.
    const observedAt = finding.observedAt ?? now;
    if (isIdentifierType(finding.objectType)) {
      // Typed identifier object → entity + edge claim.
      let key: string;
      try {
        key = canonicalKey(finding.objectType, finding.objectValue);
      } catch {
        // The value cannot be that identifier type: record an error observation, never a claim.
        rejectedCount++;
        opts.ledger.append("observation.added", {
          id: id(),
          entityId: subjectId,
          transformId: opts.transformId,
          evidenceId: evidenceIds[0],
          observedAt: now,
          kind: "error",
          note:
            `finding object ${finding.objectType}:${finding.objectValue} is not a valid ${finding.objectType}` +
            (evidenceIds.length > 1 ? ` (evidence: ${evidenceIds.join(", ")})` : ""),
        });
        continue;
      }
      const objectId = ensureEntity(opts.ledger, id, finding.objectType, key);
      objectEntityIds.push(objectId);
      opts.ledger.append("claim.added", {
        id: claimId,
        subjectId,
        predicate: finding.predicate,
        objectId,
        confidence: finding.confidence,
        explanation: finding.explanation,
        validFrom: finding.validFrom ?? null,
        validTo: finding.validTo ?? null,
      });
      claimIds.push(claimId);
      appendPositive(opts, id, claimId, evidenceIds, observedAt);
    } else {
      // Literal attribute → claim with a value (shows as a node attribute, not an edge).
      attributeCount++;
      opts.ledger.append("claim.added", {
        id: claimId,
        subjectId,
        predicate: finding.predicate,
        value: literalValue(finding),
        confidence: finding.confidence,
        explanation: finding.explanation,
        validFrom: finding.validFrom ?? null,
        validTo: finding.validTo ?? null,
      });
      claimIds.push(claimId);
      appendPositive(opts, id, claimId, evidenceIds, observedAt);
    }
  }
  return { objectEntityIds, claimIds, attributeCount, rejectedCount };
}

/**
 * Expands one output against every parent. This is the D-019 entry point: the same finding is
 * bound to each parent, so a node discovered from N parents keeps N edges. Returns one result per
 * parent (in parent order).
 */
export function expandForParents(output: TransformOutputLike, parentIds: readonly string[], opts: ExpandOptions): ExpandResult[] {
  return parentIds.map((subjectId) => expandFindings(output, subjectId, opts));
}

/**
 * P2-036 — the evidence a finding rests on: its own `evidenceIds` (each must be non-empty) or the output-wide
 * `opts.evidenceId`. Neither is a programming error, not a finding to record without proof.
 */
function findingEvidence(finding: Finding, opts: ExpandOptions): string[] {
  if (finding.evidenceIds !== undefined) {
    if (finding.evidenceIds.length === 0 || finding.evidenceIds.some((e) => e.length === 0)) {
      throw new Error(`finding ${finding.predicate} ${finding.objectType}: evidenceIds must name at least one evidence record`);
    }
    return [...new Set(finding.evidenceIds)];
  }
  if (opts.evidenceId) return [opts.evidenceId];
  throw new Error(
    `finding ${finding.predicate} ${finding.objectType} has no evidence: set Finding.evidenceIds or ExpandOptions.evidenceId`,
  );
}

/** One positive observation per evidence record the claim rests on: each record independently observed it. */
function appendPositive(opts: ExpandOptions, id: () => string, claimId: string, evidenceIds: readonly string[], observedAt: string): void {
  for (const evidenceId of evidenceIds) {
    opts.ledger.append("observation.added", {
      id: id(),
      claimId,
      transformId: opts.transformId,
      evidenceId,
      observedAt,
      kind: "positive",
    });
  }
}

/** The literal value of a finding: a number/boolean when the string parses, else the string. */
function literalValue(finding: Finding): string | number | boolean {
  const v = finding.objectValue;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

/**
 * Creates the entity for a canonical key. A fresh id is used each time; the projector's
 * entity.added handler treats a later entity with the same canonicalKey as an alias of the first
 * (D-020: one node per real-world identifier), so repeated expansion of the same value never
 * creates a duplicate node and never raises a duplicate-id issue.
 */
function ensureEntity(ledger: Ledger, id: () => string, type: string, key: string): string {
  const entityId = id();
  ledger.append("entity.added", {
    id: entityId,
    type,
    canonicalKey: key,
    labels: { en: key.slice(key.indexOf(":") + 1) },
    props: {},
  });
  return entityId;
}
