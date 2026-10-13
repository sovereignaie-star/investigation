/**
 * P2-023 — expansion strategies (BFS / DFS / priority) with depth, node, time and
 * cost limits and custom stop rules.
 *
 * The engine's `RunEngine` (P2-001) executes a flat queue of runs. This module adds
 * the *expansion* layer: given a seed node, it runs a transform (via an injected
 * executor), turns the findings into new candidate nodes, and continues until the
 * strategy's frontier is empty or a limit / stop rule fires. The strategy decides
 * the ORDER in which the frontier is explored:
 *   - `bfs`: breadth-first (FIFO) — every node at depth d is expanded before any
 *     node at depth d+1.
 *   - `dfs`: depth-first (LIFO) — the most recently discovered node is expanded
 *     first.
 *   - `priority`: by type value and transform cost — score = value / (1 + cost),
 *     higher score first (stable: equal scores in insertion order).
 *
 * Limits (ROADMAP 5.7): `maxDepth` (a node deeper than the cap is a leaf, never
 * expanded), `maxNodes` (global cap on executor runs), `maxCostEstimate`
 * (cumulative cost of expanded nodes), `maxElapsedMs` (wall-clock cap, injectable
 * clock). A custom `stop` predicate can halt expansion on any condition.
 *
 * Determinism: the frontier is stable, the clock is injectable, and the executor
 * is injected — in tests it runs a real transform against `@ir/sim`, so the whole
 * expansion is reproducible with no external connections (P2-008).
 */
import { PriorityQueue } from "./queue.ts";

export type ExpansionStrategy = "bfs" | "dfs" | "priority";

/** A node in the expansion frontier. */
export interface ExpansionNode {
  /** Stable canonical id; the dedup key (a node discovered from several parents is expanded once). */
  readonly id: string;
  /** The transform kind to run on this node (interpreted by the executor). */
  readonly kind: string;
  /** The canonical input for the transform. */
  readonly canonicalInput: string;
  /** Depth from the seed (0 = seed). */
  readonly depth: number;
  /** Cost estimate for the transform on this node (used by the cost limit and priority score). */
  readonly costEstimate?: number;
  /** Type value used by the priority strategy (higher = more valuable). */
  readonly typeValue?: number;
  /** Transform cost used by the priority strategy (lower = cheaper). */
  readonly transformCost?: number;
}

/** Minimal finding shape (matches TransformFindingSchema / the ledger's Finding). */
export interface Finding {
  readonly predicate: string;
  readonly objectType: string;
  readonly objectValue: string;
  readonly objectId?: string;
  readonly confidence: number;
  readonly explanation: string;
}

export interface ExpansionLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxCostEstimate: number;
  readonly maxElapsedMs: number;
}

/** Snapshot handed to the custom stop rule. */
export interface ExpansionContext {
  readonly nodesExpanded: number;
  readonly nodesVisited: number;
  readonly elapsedMs: number;
  readonly currentDepth: number;
}

/** Runs a transform on a node and returns its findings. Injected for determinism. */
export interface ExpansionExecutor {
  run(node: ExpansionNode, signal: AbortSignal): Promise<Finding[]>;
}

export interface ExpansionOptions {
  readonly strategy: ExpansionStrategy;
  readonly limits: ExpansionLimits;
  readonly executor: ExpansionExecutor;
  /** Custom stop rule: return true to halt expansion. */
  readonly stop?: (ctx: ExpansionContext) => boolean;
  /** Map a finding to a candidate child node (or null to skip). Defaults to `defaultExpand`. */
  readonly expand?: (finding: Finding, parent: ExpansionNode) => ExpansionNode | null;
  /** Priority score for the `priority` strategy. Defaults to `defaultScore`. */
  readonly score?: (node: ExpansionNode) => number;
  /** Injectable clock for deterministic time-limit tests. */
  readonly now?: () => number;
}

export interface ExpansionResult {
  readonly nodesExpanded: number;
  readonly nodesVisited: number;
  readonly elapsedMs: number;
  readonly stopped: boolean;
  readonly stopReason?: string;
  /** Nodes expanded, in expansion order. */
  readonly visited: ReadonlyArray<ExpansionNode>;
}

/** Default finding → node mapping: every finding becomes a candidate node. */
export function defaultExpand(finding: Finding, parent: ExpansionNode): ExpansionNode | null {
  const id = finding.objectId ?? `${finding.objectType}:${finding.objectValue}`;
  return {
    id,
    kind: finding.objectType,
    canonicalInput: finding.objectValue,
    depth: parent.depth + 1,
    costEstimate: parent.costEstimate,
    typeValue: finding.confidence,
    transformCost: parent.costEstimate ?? 0,
  };
}

/** Default priority score: value per unit of cost. Higher is processed first. */
export function defaultScore(node: ExpansionNode): number {
  const value = node.typeValue ?? 0;
  const cost = node.transformCost ?? 0;
  return value / (1 + cost);
}

/** The frontier ordering for a strategy. */
export interface ExpansionFrontier {
  push(node: ExpansionNode): void;
  pop(): ExpansionNode | undefined;
  readonly size: number;
}

class FifoFrontier implements ExpansionFrontier {
  private readonly q: ExpansionNode[] = [];
  push(node: ExpansionNode): void {
    this.q.push(node);
  }
  pop(): ExpansionNode | undefined {
    return this.q.shift();
  }
  get size(): number {
    return this.q.length;
  }
}

class LifoFrontier implements ExpansionFrontier {
  private readonly q: ExpansionNode[] = [];
  push(node: ExpansionNode): void {
    this.q.push(node);
  }
  pop(): ExpansionNode | undefined {
    return this.q.pop();
  }
  get size(): number {
    return this.q.length;
  }
}

class PriorityFrontier implements ExpansionFrontier {
  private readonly q = new PriorityQueue<ExpansionNode>();
  private readonly score: (node: ExpansionNode) => number;
  constructor(score: (node: ExpansionNode) => number) {
    this.score = score;
  }
  push(node: ExpansionNode): void {
    // PriorityQueue pops the LOWEST priority first; higher score = process first.
    this.q.push(node, -this.score(node));
  }
  pop(): ExpansionNode | undefined {
    return this.q.pop();
  }
  get size(): number {
    return this.q.size;
  }
}

export function createFrontier(strategy: ExpansionStrategy, score?: (node: ExpansionNode) => number): ExpansionFrontier {
  switch (strategy) {
    case "bfs":
      return new FifoFrontier();
    case "dfs":
      return new LifoFrontier();
    case "priority":
      return new PriorityFrontier(score ?? defaultScore);
  }
}

function validateLimits(limits: ExpansionLimits): void {
  for (const [k, v] of Object.entries(limits) as [keyof ExpansionLimits, number][]) {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
      throw new RangeError(`ExpansionLimits.${k} must be a non-negative finite integer, got ${v}`);
    }
  }
}

/**
 * Expands a seed node under a strategy until the frontier is empty or a limit /
 * stop rule fires. The executor is the only place I/O happens; this class never
 * touches the network itself.
 */
export class ExpansionEngine {
  private readonly opts: {
    strategy: ExpansionStrategy;
    limits: ExpansionLimits;
    executor: ExpansionExecutor;
    stop?: (ctx: ExpansionContext) => boolean;
    expand: (finding: Finding, parent: ExpansionNode) => ExpansionNode | null;
    score: (node: ExpansionNode) => number;
    now: () => number;
  };

  constructor(opts: ExpansionOptions) {
    validateLimits(opts.limits);
    this.opts = {
      strategy: opts.strategy,
      limits: Object.freeze({ ...opts.limits }),
      executor: opts.executor,
      stop: opts.stop,
      expand: opts.expand ?? defaultExpand,
      score: opts.score ?? defaultScore,
      now: opts.now ?? (() => Date.now()),
    };
  }

  async run(seed: ExpansionNode, signal?: AbortSignal): Promise<ExpansionResult> {
    const startedAt = this.opts.now();
    const frontier = createFrontier(this.opts.strategy, this.opts.score);
    const visited = new Set<string>();
    const visitedOrder: ExpansionNode[] = [];
    let nodesExpanded = 0;
    let totalCost = 0;
    let stopped = false;
    let stopReason: string | undefined;

    frontier.push(seed);
    while (frontier.size > 0) {
      if (signal?.aborted) {
        stopped = true;
        stopReason = "cancelled";
        break;
      }
      const node = frontier.pop();
      if (!node) break;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      visitedOrder.push(node);
      const elapsedMs = this.opts.now() - startedAt;
      const ctx: ExpansionContext = {
        nodesExpanded,
        nodesVisited: visitedOrder.length,
        elapsedMs,
        currentDepth: node.depth,
      };
      const limit = this.checkLimits(ctx, nodesExpanded, totalCost, node);
      if (limit) {
        stopped = true;
        stopReason = limit;
        break;
      }
      // Depth limit: a node deeper than maxDepth is a leaf, never expanded.
      if (node.depth > this.opts.limits.maxDepth) continue;
      totalCost += node.costEstimate ?? 0;
      const findings = await this.opts.executor.run(node, signal ?? new AbortController().signal);
      nodesExpanded++;
      for (const finding of findings) {
        const child = this.opts.expand(finding, node);
        if (child) frontier.push(child);
      }
    }
    return {
      nodesExpanded,
      nodesVisited: visitedOrder.length,
      elapsedMs: this.opts.now() - startedAt,
      stopped,
      stopReason,
      visited: visitedOrder,
    };
  }

  /** Returns the stop reason when a limit or stop rule fires, else undefined. */
  private checkLimits(ctx: ExpansionContext, nodesExpanded: number, totalCost: number, node: ExpansionNode): string | undefined {
    if (nodesExpanded >= this.opts.limits.maxNodes) return "nodes";
    if (ctx.elapsedMs > this.opts.limits.maxElapsedMs) return "time";
    if (this.opts.stop?.(ctx)) return "stop-rule";
    if (totalCost + (node.costEstimate ?? 0) > this.opts.limits.maxCostEstimate) return "cost";
    return undefined;
  }
}
