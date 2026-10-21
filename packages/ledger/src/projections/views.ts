import type { Projector, StoredClaim, StoredObservation } from "./state.ts";

/** Derived views (P1-016). Every list is sorted by id so equal states give byte-identical JCS (projectionHash). */
type Counts = { positive: number; negative: number; error: number };
const zero = (): Counts => ({ positive: 0, negative: 0, error: 0 });
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sorted = (s: Iterable<string>) => [...new Set(s)].sort();

/** P4-006 — one observation as the projections serve it per claim: the bitemporal contract in one row.
 *  `observedAt` is the OBSERVATION time (when we saw it); the claim's validity lives on the claim
 *  (validFrom/validTo) and must never leak into this record. */
export interface ClaimObservation {
  observationId: string;
  evidenceId: string;
  observedAt: string;
  kind: "positive" | "negative" | "error";
}

/** P4-006 — observations sort by MOMENT, not by text: ISO strings with mixed timezone offsets
 *  ("2026-01-01T10:00:00-05:00" = 15:00Z) make text order lie about which came first.
 *  The schema accepts fractional seconds of ANY length (verified: 20 digits pass
 *  `z.iso.datetime({ offset: true })`, which also accepts a missing-seconds `T00:00Z` form),
 *  which Date.parse collapses — so the moment key compares the whole-second instant via
 *  Date.parse PLUS the fraction as full decimal TEXT (right-padded to the longer fraction,
 *  never truncated, never converted to a number): `.1` equals `.10`, `.01` sorts before both,
 *  and every accepted precision is preserved. */
const ISO_MOMENT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
const momentKey = (t: string): { ms: number; frac: string } => {
  const m = ISO_MOMENT.exec(t);
  if (!m) return { ms: Date.parse(t), frac: "" };
  return { ms: Date.parse(`${m[1]}T${m[2]}${m[4]}`), frac: m[3] ?? "" };
};
const byObservedMoment = (a: string, b: string): number => {
  const ka = momentKey(a);
  const kb = momentKey(b);
  if (ka.ms !== kb.ms) return ka.ms - kb.ms;
  const n = Math.max(ka.frac.length, kb.frac.length);
  const fa = ka.frac.padEnd(n, "0");
  const fb = kb.frac.padEnd(n, "0");
  return fa < fb ? -1 : fa > fb ? 1 : 0;
};
const byMoment = (a: { id: string; observedAt: string }, b: { id: string; observedAt: string }) => {
  const d = byObservedMoment(a.observedAt, b.observedAt);
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};
const claimObservations = (obs: StoredObservation[] = []): ClaimObservation[] =>
  obs
    .map((o) => ({ observationId: o.id, evidenceId: o.evidenceId, observedAt: o.observedAt, kind: o.kind }))
    .sort((a, b) => {
      const d = byObservedMoment(a.observedAt, b.observedAt);
      return d !== 0 ? d : a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0;
    });

export interface GraphNode {
  id: string;
  type: string;
  canonicalKey: string;
  labels: { ar?: string; en?: string };
  props: Record<string, unknown>;
  /** Other entity ids shown as this node: same canonical key, or merged into it. */
  aliases: string[];
  /** Claims whose object is a literal value. `evidenceIds` per claim: every field shown
   *  to the investigator must link to its evidence (P3-008). P4-006: literal claims carry the
   *  SAME bitemporal data as relation edges — validity on the claim, observations beside it. */
  attributes: {
    claimId: string;
    predicate: string;
    value: string | number | boolean;
    confidence: number;
    validFrom: string | null;
    validTo: string | null;
    evidenceIds: string[];
    observations: ClaimObservation[];
  }[];
  observations: Counts;
  evidenceIds: string[];
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  predicate: string;
  confidence: number;
  validFrom: string | null;
  validTo: string | null;
  explanation: string;
  evidenceIds: string[];
  /** P4-006 — the claim's own observations (id, evidence, time, kind), earliest moment first. */
  observations: ClaimObservation[];
}
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

function observationsBy(p: Projector) {
  const byNode = new Map<string, StoredObservation[]>();
  const byClaim = new Map<string, StoredObservation[]>();
  for (const o of p.observations) {
    if (o.claimId) push(byClaim, o.claimId, o);
    if (o.entityId && p.entities.has(o.entityId)) {
      const n = p.resolve(o.entityId);
      push(byNode, n, o);
    }
  }
  return { byNode, byClaim };
}

const count = (obs: StoredObservation[] = []) => obs.reduce((c, o) => ({ ...c, [o.kind]: c[o.kind] + 1 }), zero());
const known = (p: Projector, c: StoredClaim) => p.entities.has(c.subjectId) && (!c.objectId || p.entities.has(c.objectId));

export function graphView(p: Projector): Graph {
  const { byNode, byClaim } = observationsBy(p);
  const nodes = new Map<string, GraphNode>();
  for (const e of p.entities.values()) {
    const id = p.resolve(e.id);
    const root = p.entities.get(id) ?? e;
    const n = nodes.get(id) ?? {
      id,
      type: root.type,
      canonicalKey: root.canonicalKey,
      labels: root.labels,
      props: root.props,
      aliases: [],
      attributes: [],
      observations: count(byNode.get(id)),
      evidenceIds: sorted((byNode.get(id) ?? []).map((o) => o.evidenceId)),
    };
    if (e.id !== id) n.aliases.push(e.id);
    nodes.set(id, n);
  }
  const edges: GraphEdge[] = [];
  for (const c of p.claims.values()) {
    if (!known(p, c)) continue;
    const source = p.resolve(c.subjectId);
    if (c.objectId === undefined) {
      nodes.get(source)?.attributes.push({
        claimId: c.id,
        predicate: c.predicate,
        value: c.value as string | number | boolean,
        confidence: c.confidence,
        validFrom: c.validFrom,
        validTo: c.validTo,
        evidenceIds: sorted((byClaim.get(c.id) ?? []).map((o) => o.evidenceId)),
        observations: claimObservations(byClaim.get(c.id)),
      });
      continue;
    }
    const target = p.resolve(c.objectId);
    if (source === target) continue; // both ends merged into one node: the claim stays in the table, not as a loop
    edges.push({
      id: c.id,
      source,
      target,
      predicate: c.predicate,
      confidence: c.confidence,
      validFrom: c.validFrom,
      validTo: c.validTo,
      explanation: c.explanation,
      evidenceIds: sorted((byClaim.get(c.id) ?? []).map((o) => o.evidenceId)),
      observations: claimObservations(byClaim.get(c.id)),
    });
  }
  const list = [...nodes.values()].map((n) => ({
    ...n,
    aliases: n.aliases.sort(),
    attributes: n.attributes.sort((a, b) => (a.claimId < b.claimId ? -1 : 1)),
  }));
  return { nodes: list.sort(byId), edges: edges.sort(byId) };
}

export interface TableRow {
  id: string;
  type: string;
  canonicalKey: string;
  label: string;
  aliases: number;
  claims: number;
  observations: Counts;
  evidence: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
}

export function tableView(p: Projector, graph: Graph = graphView(p)): TableRow[] {
  const claims = new Map<string, number>();
  for (const c of p.claims.values()) {
    if (!known(p, c)) continue;
    for (const id of new Set([p.resolve(c.subjectId), ...(c.objectId ? [p.resolve(c.objectId)] : [])]))
      claims.set(id, (claims.get(id) ?? 0) + 1);
  }
  const { byNode } = observationsBy(p);
  return graph.nodes.map((n) => {
    const obs = (byNode.get(n.id) ?? []).slice().sort(byMoment);
    return {
      id: n.id,
      type: n.type,
      canonicalKey: n.canonicalKey,
      label: n.labels.ar ?? n.labels.en ?? n.canonicalKey,
      aliases: n.aliases.length,
      claims: claims.get(n.id) ?? 0,
      observations: n.observations,
      evidence: n.evidenceIds.length,
      firstObservedAt: obs[0]?.observedAt ?? null,
      lastObservedAt: obs.at(-1)?.observedAt ?? null,
    };
  });
}

/**
 * P2-014 — the per-case network log (E-06 / T-ETH-006): every external request the case made, visible in
 * one view. Two sources, both already written per case by the production paths (nothing new is recorded
 * here — this is a projection over the chain):
 *   - `requests`: one row per outbound request the gateway was asked to make, from `egress.*` audit
 *     events — including robots.txt fetches and requests refused before the transport (allowed AND
 *     denied). Redirect hops within one request are its `transportCalls` count (the accounting unit
 *     of P2-040/041/042), not separate rows.
 *   - `responses`: one row per stored request outcome (`evidence.stored` with a real request — URL,
 *     method, status, size). LOCAL run records (`local://ir-run`) are run records, not external
 *     requests, and stay out.
 * Both lists are in ledger (seq) order.
 */
const EGRESS_ACTION = /^egress\.(allowed|denied|transport_error|timeout|rate_limited|size_limit)$/;

export interface NetworkRequest {
  seq: number;
  at: string;
  decision: "allowed" | "denied" | "transport_error" | "timeout" | "rate_limited" | "size_limit";
  /** The host the request went to (the audit target; the transform name when a refusal preceded DNS). */
  host: string;
  transform?: string;
  transportCalls: number;
  reason?: string;
  /** ADR-31 (P2-028): the route the request took (direct / proxy-http-connect / proxy-socks5 / tor). */
  route?: string;
}
export interface NetworkResponse {
  seq: number;
  at: string;
  evidenceId: string;
  method: string;
  url: string;
  status?: number;
  size: number;
  transformId: string;
  version: string;
  /** P2-014: how the request was executed; a "sim"/"replay" outcome is a recorded outcome, not a real connection. */
  origin?: "network" | "sim" | "replay";
}
export interface NetworkTransportCall {
  seq: number;
  at: string;
  /** The URL of the actual transport call, secret-redacted. */
  url: string;
  /** The 1-based hop index of the attempt. */
  attempt: number;
  host: string;
  status?: number;
  /** The failure message when the attempt failed. */
  error?: string;
  transform?: string;
  /** ADR-31 (P2-028): the route the call took. */
  route?: string;
}
/** ADR-31 (P2-028, item هـ): one proxy liveness check — what triggered it and what it found. */
export interface NetworkLiveness {
  seq: number;
  at: string;
  /** The proxy the check probed. */
  proxyHost: string;
  proxyPort?: number;
  trigger: "startup" | "rotation" | "interval" | "failure";
  alive: boolean;
  latencyMs?: number;
  error?: string;
  /** ADR-31 (P2-028): the route the checked proxy serves. */
  route?: string;
}
export interface NetworkLog {
  requests: NetworkRequest[];
  /** Every ACTUAL transport call (first hop, redirects, failures) — one row per attempt. */
  transportCalls: NetworkTransportCall[];
  responses: NetworkResponse[];
  /** ADR-31 (P2-028, item هـ): every proxy liveness check (startup / rotation / interval / failure). */
  liveness: NetworkLiveness[];
}

function requestRow(a: Projector["audits"][number]): NetworkRequest | null {
  const decision = EGRESS_ACTION.exec(a.action)?.[1] as NetworkRequest["decision"] | undefined;
  if (!decision) return null; // case lifecycle, robots policy, … — not outbound requests
  const detail = a.detail as Record<string, unknown> | undefined;
  return {
    seq: a.seq,
    at: a.at,
    decision,
    host: a.target,
    ...(typeof detail?.transform === "string" ? { transform: detail.transform } : {}),
    ...(typeof detail?.transportCalls === "number" ? { transportCalls: detail.transportCalls } : { transportCalls: 0 }),
    ...(typeof detail?.reason === "string" ? { reason: detail.reason } : {}),
    ...(typeof detail?.route === "string" ? { route: detail.route } : {}),
  };
}

function transportRow(a: Projector["audits"][number]): NetworkTransportCall | null {
  if (a.action !== "egress.transport") return null;
  const detail = a.detail as Record<string, unknown> | undefined;
  if (typeof detail?.url !== "string" || typeof detail?.attempt !== "number") return null; // malformed: not a log row
  return {
    seq: a.seq,
    at: a.at,
    url: detail.url,
    attempt: detail.attempt,
    host: a.target,
    ...(typeof detail?.status === "number" ? { status: detail.status } : {}),
    ...(typeof detail?.error === "string" ? { error: detail.error } : {}),
    ...(typeof detail?.transform === "string" ? { transform: detail.transform } : {}),
    ...(typeof detail?.route === "string" ? { route: detail.route } : {}),
  };
}

function responseRow(ev: Projector["evidence"] extends Map<string, infer V> ? V : never): NetworkResponse | null {
  if (ev.request.method === "LOCAL" || ev.request.url.startsWith("local://")) return null;
  return {
    seq: ev.seq,
    at: ev.fetchedAt,
    evidenceId: ev.id,
    method: ev.request.method,
    url: ev.request.url,
    ...(ev.request.status !== undefined ? { status: ev.request.status } : {}),
    size: ev.size,
    transformId: ev.transformId,
    version: ev.version,
    ...(ev.origin ? { origin: ev.origin } : {}),
  };
}

/** ADR-31 (P2-028, item هـ): the proxy liveness rows — egress.liveness chain events. */
function livenessRow(a: Projector["audits"][number]): NetworkLiveness | null {
  if (a.action !== "egress.liveness") return null;
  const detail = a.detail as Record<string, unknown> | undefined;
  const trigger = detail?.trigger;
  if (typeof detail?.proxyHost !== "string" || typeof trigger !== "string") return null; // malformed: not a liveness row
  return {
    seq: a.seq,
    at: a.at,
    proxyHost: detail.proxyHost,
    ...(typeof detail?.proxyPort === "number" ? { proxyPort: detail.proxyPort } : {}),
    trigger: trigger as NetworkLiveness["trigger"],
    alive: detail?.alive === true,
    ...(typeof detail?.latencyMs === "number" ? { latencyMs: detail.latencyMs } : {}),
    ...(typeof detail?.error === "string" ? { error: detail.error } : {}),
    ...(typeof detail?.route === "string" ? { route: detail.route } : {}),
  };
}

export function networkLogView(p: Projector): NetworkLog {
  const requests: NetworkRequest[] = [];
  const transportCalls: NetworkTransportCall[] = [];
  const liveness: NetworkLiveness[] = [];
  for (const a of p.audits) {
    const request = requestRow(a);
    if (request) requests.push(request);
    else {
      const call = transportRow(a);
      if (call) transportCalls.push(call);
      else {
        const lv = livenessRow(a);
        if (lv) liveness.push(lv);
      }
    }
  }
  const responses: NetworkResponse[] = [];
  for (const ev of p.evidence.values()) {
    const row = responseRow(ev);
    if (row) responses.push(row);
  }
  responses.sort((a, b) => a.seq - b.seq);
  return { requests, transportCalls, responses, liveness };
}

export interface CoverageCell {
  entityId: string;
  transformId: string;
  positive: number;
  negative: number;
  error: number;
  last: "positive" | "negative" | "error";
  lastAt: string;
}
export interface Coverage {
  cells: CoverageCell[];
  transforms: string[];
  /** Nodes with no observation at all: nothing has been tried on them yet. */
  untouched: string[];
}

/** Which transform ran on which node and what came back; "searched, found nothing" counts as coverage (D3). */
export function coverageView(p: Projector, graph: Graph = graphView(p)): Coverage {
  const cells = new Map<string, CoverageCell>();
  for (const o of p.observations) {
    const subject = o.entityId ?? p.claims.get(o.claimId ?? "")?.subjectId;
    if (!subject || !p.entities.has(subject)) continue;
    const entityId = p.resolve(subject);
    const k = `${entityId}\u0000${o.transformId}`;
    const c = cells.get(k) ?? {
      entityId,
      transformId: o.transformId,
      positive: 0,
      negative: 0,
      error: 0,
      last: o.kind,
      lastAt: o.observedAt,
    };
    c[o.kind]++;
    if (byObservedMoment(o.observedAt, c.lastAt) >= 0) {
      c.last = o.kind;
      c.lastAt = o.observedAt;
    }
    cells.set(k, c);
  }
  const list = [...cells.values()].sort((a, b) => (a.entityId + a.transformId < b.entityId + b.transformId ? -1 : 1));
  const touched = new Set(list.map((c) => c.entityId));
  return {
    cells: list,
    transforms: sorted(list.map((c) => c.transformId)),
    untouched: graph.nodes.map((n) => n.id).filter((id) => !touched.has(id)),
  };
}
