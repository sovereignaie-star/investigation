/**
 * Run lifecycle (P2-001). A run has a runId created at submit(), a per-run
 * CancellationToken (D-022) registered before execution starts so a queued run can be
 * cancelled without ever reaching the transport, and a Budget (D-024) that counts every
 * transport attempt. The engine delegates I/O to the injected transport; it never
 * performs real network I/O itself. Errors are classified into `RunFailure` so callers
 * can inspect the reason (testable rejections).
 */
import { Budget, BudgetExceededError, type BudgetCaps, type BudgetSnapshot } from "./budget.ts";
import { CancellationError, createCancellationToken, type CancellationToken } from "./cancel.ts";
import { PriorityQueue } from "./queue.ts";
import { TransportError, type HttpTransport, type TransportRequest, type TransportResponse } from "./transport.ts";

export type RunPhase = "queued" | "running" | "cancelled" | "failed" | "succeeded";

export interface RunInput {
  readonly kind: string;
  readonly canonicalInput: string;
  readonly priority?: number;
  readonly depth?: number;
  readonly costEstimate?: number;
}

export interface RunResult {
  readonly runId: string;
  readonly phase: RunPhase;
  readonly budget: BudgetSnapshot;
  readonly processed: number;
  readonly transportAttempts: number;
  readonly failure?: RunFailure;
}

export type RunFailure =
  | { kind: "budget"; refusal: string; message: string }
  | { kind: "cancel"; reason: string }
  | { kind: "transport"; kindDetail: string; message: string }
  | { kind: "transform"; message: string };

export interface EngineOptions {
  /** Required: the run transport. In tests this is a deterministic fake. */
  readonly transport: HttpTransport;
  readonly caps: BudgetCaps;
  readonly now?: () => number;
  /** Random source for runId suffixes; tests pass a seeded one for determinism. */
  readonly random?: (n: number) => string;
  readonly concurrency?: number;
  /** Retry backoff base for transient transport errors (5.7). */
  readonly retryBaseMs?: number;
  readonly maxRetries?: number;
  /** Sleep used for retry backoff; injectable for deterministic tests. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface RunHandle {
  readonly runId: string;
  cancel(reason?: string): boolean;
}

/** A phase transition observed on a run (P2-019: SSE events). */
export interface RunPhaseEvent {
  readonly runId: string;
  readonly phase: RunPhase;
  readonly at: number;
}

interface RunRecord {
  readonly runId: string;
  readonly input: RunInput;
  readonly token: CancellationToken;
  phase: RunPhase;
  transportAttempts: number;
  processed: number;
  failure?: RunFailure;
  result?: RunResult;
}

export class RunEngine {
  private readonly queue = new PriorityQueue<string>();
  private readonly records = new Map<string, RunRecord>();
  private readonly results = new Map<string, RunResult>();
  private readonly opts: {
    caps: BudgetCaps;
    now: () => number;
    random: (n: number) => string;
    concurrency: number;
    retryBaseMs: number;
    maxRetries: number;
    sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  };
  private readonly transport: HttpTransport;
  private draining = false;
  private readonly phaseListeners = new Set<(e: RunPhaseEvent) => void>();

  /** Subscribes to phase transitions (P2-019: SSE). Returns an unsubscribe function. */
  onPhaseChange(listener: (e: RunPhaseEvent) => void): () => void {
    this.phaseListeners.add(listener);
    return () => {
      this.phaseListeners.delete(listener);
    };
  }

  private emitPhase(runId: string, phase: RunPhase): void {
    const at = this.opts.now();
    for (const l of this.phaseListeners) l({ runId, phase, at });
  }

  constructor(opts: EngineOptions) {
    this.transport = opts.transport;
    const caps = opts.caps;
    // Validate and snapshot the caps: later mutation of the caller's object has no effect.
    // Every required cap must be present by name; a missing one is a RangeError, not a silent undefined.
    const requiredCaps: (keyof BudgetCaps)[] = ["maxNodes", "maxDepth", "maxRequests", "maxCostEstimate", "maxElapsedMs"];
    for (const k of requiredCaps) {
      const v = caps[k];
      if (v === undefined) {
        throw new RangeError(`EngineOptions.caps.${k} is required and missing`);
      }
      if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
        throw new RangeError(`EngineOptions.caps.${k} must be a non-negative finite integer, got ${v}`);
      }
    }
    const capsSnapshot: BudgetCaps = Object.freeze({ ...caps }) as BudgetCaps;
    const intOpt = (name: string, v: number | undefined, dflt: number, min: number) => {
      if (v === undefined) return dflt;
      if (!Number.isFinite(v) || !Number.isInteger(v) || v < min) {
        throw new RangeError(`EngineOptions.${name} must be an integer >= ${min}, got ${v}`);
      }
      return v;
    };
    this.opts = {
      caps: capsSnapshot,
      now: opts.now ?? (() => Date.now()),
      random:
        opts.random ??
        ((n: number) =>
          Math.random()
            .toString(36)
            .slice(2, 2 + n)),
      concurrency: intOpt("concurrency", opts.concurrency, 4, 1),
      retryBaseMs: intOpt("retryBaseMs", opts.retryBaseMs, 100, 0),
      maxRetries: intOpt("maxRetries", opts.maxRetries, 3, 0),
      sleep:
        opts.sleep ??
        ((ms, signal) =>
          new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, ms);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(t);
                reject(signal.reason);
              },
              { once: true },
            );
          })),
    };
  }

  /** Registers a run and returns a handle whose runId is stable across drain() calls. */
  submit(input: RunInput): RunHandle {
    const runId = `run-${(this.records.size + 1).toString(36).padStart(4, "0")}-${this.opts.random(6)}`;
    const token = createCancellationToken();
    const record: RunRecord = {
      runId,
      input,
      token,
      phase: "queued",
      transportAttempts: 0,
      processed: 0,
    };
    this.records.set(runId, record);
    this.queue.push(runId, input.priority ?? 0);
    return {
      runId,
      cancel: (reason?: string) => this.cancel(runId, reason),
    };
  }

  /** Cancels a run, queued or running. Returns false if unknown or already finished. */
  cancel(runId: string, reason = "user"): boolean {
    const rec = this.records.get(runId);
    if (!rec || rec.phase === "cancelled" || rec.phase === "failed" || rec.phase === "succeeded") {
      return false;
    }
    rec.token.cancel(reason);
    return true;
  }

  result(runId: string): RunResult | undefined {
    return this.results.get(runId);
  }

  /** True if a run with this id was ever submitted (P2-019: SSE existence check). */
  has(runId: string): boolean {
    return this.records.has(runId);
  }

  /**
   * Drains the queue subject to concurrency, budget and cancellation. Each call
   * processes only runs still queued; runs already finished are not re-executed.
   * Overlapping drains are rejected: they would exceed the concurrency budget.
   */
  async drain(): Promise<RunResult[]> {
    if (this.draining) {
      throw new Error("drain() is already in progress; await it before draining again");
    }
    this.draining = true;
    try {
      const out: RunResult[] = [];
      const workers: Promise<void>[] = [];
      for (let i = 0; i < this.opts.concurrency; i++) {
        workers.push(this.worker(out));
      }
      await Promise.all(workers);
      return out;
    } finally {
      this.draining = false;
    }
  }

  private async worker(out: RunResult[]): Promise<void> {
    for (;;) {
      const runId = this.queue.pop();
      if (!runId) return;
      const rec = this.records.get(runId);
      if (!rec || rec.result) continue;
      const res = await this.execute(rec);
      out.push(res);
      this.results.set(runId, res);
    }
  }

  private async execute(rec: RunRecord): Promise<RunResult> {
    rec.phase = "running";
    this.emitPhase(rec.runId, "running");
    // A run cancelled while queued fails fast with zero transport attempts.
    if (rec.token.isCancelled) {
      const reason = (await rec.token.whenCancelled) || "user";
      rec.phase = "cancelled";
      this.emitPhase(rec.runId, "cancelled");
      const result: RunResult = {
        runId: rec.runId,
        phase: "cancelled",
        budget: { nodes: 0, depth: 0, requests: 0, costEstimate: 0, elapsedMs: 0 },
        processed: 0,
        transportAttempts: 0,
        failure: { kind: "cancel", reason },
      };
      rec.result = result;
      return result;
    }
    const budget = new Budget(this.opts.caps, this.opts.now);
    try {
      budget.consume({
        nodes: 1,
        depth: rec.input.depth ?? 0,
        costEstimate: rec.input.costEstimate ?? 0,
      });
      const req: TransportRequest = { method: "GET", url: rec.input.canonicalInput };
      await this.fetchWithRetry(rec, budget, req);
      // A run cancelled during transport is not a success, even if the transport completed.
      rec.token.throwIfCancelled();
      // A transport that ignored the abort signal and resolved late is not a success either:
      // the deadline is enforced on the success path, not only around the await.
      this.remainingTimeMs(budget);
      rec.processed = 1;
      rec.phase = "succeeded";
      this.emitPhase(rec.runId, "succeeded");
      const result: RunResult = {
        runId: rec.runId,
        phase: rec.phase,
        budget: budget.snapshot(),
        processed: rec.processed,
        transportAttempts: rec.transportAttempts,
      };
      rec.result = result;
      return result;
    } catch (err) {
      const failure = this.toFailure(err);
      rec.phase = failure.kind === "cancel" ? "cancelled" : "failed";
      this.emitPhase(rec.runId, rec.phase);
      const result: RunResult = {
        runId: rec.runId,
        phase: rec.phase,
        budget: budget.snapshot(),
        processed: rec.processed,
        transportAttempts: rec.transportAttempts,
        failure,
      };
      rec.result = result;
      return result;
    }
  }

  private toFailure(err: unknown): RunFailure {
    if (err instanceof CancellationError) return { kind: "cancel", reason: err.message };
    if (err instanceof BudgetExceededError) return { kind: "budget", refusal: err.refusal, message: err.message };
    if (err instanceof TransportError) return { kind: "transport", kindDetail: err.kind, message: err.message };
    return { kind: "transform", message: err instanceof Error ? err.message : String(err) };
  }

  private async fetchWithRetry(rec: RunRecord, budget: Budget, req: TransportRequest): Promise<TransportResponse> {
    let attempt = 0;
    for (;;) {
      // Re-check cancellation before every attempt so a cancelled run never issues another request.
      rec.token.throwIfCancelled();
      // Every attempt, including retries, is charged against the requests budget.
      budget.consume({ requests: 1 });
      rec.transportAttempts++;
      // The whole run (transport + backoff waits) is bounded by the time cap: a pending
      // transport or backoff sleep is cut off when the time budget runs out.
      const remainingMs = this.remainingTimeMs(budget);
      const timeoutSignal = AbortSignal.timeout(Math.max(1, Math.ceil(remainingMs)));
      const combined = AbortSignal.any([rec.token.signal, timeoutSignal]);
      try {
        // Race the transport against the deadline so a transport that ignores the
        // abort signal cannot keep the run pending past the time budget.
        const res = await this.raceWithDeadline(this.transport.fetch(req, combined), rec.token.signal, timeoutSignal, remainingMs);
        if (res.status >= 500 || res.status === 429) {
          throw new TransportError("transport:http-error", `HTTP ${res.status}`, {
            retryable: true,
            retryAfterMs: res.status === 429 ? 200 : undefined,
          });
        }
        return res;
      } catch (err) {
        if (err instanceof CancellationError) throw err;
        if (err instanceof BudgetExceededError) throw err;
        if (timeoutSignal.aborted && !rec.token.signal.aborted) {
          throw new BudgetExceededError(
            "budget:time",
            `transport or backoff exceeded the remaining time budget (${Math.ceil(remainingMs)}ms)`,
          );
        }
        if (rec.token.signal.aborted) {
          throw new CancellationError("cancelled during transport");
        }
        if (err instanceof TransportError && err.retryable && attempt < this.opts.maxRetries) {
          attempt++;
          await this.backoffWait(rec, timeoutSignal, remainingMs, attempt);
          continue;
        }
        throw err;
      }
    }
  }

  private remainingTimeMs(budget: Budget): number {
    const remaining = this.opts.caps.maxElapsedMs - budget.snapshot().elapsedMs;
    if (remaining <= 0) {
      throw new BudgetExceededError("budget:time", `elapsed ${budget.snapshot().elapsedMs}ms >= cap ${this.opts.caps.maxElapsedMs}ms`);
    }
    return remaining;
  }

  /**
   * Races a pending promise against BOTH the run's cancellation and the deadline. A
   * transport that ignores its abort signal still cannot hold the run: the engine stops
   * waiting as soon as the run is cancelled (CancellationError with the user's reason)
   * or the time budget runs out (BudgetExceededError budget:time), whichever comes first.
   * The transport promise itself is not killed — that needs an OS-level boundary.
   */
  private async raceWithDeadline<T>(
    pending: Promise<T>,
    cancelSignal: AbortSignal,
    timeoutSignal: AbortSignal,
    remainingMs: number,
  ): Promise<T> {
    let onTimeout: () => void = () => {};
    let onCancel: () => void = () => {};
    const cancelReason = (): string =>
      cancelSignal.reason instanceof Error ? cancelSignal.reason.message : String(cancelSignal.reason ?? "user");
    // Cancellation wins over the deadline when BOTH signals are already aborted:
    // the eager checks run in a fixed order (cancel first, then deadline) before
    // the race is created, so a settled `pending` cannot beat the cancellation
    // either. The pending promise's own rejection is still handled if it settles
    // later on the normal path below.
    if (cancelSignal.aborted) {
      // Attach no listeners to an already-aborted signal; reject immediately.
      const err = new CancellationError(cancelReason());
      void pending.then(
        () => undefined,
        () => undefined,
      ); // keep the pending rejection observed
      throw err;
    }
    if (timeoutSignal.aborted) {
      const err = new BudgetExceededError(
        "budget:time",
        `transport or backoff exceeded the remaining time budget (${Math.ceil(remainingMs)}ms)`,
      );
      void pending.then(
        () => undefined,
        () => undefined,
      ); // keep the pending rejection observed
      throw err;
    }
    const deadline = new Promise<never>((_resolve, reject) => {
      onTimeout = () =>
        reject(
          new BudgetExceededError("budget:time", `transport or backoff exceeded the remaining time budget (${Math.ceil(remainingMs)}ms)`),
        );
      timeoutSignal.addEventListener("abort", onTimeout, { once: true });
    });
    const cancelled = new Promise<never>((_resolve, reject) => {
      // The user's cancellation reason is preserved verbatim; it is never replaced
      // by a generic cause, and it is never waited out behind the time budget.
      onCancel = () => reject(new CancellationError(cancelReason()));
      cancelSignal.addEventListener("abort", onCancel, { once: true });
    });
    try {
      return await Promise.race([pending, deadline, cancelled]);
    } finally {
      if (typeof timeoutSignal.removeEventListener === "function") {
        timeoutSignal.removeEventListener("abort", onTimeout);
      }
      if (typeof cancelSignal.removeEventListener === "function") {
        cancelSignal.removeEventListener("abort", onCancel);
      }
    }
  }

  private async backoffWait(rec: RunRecord, timeoutSignal: AbortSignal, remainingMs: number, attempt: number): Promise<void> {
    const waitMs = Math.min(this.opts.retryBaseMs * 2 ** attempt, remainingMs);
    const combined = AbortSignal.any([rec.token.signal, timeoutSignal]);
    // The backoff wait is bounded by the SAME shared race as the transport: a sleep
    // implementation that ignores its abort signal cannot hold the run past either
    // the cancellation or the time budget, whichever comes first. The reason is kept
    // correct: CancellationError for cancellation, budget:time for the deadline.
    await this.raceWithDeadline(this.opts.sleep(waitMs, combined), rec.token.signal, timeoutSignal, remainingMs);
  }
}
