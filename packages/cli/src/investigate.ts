/**
 * P2-038 — the investigation loop: registered connectors driven by entity type, from one seed, under a budget.
 *
 * Every run is an ordinary isolated `--network` run (P2-037: registry, input check, sandbox, IPC, production gateway,
 * evidence per request, findings bound to their own evidence — P2-036). This module only decides WHAT runs next and
 * WHEN to stop:
 *
 * - Selection by type: for each entity, the registered transforms whose declared subjects include the entity's
 *   catalog type (optionally narrowed by the operator's `transforms` list). The input is built by the registry entry
 *   for that type (never `manifest.inputs[0]`) and checked before the run; a refused input is coverage `not_run`.
 * - One canonical entity per identifier: the frontier is keyed by canonicalKey, so an identifier reached from several
 *   parents is expanded once, while the ledger keeps one claim (edge) per parent and per source (D-019): the graph
 *   is a graph, not a tree.
 * - No repeats, no cycles: a (transform, canonicalKey) pair runs at most once per investigation — a finding that
 *   leads back to an expanded identifier adds its edge but no new run.
 * - Budget: depth, number of runs, number of requests (enforced per request, inside a run), bytes received (P2-039:
 *   one `ByteBudget` shared by every request of the investigation and charged by the gateway's transport WHILE each
 *   response is received; the chunk that would pass it stops the transfer with `byte_budget`, and no request starts
 *   once it is exhausted; each response is also capped by the gateway's maxSizeBytes), wall time (the running run is
 *   cancelled at the deadline). Cancellation (the caller's signal) stops the running run and everything after it.
 * - One gateway for the whole investigation: its per-host rate budget is not reset run by run. Runs are paced by
 *   one gateway token interval so consecutive runs against the same source do not drain the per-host budget.
 * - Coverage per (entity, transform): `found` (positive observations), `none` (negative observations), `failed`
 *   (error observation), `not_run` (with the reason: depth, budget, cancelled, input refused, setup refused). The
 *   first three are already observations in the case; `not_run` is written to the audit chain
 *   (`investigate.not_run`), so the case records what was NOT checked as well.
 * - The host list is the operator's and is never widened by what a source returns.
 */
import { canonicalKey, isoNow, systemClock, type Clock } from "@ir/core";
import { specById } from "@ir/core/identifiers";
import { ByteBudget, RequestBudget } from "@ir/egress";
import type { Case } from "@ir/store";
import { runTransform, TransformRunError, type RunTransformResult } from "@ir/transforms";
import { networkRunFor, openGateway, resolveSecretBinding, type NetworkDeps, type NetworkGateway, type NetworkPlan } from "./network.ts";
import { REGISTRY, subjectInput, type RegisteredTransform } from "./registry.ts";
import { ensureSubject, ledgerTransformId, recordRunFailure, recordRunSuccess } from "./run-record.ts";

export interface InvestigationBudget {
  /** Entities deeper than this (seed = 0) are recorded but not expanded. */
  readonly maxDepth: number;
  /** Transform runs started, over the whole investigation. */
  readonly maxRuns: number;
  /** Requests sent through the gateway, over the whole investigation (enforced per request). */
  readonly maxRequests: number;
  /**
   * Response bytes received over the whole investigation, enforced while each response is received (P2-039); each
   * response is also capped by the gateway's maxSizeBytes.
   */
  readonly maxBytes: number;
  /** Wall time; the run in progress at the deadline is cancelled and recorded as failed. */
  readonly maxElapsedMs: number;
}

export const DEFAULT_BUDGET: InvestigationBudget = {
  maxDepth: 1,
  maxRuns: 10,
  maxRequests: 50,
  maxBytes: 10_000_000,
  maxElapsedMs: 120_000,
};

export type CoverageState = "found" | "none" | "failed" | "not_run";

export interface CoverageRecord {
  readonly entityKey: string;
  readonly transformId: string;
  readonly depth: number;
  readonly state: CoverageState;
  /** Why it did not run, or the failure message. */
  readonly reason?: string;
  readonly requests: number;
  readonly findings: number;
  /** P2-029: the measured wall time of the executed run (ms). */
  readonly elapsedMs?: number;
  /** P2-029: the measured byte cost of the executed run (the shared budget's delta). */
  readonly bytes?: number;
}

/** P2-029: one source's measured statistics — outcomes, wall time, and the measured cost (requests + bytes). */
export interface SourceStats {
  readonly transformId: string;
  /** Executed runs (found + none + failed). */
  readonly runs: number;
  readonly found: number;
  readonly none: number;
  readonly failed: number;
  readonly notRun: number;
  /** The measured cost: transport requests this source made, and the bytes it consumed. */
  readonly requests: number;
  readonly bytes: number;
  /** The measured wall time of the executed runs (ms). */
  readonly elapsedMs: number;
}

export interface InvestigationResult {
  readonly seedKey: string;
  readonly coverage: CoverageRecord[];
  /** P2-029: per-source statistics (success/failure/time/measured cost), aggregated from the coverage. */
  readonly sources: SourceStats[];
  /** Entities whose type no selected registered transform accepts (recorded in the graph, not expanded). */
  readonly unexpandable: string[];
  readonly runs: number;
  readonly requests: number;
  readonly bytes: number;
  readonly stopReason?: "depth" | "runs" | "requests" | "bytes" | "time" | "cancelled";
}

export interface InvestigateOptions {
  readonly allowHosts: readonly string[];
  readonly budget?: Partial<InvestigationBudget>;
  /** Restrict selection to these transform ids (each must be registered). Default: every registered transform. */
  readonly transforms?: readonly string[];
  /** P2-029: exclude these transform ids from this invocation only (each must be registered); the case's disabled sources are excluded on every invocation. */
  readonly exclude?: readonly string[];
  readonly network?: NetworkDeps;
  readonly clock?: Clock;
  /** Wall clock (ms) for the time budget and the transforms' rate limiters. */
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly signal?: AbortSignal;
}

/**
 * P2-029: the sources disabled on this case, from its audit chain — the latest `source.disable`/
 * `source.enable` event per transform id wins. An investigation never invokes a disabled source.
 */
export function disabledSources(c: Case): Map<string, { disabled: boolean; reason?: string }> {
  const state = new Map<string, { disabled: boolean; reason?: string }>();
  for (const ev of c.auditTrail()) {
    if (ev.action !== "source.disable" && ev.action !== "source.enable") continue;
    const reason = typeof ev.detail?.reason === "string" ? ev.detail.reason : undefined;
    state.set(ev.target, { disabled: ev.action === "source.disable", ...(reason ? { reason } : {}) });
  }
  return state;
}

interface Node {
  readonly key: string;
  readonly type: string;
  readonly value: string;
  readonly depth: number;
}

function validBudget(b: InvestigationBudget): string | undefined {
  for (const [k, v] of Object.entries(b)) {
    if (!Number.isInteger(v) || v < 0) return `budget ${k} must be a non-negative integer (got ${String(v)})`;
  }
  return undefined;
}

/** Selected registry entries: every registered transform, or exactly the ones the operator named. */
export function selectTransforms(ids: readonly string[] | undefined): RegisteredTransform[] | { error: string } {
  if (!ids || ids.length === 0) return [...REGISTRY];
  const out: RegisteredTransform[] = [];
  for (const id of ids) {
    const e = REGISTRY.find((r) => r.transform.manifest.id === id);
    if (!e) return { error: `unknown transform "${id}"` };
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

/** The transforms that apply to an entity type, in registry order. */
export function applicable(entries: readonly RegisteredTransform[], type: string): RegisteredTransform[] {
  return entries.filter((e) => e.subjects[type] !== undefined);
}

type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;
type StopReason = NonNullable<InvestigationResult["stopReason"]>;

const realSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Checks of the seed and the selection, before the gateway is opened. */
function prepare(
  seed: { type: string; value: string },
  opts: InvestigateOptions,
): { budget: InvestigationBudget; selected: RegisteredTransform[]; seedKey: string } | { error: string } {
  const budget: InvestigationBudget = { ...DEFAULT_BUDGET, ...(opts.budget ?? {}) };
  const bad = validBudget(budget);
  if (bad) return { error: bad };
  const selected = selectTransforms(opts.transforms);
  if ("error" in selected) return selected;
  if (!specById(seed.type)) return { error: `subject type "${seed.type}" is not a catalog identifier type` };
  let seedKey: string;
  try {
    seedKey = canonicalKey(seed.type, seed.value);
  } catch (x) {
    return { error: `seed ${seed.type}:${seed.value} is not valid: ${(x as Error).message}` };
  }
  if (applicable(selected, seed.type).length === 0) return { error: `no selected transform accepts subject type "${seed.type}"` };
  return { budget, selected, seedKey };
}

/** The identifier findings of a run as frontier nodes (canonical keys; values the catalog refuses are skipped). */
function childrenOf(findings: RunTransformResult["output"]["findings"], depth: number): Node[] {
  const out: Node[] = [];
  for (const f of findings) {
    if (!specById(f.objectType)) continue;
    const key = keyOrUndefined(f.objectType, f.objectValue);
    // A value the catalog refuses is not a node: the ledger recorded it as an error observation of the run.
    if (key !== undefined) out.push({ key, type: f.objectType, value: key.slice(f.objectType.length + 1), depth });
  }
  return out;
}

function keyOrUndefined(type: string, value: string): string | undefined {
  try {
    return canonicalKey(type, value);
  } catch {
    return undefined;
  }
}

/** One investigation's mutable state: usage, coverage, frontier, and the stop reason. */
class Investigation {
  /**
   * P2-041: the request budget as a `RequestBudget` — one meter shared by every transport of every run, taken
   * per hop inside the gateway's `runHops` (before DNS), so `state.requests` == actual transport calls.
   * Replaces P2-040's `requestMeter` (which counted one entry request and could not see redirect hops).
   */
  readonly requests: RequestBudget;
  /** P2-039: the hard total byte budget, shared by every request through the gateway. */
  readonly bytes: ByteBudget;
  readonly coverage: CoverageRecord[] = [];
  readonly unexpandable: string[] = [];
  readonly frontier: Node[];
  private readonly ran = new Set<string>();
  private readonly queued: Set<string>;
  runs = 0;
  timedOut = false;
  stopReason: StopReason | undefined;
  private readonly startedAt: number;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private readonly clock: Clock;
  private readonly pacingMs: number;

  constructor(
    private readonly c: Case,
    private readonly gw: NetworkGateway,
    private readonly budget: InvestigationBudget,
    private readonly selected: readonly RegisteredTransform[],
    private readonly opts: InvestigateOptions,
    seed: Node,
    /** P2-029: the case's disabled sources and this invocation's --exclude set — never invoked. */
    private readonly blocked2: { disabled: ReadonlyMap<string, { disabled: boolean; reason?: string }>; excluded: ReadonlySet<string> } = {
      disabled: new Map(),
      excluded: new Set(),
    },
  ) {
    this.frontier = [seed];
    this.bytes = new ByteBudget(budget.maxBytes);
    this.requests = new RequestBudget(budget.maxRequests);
    this.queued = new Set([seed.key]);
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? realSleep;
    this.clock = opts.clock ?? systemClock;
    this.startedAt = this.now();
    this.pacingMs = Math.ceil(1000 / (opts.network?.limits?.rateLimitPerHostPerSecond ?? 1));
  }

  private exhausted(): StopReason | undefined {
    if (this.opts.signal?.aborted) return "cancelled";
    if (this.runs >= this.budget.maxRuns) return "runs";
    if (this.requests.exhausted) return "requests";
    if (this.bytes.exhausted) return "bytes";
    if (this.timedOut || this.now() - this.startedAt >= this.budget.maxElapsedMs) return "time";
    return undefined;
  }

  private notRun(node: Node, entry: RegisteredTransform, reason: string): void {
    this.coverage.push({
      entityKey: node.key,
      transformId: entry.transform.manifest.id,
      depth: node.depth,
      state: "not_run",
      reason,
      requests: 0,
      findings: 0,
    });
    this.c.audit("investigate.not_run", node.key, { transform: ledgerTransformId(entry.transform), reason, depth: node.depth });
  }

  /** Why the pair cannot start now (depth, budget, cancellation), or undefined. */
  private blocked(node: Node): string | undefined {
    if (node.depth > this.budget.maxDepth) return `depth ${node.depth} > maxDepth ${this.budget.maxDepth}`;
    const stop = this.exhausted();
    if (!stop) return undefined;
    this.stopReason ??= stop;
    return stop === "cancelled" ? "cancelled" : `budget: ${stop}`;
  }

  async expand(node: Node): Promise<void> {
    const entries = applicable(this.selected, node.type);
    if (entries.length === 0) {
      this.unexpandable.push(node.key);
      return;
    }
    for (const entry of entries) {
      const pair = `${entry.transform.manifest.id}\u0000${node.key}`;
      if (this.ran.has(pair)) continue;
      this.ran.add(pair);
      await this.attempt(node, entry);
    }
  }

  /** P2-029: why this source must not run for this investigation, or undefined when it may. */
  private blockedSource(entry: RegisteredTransform): string | undefined {
    const id = entry.transform.manifest.id;
    const dis = this.blocked2.disabled.get(id);
    if (dis?.disabled) return `disabled: ${dis.reason ?? "no reason recorded"}`;
    if (this.blocked2.excluded.has(id)) return "excluded by the operator (--exclude)";
    return undefined;
  }

  private async attempt(node: Node, entry: RegisteredTransform): Promise<void> {
    // P2-029: a source disabled on the case, or excluded by the operator for this invocation, is never
    // invoked — recorded as not_run with its reason, before any budget or setup consideration.
    const sourceBlocked = this.blockedSource(entry);
    if (sourceBlocked !== undefined) return this.notRun(node, entry, sourceBlocked);
    const blocked = this.blocked(node);
    if (blocked) return this.notRun(node, entry, blocked);
    const prepared = subjectInput(entry, node.type, node.value);
    if ("error" in prepared) return this.notRun(node, entry, `input refused: ${prepared.error}`);
    // P2-016: the entry's secret binding (or its documented refusal) — resolved here too, not
    // only in planNetworkRun: an investigation must not run a keyed transform keyless.
    const secret = resolveSecretBinding(entry.transform.manifest, this.opts.network ?? {});
    if (secret.error) return this.notRun(node, entry, `setup refused: ${secret.error}`);
    const plan = networkRunFor(
      this.c,
      this.gw,
      entry,
      node.type,
      this.opts.network ?? {},
      this.bytes,
      // P2-041: one RequestBudget shared by every run of this investigation; the gateway takes one per hop.
      this.requests,
      secret.binding,
    );
    if ("error" in plan) return this.notRun(node, entry, `setup refused: ${plan.error}`);
    if (this.runs > 0) await this.sleep(this.pacingMs, this.opts.signal ?? new AbortController().signal);
    if (this.opts.signal?.aborted) {
      this.stopReason ??= "cancelled";
      return this.notRun(node, entry, "cancelled");
    }
    await this.execute(node, entry, prepared.input, plan);
  }

  private async execute(node: Node, entry: RegisteredTransform, input: Record<string, unknown>, plan: NetworkPlan): Promise<void> {
    this.runs++;
    const subjectId = ensureSubject(this.c, node.key, node.type, this.clock);
    // The run's signal: the caller's cancellation, or the investigation deadline.
    const run = new AbortController();
    const onAbort = () => run.abort();
    this.opts.signal?.addEventListener("abort", onAbort, { once: true });
    const remaining = Math.max(1, this.budget.maxElapsedMs - (this.now() - this.startedAt));
    const deadline = setTimeout(() => {
      this.timedOut = true;
      run.abort();
    }, remaining);
    const before = this.requests.usedCount;
    const bytesBefore = this.bytes.used;
    const startedAt = this.now();
    const base = { entityKey: node.key, transformId: entry.transform.manifest.id, depth: node.depth };
    try {
      const result = await runTransform(entry.transform, {
        transport: plan.transport,
        input,
        ...(this.opts.now ? { now: this.opts.now } : {}),
        ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
        signal: run.signal,
        fetchedAt: () => isoNow(this.clock),
        requireIsolation: true,
        isolatedModule: plan.isolatedModule,
        transformId: entry.transform.manifest.id,
      });
      recordRunSuccess(this.c, subjectId, entry.transform, input, result, this.clock, "network");
      const findings = result.output.findings;
      this.coverage.push({
        ...base,
        state: findings.length > 0 ? "found" : "none",
        requests: this.requests.usedCount - before,
        findings: findings.length,
        elapsedMs: Math.max(0, this.now() - startedAt),
        bytes: this.bytes.used - bytesBefore,
      });
      this.enqueue(childrenOf(findings, node.depth + 1));
    } catch (x) {
      if (!(x instanceof TransformRunError)) throw x;
      recordRunFailure(this.c, subjectId, entry.transform, input, x, this.clock, "network");
      const why = this.failure(x);
      this.coverage.push({
        ...base,
        state: "failed",
        reason: `[${x.stage}] ${why}`,
        requests: this.requests.usedCount - before,
        findings: 0,
        elapsedMs: Math.max(0, this.now() - startedAt),
        bytes: this.bytes.used - bytesBefore,
      });
    } finally {
      clearTimeout(deadline);
      this.opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  /** Why a run failed, and whether that stops the investigation (cancellation, deadline, byte budget). */
  private failure(x: TransformRunError): string {
    if (this.opts.signal?.aborted === true) {
      this.stopReason ??= "cancelled";
      return "cancelled";
    }
    if (this.timedOut) {
      this.stopReason ??= "time";
      return "time budget reached";
    }
    // P2-039: the byte budget ran out while this run's response was being received.
    if (this.bytes.exhausted) this.stopReason ??= "bytes";
    return x.message;
  }

  /** One frontier entry per canonical key, whatever the number of parents (each parent's edge is in the ledger). */
  private enqueue(children: readonly Node[]): void {
    for (const child of children) {
      if (this.queued.has(child.key)) continue;
      this.queued.add(child.key);
      this.frontier.push(child);
    }
  }
}

/**
 * Runs the investigation from `seed` into the open case `c`. Never throws for a run failure: every run is recorded
 * (found / none / failed) and everything not run is recorded with its reason.
 */
export async function investigate(
  c: Case,
  seed: { type: string; value: string },
  opts: InvestigateOptions,
): Promise<InvestigationResult | { error: string }> {
  const ready = prepare(seed, opts);
  if ("error" in ready) return ready;
  const { budget, selected, seedKey } = ready;
  // P2-029: validate the per-invocation exclusion (each id must be registered) and read the case's
  // disabled sources from its audit chain — an investigation never invokes a disabled source.
  const excluded = new Set<string>();
  for (const id of opts.exclude ?? []) {
    if (!REGISTRY.find((r) => r.transform.manifest.id === id)) return { error: `unknown transform "${id}"` };
    excluded.add(id);
  }
  const disabled = disabledSources(c);
  const disabledNow = [...disabled.entries()].filter(([, s]) => s.disabled).map(([id]) => id);
  // P2-016: the provider registry config for secret-bearing runs, aggregated from every selected
  // transform's binding (hosts + paths together). A selected transform whose secret cannot be
  // resolved (no registry entry / vault unavailable) does not break the whole investigation — its
  // runs are refused per entry below with the documented reason.
  const providers = selected
    .map((e) => resolveSecretBinding(e.transform.manifest, opts.network ?? {}))
    .reduce<{
      providerHosts: Record<string, readonly string[]>;
      providerPaths: Record<string, readonly string[]>;
      providerQueries: Record<string, readonly import("@ir/egress").ProviderQueryAllow[]>;
    }>(
      (acc, r) => {
        if (!r.providers) return acc;
        for (const [name, hosts] of Object.entries(r.providers.providerHosts) as [string, readonly string[]][])
          acc.providerHosts[name] = hosts;
        for (const [name, paths] of Object.entries(r.providers.providerPaths) as [string, readonly string[]][])
          acc.providerPaths[name] = paths;
        // P2-016 continuation: the per-provider query allowlist merges like hosts+paths — an
        // investigate run of TR-009 must carry it or the search query would be refused (the gap the
        // advisor caught: the aggregation dropped it while planNetworkRun passed it).
        if (r.providers.providerQueries)
          for (const [name, queries] of Object.entries(r.providers.providerQueries) as [
            string,
            readonly import("@ir/egress").ProviderQueryAllow[],
          ][])
            acc.providerQueries[name] = queries;
        return acc;
      },
      { providerHosts: {}, providerPaths: {}, providerQueries: {} },
    );
  const hasProviders = Object.keys(providers.providerHosts).length > 0;
  // the aggregated allowlist rides along with the hosts (an empty map is harmless: a provider
  // with no allowlist entry keeps the fail-closed default — every query refused).
  const gw = openGateway(c, opts.allowHosts, opts.network ?? {}, hasProviders ? providers : undefined);
  if ("error" in gw) return gw;
  c.audit("investigate.started", seedKey, {
    transforms: selected.map((e) => e.transform.manifest.id),
    budget: { ...budget },
    allowedHosts: [...gw.allowedHosts],
    // P2-029: the exclusion surface of this invocation — the case's disabled sources and the operator's --exclude set.
    ...(disabledNow.length > 0 || excluded.size > 0 ? { excluded: { disabled: disabledNow, operator: [...excluded] } } : {}),
  });
  const inv = new Investigation(
    c,
    gw,
    budget,
    selected,
    opts,
    {
      key: seedKey,
      type: seed.type,
      value: seedKey.slice(seed.type.length + 1),
      depth: 0,
    },
    { disabled, excluded },
  );
  for (let i = 0; i < inv.frontier.length; i++) await inv.expand(inv.frontier[i]);
  // P2-029: the per-source statistics — outcomes, wall time, and the measured cost (requests + bytes).
  const sources = sourceStats(inv.coverage);
  const result: InvestigationResult = {
    seedKey,
    coverage: inv.coverage,
    sources,
    unexpandable: inv.unexpandable,
    runs: inv.runs,
    requests: inv.requests.usedCount,
    bytes: inv.bytes.used,
    ...(inv.stopReason ? { stopReason: inv.stopReason } : {}),
  };
  c.audit("investigate.completed", seedKey, {
    runs: result.runs,
    requests: result.requests,
    bytes: result.bytes,
    stopReason: result.stopReason ?? null,
    coverage: result.coverage.map((r) => ({
      entity: r.entityKey,
      transform: r.transformId,
      state: r.state,
      ...(r.reason ? { reason: r.reason } : {}),
    })),
    // P2-029: the same per-source statistics land in the audit chain (decision ج).
    sources: result.sources.map((s) => ({ ...s })),
    unexpandable: result.unexpandable,
  });
  return result;
}

/** P2-029: aggregates the coverage into per-source statistics (outcomes, time, measured cost). */
function sourceStats(coverage: readonly CoverageRecord[]): SourceStats[] {
  type Accumulator = {
    transformId: string;
    runs: number;
    found: number;
    none: number;
    failed: number;
    notRun: number;
    requests: number;
    bytes: number;
    elapsedMs: number;
  };
  const byId = new Map<string, Accumulator>();
  const of = (id: string): Accumulator => {
    let s = byId.get(id);
    if (s === undefined)
      byId.set(id, (s = { transformId: id, runs: 0, found: 0, none: 0, failed: 0, notRun: 0, requests: 0, bytes: 0, elapsedMs: 0 }));
    return s;
  };
  for (const r of coverage) {
    const s = of(r.transformId);
    s.requests += r.requests;
    if (r.elapsedMs !== undefined) s.elapsedMs += r.elapsedMs;
    if (r.bytes !== undefined) s.bytes += r.bytes;
    if (r.state === "found") s.found++;
    else if (r.state === "none") s.none++;
    else if (r.state === "failed") s.failed++;
    else s.notRun++;
  }
  for (const s of byId.values()) s.runs = s.found + s.none + s.failed;
  return [...byId.values()];
}

export interface Corroboration {
  readonly subjectKey: string;
  readonly predicate: string;
  readonly object: string;
  /** Positive observations of this statement (every run, every evidence record). */
  readonly observations: number;
  /**
   * Distinct sources: a source is a transform and the host it read. Repeated observations from the same source
   * (a re-run, several queries to the same resolver) are ONE source, not independent confirmation.
   */
  readonly sources: ReadonlyArray<{ transformId: string; host: string; observations: number; firstAt: string; lastAt: string }>;
}

interface CaseIndex {
  readonly keyOf: Map<string, string>;
  readonly claims: Map<string, { subjectId: string; predicate: string; objectId?: string; value?: unknown }>;
  readonly evidence: Map<string, { url: string; fetchedAt?: string }>;
  readonly positives: Array<{ claimId: string; evidenceId: string; transformId: string; observedAt: string }>;
}

function indexEntries(entries: ReadonlyArray<{ kind: string; payload: unknown }>): CaseIndex {
  const ix: CaseIndex = { keyOf: new Map(), claims: new Map(), evidence: new Map(), positives: [] };
  for (const e of entries) {
    const p = e.payload as Record<string, unknown>;
    if (e.kind === "entity.added") ix.keyOf.set(String(p.id), String(p.canonicalKey));
    else if (e.kind === "claim.added") ix.claims.set(String(p.id), p as never);
    else if (e.kind === "evidence.stored") {
      const req = p.request as { url?: string } | undefined;
      ix.evidence.set(String(p.id), { url: String(req?.url ?? ""), fetchedAt: p.fetchedAt as string | undefined });
    } else if (e.kind === "observation.added" && p.kind === "positive" && typeof p.claimId === "string") {
      ix.positives.push({
        claimId: p.claimId,
        evidenceId: String(p.evidenceId),
        transformId: String(p.transformId),
        observedAt: String(p.observedAt),
      });
    }
  }
  return ix;
}

/** The host a piece of evidence was read from (`ir-run` for the local run record). */
function sourceHost(url: string | undefined): string {
  if (!url) return "unknown";
  try {
    const u = new URL(url);
    return u.host || u.protocol.replace(/:$/, "");
  } catch {
    return "unknown";
  }
}

type Obs = { t: string; host: string; at: string };

function bySource(obs: readonly Obs[]): Corroboration["sources"] {
  const m = new Map<string, { transformId: string; host: string; observations: number; firstAt: string; lastAt: string }>();
  for (const o of obs) {
    const k = `${o.t}\u0000${o.host}`;
    const s = m.get(k) ?? { transformId: o.t, host: o.host, observations: 0, firstAt: o.at, lastAt: o.at };
    s.observations++;
    if (o.at < s.firstAt) s.firstAt = o.at;
    if (o.at > s.lastAt) s.lastAt = o.at;
    m.set(k, s);
  }
  return [...m.values()];
}

/**
 * Groups the positive observations of identical statements (subject, predicate, object — by canonical key, so
 * aliases of one identifier are one subject) by source identity. Only `sources.length` counts as independent
 * support; `observations` counts repetitions too.
 */
export function corroboration(entries: ReadonlyArray<{ kind: string; payload: unknown }>): Corroboration[] {
  const ix = indexEntries(entries);
  const groups = new Map<string, { subjectKey: string; predicate: string; object: string; obs: Obs[] }>();
  for (const o of ix.positives) {
    const claim = ix.claims.get(o.claimId);
    const subjectKey = claim ? ix.keyOf.get(claim.subjectId) : undefined;
    const object = claim?.objectId !== undefined ? ix.keyOf.get(claim.objectId) : `value:${JSON.stringify(claim?.value)}`;
    if (!claim || !subjectKey || !object) continue;
    const ev = ix.evidence.get(o.evidenceId);
    const k = `${subjectKey}\u0000${claim.predicate}\u0000${object}`;
    const g = groups.get(k) ?? { subjectKey, predicate: claim.predicate, object, obs: [] };
    g.obs.push({ t: o.transformId, host: sourceHost(ev?.url), at: ev?.fetchedAt ?? o.observedAt });
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({
    subjectKey: g.subjectKey,
    predicate: g.predicate,
    object: g.object,
    observations: g.obs.length,
    sources: bySource(g.obs),
  }));
}
