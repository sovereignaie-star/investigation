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
 * Every claim is recorded with a positive observation citing the evidence that produced it, so the
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
  /** The evidence id that backs these findings. */
  evidenceId: string;
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
    const claimId = id();
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
          evidenceId: opts.evidenceId,
          observedAt: now,
          kind: "error",
          note: `finding object ${finding.objectType}:${finding.objectValue} is not a valid ${finding.objectType}`,
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
      });
      claimIds.push(claimId);
      opts.ledger.append("observation.added", {
        id: id(),
        claimId,
        transformId: opts.transformId,
        evidenceId: opts.evidenceId,
        observedAt: now,
        kind: "positive",
      });
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
      });
      claimIds.push(claimId);
      opts.ledger.append("observation.added", {
        id: id(),
        claimId,
        transformId: opts.transformId,
        evidenceId: opts.evidenceId,
        observedAt: now,
        kind: "positive",
      });
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
