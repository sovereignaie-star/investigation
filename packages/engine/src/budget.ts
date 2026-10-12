/**
 * Run budgets (P2-001, D-024). A run is refused (before any transport attempt) when
 * any cap would be exceeded; the transport itself is consulted via `consume()`
 * so that a run can never bypass or raise its own ceiling. Caps are frozen at
 * construction and validated (no NaN/negative/Infinity).
 */
export interface BudgetSnapshot {
  nodes: number;
  depth: number;
  requests: number;
  costEstimate: number;
  elapsedMs: number;
}

export interface BudgetCaps {
  maxNodes: number;
  maxDepth: number;
  maxRequests: number;
  maxCostEstimate: number;
  maxElapsedMs: number;
}

export type BudgetRefusal = "budget:nodes" | "budget:depth" | "budget:requests" | "budget:cost" | "budget:time";

export class BudgetExceededError extends Error {
  readonly refusal: BudgetRefusal;
  constructor(refusal: BudgetRefusal, detail: string) {
    super(`${refusal}: ${detail}`);
    this.name = "BudgetExceededError";
    this.refusal = refusal;
  }
}

function validDelta(name: string, v: number | undefined): number {
  if (v === undefined) return 0;
  if (!Number.isFinite(v)) throw new RangeError(`Budget delta: ${name} must be finite, got ${v}`);
  if (v < 0) throw new RangeError(`Budget delta: ${name} must be >= 0, got ${v}`);
  return v;
}

export class Budget {
  private readonly startedAt: number;
  private readonly used: BudgetSnapshot;
  private readonly now: () => number;
  private readonly capsCopy: Readonly<BudgetCaps>;
  /** Frozen, validated copy of the caller's caps; mutating the input object later has no effect. */
  get caps(): Readonly<BudgetCaps> {
    return this.capsCopy;
  }

  constructor(caps: BudgetCaps, now: () => number = () => Date.now()) {
    this.now = now;
    this.startedAt = now();
    for (const [k, v] of Object.entries(caps) as [keyof BudgetCaps, number][]) {
      if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
        throw new RangeError(`Budget caps: ${k} must be a non-negative finite integer, got ${v}`);
      }
    }
    this.capsCopy = Object.freeze({ ...caps });
    this.used = { nodes: 0, depth: 0, requests: 0, costEstimate: 0, elapsedMs: 0 };
  }

  snapshot(): BudgetSnapshot {
    return { ...this.used, elapsedMs: this.now() - this.startedAt };
  }

  /** Fails the whole run if the proposed delta would exceed any cap. Does not mutate. */
  check(delta: Partial<BudgetSnapshot> = {}): void {
    const s = this.snapshot();
    const next = {
      nodes: s.nodes + validDelta("nodes", delta.nodes),
      depth: Math.max(s.depth, validDelta("depth", delta.depth)),
      requests: s.requests + validDelta("requests", delta.requests),
      costEstimate: s.costEstimate + validDelta("costEstimate", delta.costEstimate),
      elapsedMs: s.elapsedMs + validDelta("elapsedMs", delta.elapsedMs),
    };
    if (next.nodes > this.caps.maxNodes) throw new BudgetExceededError("budget:nodes", `${next.nodes} > ${this.caps.maxNodes}`);
    if (next.depth > this.caps.maxDepth) throw new BudgetExceededError("budget:depth", `${next.depth} > ${this.caps.maxDepth}`);
    if (next.requests > this.caps.maxRequests)
      throw new BudgetExceededError("budget:requests", `${next.requests} > ${this.caps.maxRequests}`);
    if (next.costEstimate > this.caps.maxCostEstimate)
      throw new BudgetExceededError("budget:cost", `${next.costEstimate} > ${this.caps.maxCostEstimate}`);
    if (next.elapsedMs > this.caps.maxElapsedMs)
      throw new BudgetExceededError("budget:time", `${next.elapsedMs} > ${this.caps.maxElapsedMs}`);
  }

  /** Atomically consumes the delta after a successful check. */
  consume(delta: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
    this.check(delta);
    this.used.nodes += validDelta("nodes", delta.nodes);
    this.used.depth = Math.max(this.used.depth, validDelta("depth", delta.depth));
    this.used.requests += validDelta("requests", delta.requests);
    this.used.costEstimate += validDelta("costEstimate", delta.costEstimate);
    this.used.elapsedMs = this.now() - this.startedAt;
    return this.snapshot();
  }
}
