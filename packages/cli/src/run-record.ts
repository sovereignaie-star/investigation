/**
 * P2-036 — how one transform run is written into the case: evidence, claims and outcome observations, each finding
 * bound to the evidence of the request(s) it was derived from.
 *
 * The contract (checked by the runner before anything reaches this module, `checkFindingEvidence`):
 *   - every recorded request outcome carries a run-local `requestId` and its fetch time;
 *   - every finding of a run that made requests cites `evidence: [requestId, ...]` or `derivedFrom: "input"`.
 *
 * What this module writes:
 *   - one evidence record per request outcome (url, method, status when a response arrived, fetch time, content
 *     hash, transform id and version), kept in a `requestId → evidenceId` map — never "the last one";
 *   - each finding's claim with one positive observation per evidence record it cites;
 *   - a finding derived from the input, and every finding of a run that made no request, cites a LOCAL run record
 *     (`local://ir-run`, JSON: transform, version, input) instead of a source response;
 *   - an empty output: one negative observation per response received (each source was checked and showed nothing);
 *   - a failed run: one error observation citing the failed request's own evidence when a request failed, otherwise
 *     a LOCAL run record that names the stage, the message and every response the run had received.
 */
import { isoNow, ulidFactory, type Clock } from "@ir/core";
import { project } from "@ir/ledger/projections";
import { expandFindings, recordOutcome, type ExpandResult, type Finding } from "@ir/ledger";
import type { Case } from "@ir/store";
import type { RunTransformResult, Transform, TransformEvidence, TransformFinding, TransformRunError } from "@ir/transforms";

/** The ledger's transformId is a lowercase Slug; manifest ids are uppercase (TR-010 → tr-010). */
export function ledgerTransformId(transform: Transform): string {
  return transform.manifest.id.toLowerCase();
}

/** The mime type of a stored evidence blob, from the response's content-type (defaults to text/plain). */
function mimeFrom(headers: Readonly<Record<string, string>> | undefined): string {
  const ct = headers?.["content-type"] ?? headers?.["Content-Type"];
  if (!ct) return "text/plain";
  const mime = ct.split(";")[0].trim().toLowerCase();
  return /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : "text/plain";
}

/** One stored request outcome: the run-local request id and the case evidence id it was stored under. */
export interface StoredRequest {
  readonly requestId: number;
  readonly evidenceId: string;
  readonly url: string;
  readonly status?: number;
  readonly error?: string;
}

/**
 * Stores every recorded request outcome as evidence (D1: raw response, content-addressed), in request-id order.
 * P2-014: `origin` records how the request was executed ("network" = the real gateway; "sim" = the simulation
 * world) so the network log never presents a simulated outcome as a real external connection.
 */
export function storeRunEvidence(
  c: Case,
  evidence: readonly TransformEvidence[],
  transform: Transform,
  origin?: "network" | "sim" | "replay",
): StoredRequest[] {
  const stored: StoredRequest[] = [];
  for (const ev of [...evidence].sort((a, b) => a.requestId - b.requestId)) {
    const rec = c.addEvidence({
      bytes: new TextEncoder().encode(ev.body ?? ""),
      mime: mimeFrom(ev.headers),
      request: {
        method: ev.method === "HEAD" ? "HEAD" : "GET",
        url: ev.url,
        headers: {},
        ...(ev.status !== undefined ? { status: ev.status } : {}),
      },
      transformId: ledgerTransformId(transform),
      version: transform.manifest.version,
      fetchedAt: ev.fetchedAt,
      ...(origin ? { origin } : {}),
    });
    stored.push({
      requestId: ev.requestId,
      evidenceId: rec.id,
      url: ev.url,
      ...(ev.status !== undefined ? { status: ev.status } : {}),
      ...(ev.error ? { error: `${ev.error.kind}: ${ev.error.message}` } : {}),
    });
  }
  return stored;
}

/** A LOCAL record of the run itself (no source response): what ran, on what input, and why it is cited. */
function storeRunRecord(c: Case, transform: Transform, clock: Clock, body: Record<string, unknown>): string {
  const rec = c.addEvidence({
    bytes: new TextEncoder().encode(
      JSON.stringify({ transform: transform.manifest.id, version: transform.manifest.version, ...body }, null, 2),
    ),
    mime: "application/json",
    request: { method: "LOCAL", url: "local://ir-run", headers: {} },
    transformId: ledgerTransformId(transform),
    version: transform.manifest.version,
    fetchedAt: isoNow(clock),
  });
  return rec.id;
}

/** The evidence ids a finding rests on, from the request-id map (the runner already proved every id exists). */
function bindFinding(f: TransformFinding, byRequest: ReadonlyMap<number, string>, runRecord: () => string): Finding {
  const evidenceIds =
    f.evidence !== undefined
      ? f.evidence.map((ref) => {
          const id = byRequest.get(ref);
          if (!id) throw new Error(`finding ${f.predicate} ${f.objectType} cites request ${ref}, which has no stored evidence`);
          return id;
        })
      : [runRecord()];
  return {
    predicate: f.predicate,
    objectType: f.objectType,
    objectValue: f.objectValue,
    confidence: f.confidence,
    explanation: f.explanation,
    ...(f.objectId ? { objectId: f.objectId } : {}),
    evidenceIds,
    // P2-031 — the optional structured time fields pass through to the ledger Finding
    // (observedAt = capture time, validFrom/validTo = claim window); absent = processing time (the old behavior).
    ...(f.observedAt !== undefined ? { observedAt: f.observedAt } : {}),
    ...(f.validFrom !== undefined ? { validFrom: f.validFrom } : {}),
    ...(f.validTo !== undefined ? { validTo: f.validTo } : {}),
  };
}

export interface RecordedRun {
  readonly requests: StoredRequest[];
  readonly expand: ExpandResult;
  readonly negative: boolean;
  /** Each finding (in output order) with the case evidence ids it was bound to. */
  readonly bindings: ReadonlyArray<{ predicate: string; objectType: string; objectValue: string; evidenceIds: string[] }>;
}

/** Writes a successful run: evidence, then every finding bound to its own evidence, then a negative outcome if empty. */
export function recordRunSuccess(
  c: Case,
  subjectId: string,
  transform: Transform,
  input: Record<string, unknown>,
  result: RunTransformResult,
  clock: Clock,
  origin?: "network" | "sim" | "replay",
): RecordedRun {
  const requests = storeRunEvidence(c, result.evidence, transform, origin);
  const byRequest = new Map(requests.map((r) => [r.requestId, r.evidenceId]));
  let runRecordId: string | undefined;
  const runRecord = () => (runRecordId ??= storeRunRecord(c, transform, clock, { cited: "finding derived from the input", input }));
  const findings = result.output.findings.map((f) => bindFinding(f, byRequest, runRecord));
  const transformId = ledgerTransformId(transform);
  const expand = expandFindings({ findings }, subjectId, { ledger: c.ledger, transformId, clock });
  const negative = findings.length === 0;
  if (negative) {
    const answered = requests.filter((r) => r.status !== undefined);
    const cite =
      answered.length > 0
        ? answered.map((r) => r.evidenceId)
        : [storeRunRecord(c, transform, clock, { cited: "no request, no finding", input })];
    for (const evidenceId of cite) recordOutcome(subjectId, "negative", { ledger: c.ledger, transformId, evidenceId, clock });
  }
  return {
    requests,
    expand,
    negative,
    bindings: findings.map((f) => ({
      predicate: f.predicate,
      objectType: f.objectType,
      objectValue: f.objectValue,
      evidenceIds: f.evidenceIds ?? [],
    })),
  };
}

/** Writes a failed run: its evidence, and one error observation citing what failed (never an empty success). */
export function recordRunFailure(
  c: Case,
  subjectId: string,
  transform: Transform,
  input: Record<string, unknown>,
  x: TransformRunError,
  clock: Clock,
  origin?: "network" | "sim" | "replay",
): StoredRequest[] {
  const requests = storeRunEvidence(c, x.evidence, transform, origin);
  const failed = requests.find((r) => r.error !== undefined);
  const evidenceId =
    failed?.evidenceId ??
    storeRunRecord(c, transform, clock, {
      cited: "failed run",
      stage: x.stage,
      message: x.message,
      input,
      responses: requests.map((r) => ({ requestId: r.requestId, evidenceId: r.evidenceId, url: r.url, status: r.status })),
    });
  recordOutcome(
    subjectId,
    "error",
    { ledger: c.ledger, transformId: ledgerTransformId(transform), evidenceId, clock },
    `[${x.stage}] ${x.message}`,
  );
  return requests;
}

/**
 * The case entity for a subject: the existing node with that canonical key, else a new entity. One node per
 * identifier, whichever run or investigation reaches it (D-019/D-020).
 */
export function ensureSubject(c: Case, key: string, type: string, clock: Clock): string {
  const p = project(c.entries());
  const existing = p.graph.nodes.find((n) => n.canonicalKey === key);
  if (existing) return existing.id;
  const id = ulidFactory(clock)();
  c.append("entity.added", {
    id,
    type,
    canonicalKey: key,
    labels: { en: key.slice(key.indexOf(":") + 1) },
    props: {},
  });
  return id;
}
