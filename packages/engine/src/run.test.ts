import { describe, expect, it } from "vitest";
import { RunEngine, type RunQueueStore } from "./run.ts";
import { TransportError, type HttpTransport, type TransportRequest, type TransportResponse } from "./transport.ts";

const caps = {
  maxNodes: 5,
  maxDepth: 3,
  maxRequests: 5,
  maxCostEstimate: 100,
  maxElapsedMs: 5_000,
};

/** Deterministic runId suffix: same length/shape as Math.random's, but stable per call index. */
function fakeRandom() {
  let n = 0;
  return (len: number) => `r${(++n).toString(36).padStart(len - 1, "0")}`;
}

function fakeTransport(
  behavior: (
    req: TransportRequest,
    signal: AbortSignal,
  ) => TransportResponse | TransportError | Promise<TransportResponse | TransportError>,
): HttpTransport & { calls: number } {
  const t = {
    calls: 0,
    async fetch(req: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
      t.calls++;
      if (signal.aborted) throw new TransportError("transport:network", "aborted");
      const out = await behavior(req, signal);
      if (out instanceof TransportError) throw out;
      return out;
    },
  };
  return t;
}

const ok: TransportResponse = { status: 200, body: "ok" };

/** Injected, signal-aware sleep used to make retry tests deterministic and cancellable. */
function makeSleep(signalLog: string[] = []) {
  return async (ms: number, signal: AbortSignal): Promise<void> => {
    signalLog.push(`sleep:${ms}`);
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          signalLog.push("abort");
          reject(signal.reason);
        },
        { once: true },
      );
    });
  };
}

describe("RunEngine", () => {
  it("runs a single input to success and reports the budget", async () => {
    const engine = new RunEngine({
      transport: fakeTransport(() => ok),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
    });
    const h = engine.submit({ kind: "domain", canonicalInput: "https://example.test/x" });
    const [res] = await engine.drain();
    expect(res.runId).toBe(h.runId);
    expect(res.phase).toBe("succeeded");
    expect(res.budget.requests).toBe(1);
    expect(res.processed).toBe(1);
    expect(res.transportAttempts).toBe(1);
  });

  it("fails the whole run when the budget would be exceeded (D-024)", async () => {
    const engine = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1 });
    engine.submit({ kind: "domain", canonicalInput: "https://example.test/x", depth: 4 });
    const [res] = await engine.drain();
    expect(res.phase).toBe("failed");
    expect(res.failure?.kind).toBe("budget");
    expect(res.failure).toMatchObject({ refusal: "budget:depth" });
  });

  it("classifies transport failures with a machine-readable reason", async () => {
    const engine = new RunEngine({
      transport: fakeTransport(() => new TransportError("transport:ssrf-blocked", "loopback")),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 0,
    });
    engine.submit({ kind: "domain", canonicalInput: "http://127.0.0.1/" });
    const [res] = await engine.drain();
    expect(res.phase).toBe("failed");
    expect(res.failure).toMatchObject({ kind: "transport", kindDetail: "transport:ssrf-blocked" });
  });

  it("retries transient 5xx up to maxRetries then succeeds", async () => {
    let calls = 0;
    const engine = new RunEngine({
      transport: fakeTransport(() => {
        calls++;
        return calls <= 2 ? ({ status: 503, body: "" } as TransportResponse) : ok;
      }),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 2,
    });
    engine.submit({ kind: "domain", canonicalInput: "https://example.test/x" });
    const [res] = await engine.drain();
    expect(res.phase).toBe("succeeded");
    expect(calls).toBe(3);
    expect(res.transportAttempts).toBe(3);
    expect(res.budget.requests).toBe(3);
  });

  it("exhausts retries on persistent 5xx and fails with a typed transport failure", async () => {
    let calls = 0;
    const engine = new RunEngine({
      transport: fakeTransport(() => {
        calls++;
        return { status: 503, body: "" } as TransportResponse;
      }),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 2,
    });
    engine.submit({ kind: "domain", canonicalInput: "https://example.test/x" });
    const [res] = await engine.drain();
    expect(res.phase).toBe("failed");
    expect(res.failure).toMatchObject({ kind: "transport", kindDetail: "transport:http-error" });
    expect(calls).toBe(3);
  });

  it("charges every retry attempt against the requests budget (D-024)", async () => {
    const oneRequestCaps = { ...caps, maxRequests: 1 };
    let calls = 0;
    const engine = new RunEngine({
      transport: fakeTransport(() => {
        calls++;
        return { status: 503, body: "" } as TransportResponse;
      }),
      caps: oneRequestCaps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 3,
    });
    engine.submit({ kind: "domain", canonicalInput: "https://example.test/x" });
    const [res] = await engine.drain();
    expect(calls).toBe(1); // second attempt blocked by the budget before transport
    expect(res.phase).toBe("failed");
    expect(res.failure).toMatchObject({ kind: "budget", refusal: "budget:requests" });
  });

  it("does not retry non-retryable failures", async () => {
    let calls = 0;
    const engine = new RunEngine({
      transport: fakeTransport(() => {
        calls++;
        return new TransportError("transport:dns", "nx");
      }),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 3,
    });
    engine.submit({ kind: "domain", canonicalInput: "https://nx.test/" });
    const [res] = await engine.drain();
    expect(res.phase).toBe("failed");
    expect(calls).toBe(1);
  });

  it("cancelling a queued run before drain produces cancelled with zero transport attempts (D-022, P3-011: recorded immediately)", async () => {
    const transport = fakeTransport(() => {
      throw new TransportError("transport:network", "should never be called");
    });
    const engine = new RunEngine({
      transport,
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 0,
    });
    const h = engine.submit({ kind: "domain", canonicalInput: "https://example.test/x" });
    const cancelled = engine.cancel(h.runId, "owner");
    expect(cancelled).toBe(true);
    // P3-011: the cancellation is visible BEFORE any drain — no worker needed.
    const res = engine.result(h.runId);
    expect(res?.phase).toBe("cancelled");
    expect(res?.transportAttempts).toBe(0);
    expect(transport.calls).toBe(0);
    expect(res?.failure).toMatchObject({ kind: "cancel", reason: "owner" });
    // A later drain neither resurrects nor re-executes the cancelled run.
    expect(await engine.drain()).toEqual([]);
  });

  it("cancelling a running run during backoff aborts the wait and yields cancelled", async () => {
    let cancelledRunId = "";
    const signalLog: string[] = [];
    const transport = fakeTransport(() => new TransportError("transport:http-error", "HTTP 503", { retryable: true }));
    const engine = new RunEngine({
      transport,
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 5,
      sleep: makeSleep(signalLog),
    });
    const h = engine.submit({ kind: "domain", canonicalInput: "https://example.test/x" });
    cancelledRunId = h.runId;
    const drained = engine.drain();
    // Give the worker a tick to start the first attempt and enter backoff.
    await new Promise((r) => setTimeout(r, 10));
    engine.cancel(cancelledRunId, "owner");
    const [res] = await drained;
    expect(res.phase).toBe("cancelled");
    expect(res.failure).toMatchObject({ kind: "cancel" });
  });

  it("returns results for multiple inputs", async () => {
    const engine = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1 });
    engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    engine.submit({ kind: "b", canonicalInput: "https://b.test/" });
    const results = await engine.drain();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.phase === "succeeded")).toBe(true);
  });

  it("rejects overlapping drain() calls instead of exceeding concurrency", async () => {
    const engine = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1 });
    engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    const first = engine.drain();
    await expect(engine.drain()).rejects.toThrow(/already in progress/);
    const results = await first;
    expect(results).toHaveLength(1);
  });

  it("a run cancelled during a pending transport is not reported as a success", async () => {
    let releaseTransport: (() => void) | undefined;
    const engine = new RunEngine({
      // The transport stays pending until the test releases it, so cancellation
      // definitely lands while the transport is in flight.
      transport: fakeTransport(async () => {
        await new Promise<void>((resolve) => (releaseTransport = resolve));
        return ok;
      }),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 0,
    });
    const h = engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    const drained = engine.drain();
    // Wait until the transport is actually pending.
    await new Promise<void>((r) => {
      const tick = () => (releaseTransport ? r() : setTimeout(tick, 1));
      tick();
    });
    engine.cancel(h.runId, "owner");
    releaseTransport?.();
    const [res] = await drained;
    expect(res.phase).toBe("cancelled");
    expect(res.failure).toMatchObject({ kind: "cancel" });
  });

  it("rejects invalid engine options (NaN, Infinity, negative, non-integer)", () => {
    const badCaps = { ...caps, maxNodes: Number.NaN };
    expect(() => new RunEngine({ transport: fakeTransport(() => ok), caps: badCaps, random: fakeRandom() })).toThrow(RangeError);
    expect(
      () => new RunEngine({ transport: fakeTransport(() => ok), caps: { ...caps, maxRequests: Infinity }, random: fakeRandom() }),
    ).toThrow(RangeError);
    expect(() => new RunEngine({ transport: fakeTransport(() => ok), caps: { ...caps, maxDepth: -1 }, random: fakeRandom() })).toThrow(
      RangeError,
    );
    expect(() => new RunEngine({ transport: fakeTransport(() => ok), caps, concurrency: 2.5, random: fakeRandom() })).toThrow(RangeError);
    expect(() => new RunEngine({ transport: fakeTransport(() => ok), caps, maxRetries: Number.NaN, random: fakeRandom() })).toThrow(
      RangeError,
    );
  });

  it("a transport that IGNORES the abort signal is still cut off by the time budget", async () => {
    const shortTimeCaps = { ...caps, maxElapsedMs: 40 };
    // This transport never resolves and never listens to the abort signal: only the
    // engine's own deadline race can end the run. This proves enforcement does not
    // depend on the transport being cooperative.
    const transport: HttpTransport = {
      async fetch(): Promise<TransportResponse> {
        return new Promise<TransportResponse>(() => {
          /* never resolves, never aborts */
        });
      },
    };
    const engine = new RunEngine({
      transport,
      caps: shortTimeCaps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 0,
    });
    engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    const started = Date.now();
    const [res] = await engine.drain();
    const took = Date.now() - started;
    expect(res.phase).toBe("failed");
    expect(res.failure).toMatchObject({ kind: "budget", refusal: "budget:time" });
    // The run must not hang past the cap by any significant margin.
    expect(took).toBeLessThan(2_000);
  });

  it("cancelling a run with a signal-ignoring transport ends drain() as cancelled, not budget:time", async () => {
    const generousTimeCaps = { ...caps, maxElapsedMs: 30_000 };
    // This transport never resolves and never listens to the abort signal. Cancelling
    // the run must end drain() promptly with a cancelled result — not wait 30s for the
    // time budget — proving the engine's wait ends on cancellation, not just on deadline.
    const transport: HttpTransport = {
      async fetch(): Promise<TransportResponse> {
        return new Promise<TransportResponse>(() => {
          /* never resolves, never aborts */
        });
      },
    };
    const engine = new RunEngine({
      transport,
      caps: generousTimeCaps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 0,
    });
    const h = engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    const drained = engine.drain();
    // Let the worker pick up the run and enter the pending transport.
    await new Promise((r) => setTimeout(r, 10));
    engine.cancel(h.runId, "owner");
    const started = Date.now();
    const [res] = await drained;
    const took = Date.now() - started;
    expect(res.phase).toBe("cancelled");
    expect(res.failure).toMatchObject({ kind: "cancel" });
    // Must end quickly: far short of the 30s time budget.
    expect(took).toBeLessThan(2_000);
  });

  it("a transport that ignores the signal and resolves late is NOT reported as a success", async () => {
    const shortTimeCaps = { ...caps, maxElapsedMs: 40 };
    let resolveLate: (r: TransportResponse) => void = () => {};
    // Resolves long after the deadline has passed, ignoring the abort signal.
    const transport: HttpTransport = {
      async fetch(): Promise<TransportResponse> {
        return new Promise<TransportResponse>((resolve) => {
          resolveLate = resolve;
        });
      },
    };
    const engine = new RunEngine({
      transport,
      caps: shortTimeCaps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 0,
    });
    engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    const drained = engine.drain();
    // Let the deadline pass, then have the stubborn transport resolve anyway.
    await new Promise((r) => setTimeout(r, 80));
    resolveLate(ok);
    const [res] = await drained;
    expect(res.phase).toBe("failed");
    expect(res.failure).toMatchObject({ kind: "budget", refusal: "budget:time" });
  });

  it("a backoff wait that IGNORES the abort signal is still cut off by cancellation", async () => {
    const generousTimeCaps = { ...caps, maxElapsedMs: 30_000 };
    let retryCount = 0;
    // The transport always fails with a retryable error, forcing the engine into
    // backoff; the injected sleep never resolves and never listens to the abort
    // signal. Cancelling the run must end drain() promptly as cancelled, not by
    // waiting out the 30s time budget.
    const engine = new RunEngine({
      transport: fakeTransport(() => {
        retryCount++;
        return new TransportError("transport:http-error", "HTTP 503", { retryable: true });
      }),
      caps: generousTimeCaps,
      random: fakeRandom(),
      retryBaseMs: 10_000,
      maxRetries: 5,
      sleep: () =>
        new Promise<void>(() => {
          /* never resolves, never aborts */
        }),
    });
    const h = engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    const drained = engine.drain();
    // Let the worker issue the first attempt and enter the stubborn backoff.
    await new Promise((r) => setTimeout(r, 20));
    expect(retryCount).toBeGreaterThanOrEqual(1);
    engine.cancel(h.runId, "owner");
    const started = Date.now();
    const [res] = await drained;
    const took = Date.now() - started;
    expect(res.phase).toBe("cancelled");
    expect(res.failure).toMatchObject({ kind: "cancel" });
    // Must end quickly: far short of the 30s time budget.
    expect(took).toBeLessThan(2_000);
  });

  it("a backoff wait that IGNORES the abort signal is still cut off by the time budget", async () => {
    const shortTimeCaps = { ...caps, maxElapsedMs: 40 };
    const engine = new RunEngine({
      transport: fakeTransport(() => new TransportError("transport:http-error", "HTTP 503", { retryable: true })),
      caps: shortTimeCaps,
      random: fakeRandom(),
      retryBaseMs: 10_000,
      maxRetries: 5,
      sleep: () =>
        new Promise<void>(() => {
          /* never resolves, never aborts */
        }),
    });
    engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    const started = Date.now();
    const [res] = await engine.drain();
    const took = Date.now() - started;
    expect(res.phase).toBe("failed");
    expect(res.failure).toMatchObject({ kind: "budget", refusal: "budget:time" });
    expect(took).toBeLessThan(2_000);
  });

  it("a run already cancelled before drain with a signal-ignoring transport: still cancelled, zero attempts", async () => {
    // The token is cancelled BEFORE drain() begins. The engine must never issue a
    // transport attempt for this run even if the transport ignores abort signals.
    // P3-011: the cancellation is recorded immediately (no worker involved), so a
    // drain neither hangs on the never-resolving transport nor re-executes the run.
    const transport: HttpTransport = {
      async fetch(): Promise<TransportResponse> {
        return new Promise<TransportResponse>(() => {
          /* never resolves, never aborts */
        });
      },
    };
    const engine = new RunEngine({
      transport,
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 0,
    });
    const h = engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    engine.cancel(h.runId, "owner");
    const res = engine.result(h.runId);
    expect(res?.phase).toBe("cancelled");
    expect(res?.transportAttempts).toBe(0);
    expect(res?.failure).toMatchObject({ kind: "cancel" });
    expect(await engine.drain()).toEqual([]);
  });

  it("cancellation arriving synchronously inside sleep hits pre-aborted signals: user reason preserved verbatim, no budget wait", async () => {
    // The sleep implementation cancels the run SYNCHRONOUSLY (inside the sleep
    // callback, before returning a never-resolving promise). At that point
    // raceWithDeadline is entered with a signal that is ALREADY aborted, and a
    // brand-new "abort" listener never fires. The engine must not hang on that
    // promise, and the cancellation reason the user passed must appear verbatim
    // in the result, never replaced by a generic cause nor waited out behind the
    // 30s time budget.
    const generousTimeCaps = { ...caps, maxElapsedMs: 30_000 };
    let reasonSeen = "";
    const engine = new RunEngine({
      transport: fakeTransport(() => new TransportError("transport:http-error", "HTTP 503", { retryable: true })),
      caps: generousTimeCaps,
      random: fakeRandom(),
      retryBaseMs: 10_000,
      maxRetries: 5,
      sleep: (_ms: number, _signal?: AbortSignal) => {
        // `sleep` runs BEFORE raceWithDeadline is entered (its result is an
        // argument to it), so cancelling here means the cancellation signal is
        // ALREADY aborted by the time raceWithDeadline runs; a new listener
        // would never fire. The pending promise is returned never-resolving.
        const cancelledNow = engine.cancel(h.runId, "reason-xyz");
        reasonSeen = cancelledNow ? "cancelled-in-sleep" : "cancel-returned-false";
        return new Promise<void>(() => {
          /* never resolves, never aborts */
        });
      },
    });
    const h = engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    // engine.cancel(runId, reason) — the run id is the FIRST argument. The
    // cancellation itself happens synchronously inside the sleep callback below.
    const started = Date.now();
    const [res] = await engine.drain();
    const took = Date.now() - started;
    expect(res.runId).toBe(h.runId);
    expect(res.phase).toBe("cancelled");
    expect(reasonSeen).toBe("cancelled-in-sleep");
    expect(res.failure).toMatchObject({ kind: "cancel" });
    expect(res.failure).toEqual({ kind: "cancel", reason: "reason-xyz" });
    expect(took).toBeLessThan(2_000);
  });

  it("when BOTH the cancellation and the deadline signals are already aborted, cancellation wins over budget:time", async () => {
    // Both signals abort BEFORE raceWithDeadline is entered: the run is
    // cancelled synchronously inside sleep, and the deadline signal is a
    // controllable controller.abort() (simulating an already-fired
    // AbortSignal.timeout). The fixed eager order (cancel checked before
    // deadline) must surface the user's cancellation, not budget:time, and a
    // settled/rejected pending promise must not beat it either.
    let h!: { runId: string };
    const deadlineController = new AbortController();
    const realTimeout = AbortSignal.timeout;
    // Replace AbortSignal.timeout with a controllable stub for this test only.
    AbortSignal.timeout = (_ms: number) => deadlineController.signal;
    try {
      const engine0 = new RunEngine({
        transport: fakeTransport(() => new TransportError("transport:http-error", "HTTP 503", { retryable: true })),
        caps: { ...caps, maxElapsedMs: 30_000 },
        random: fakeRandom(),
        retryBaseMs: 10_000,
        maxRetries: 5,
        sleep: (_ms: number, _signal?: AbortSignal) => {
          // Abort the DEADLINE signal first, then cancel the run: by the time
          // raceWithDeadline runs, both signals are aborted.
          deadlineController.abort(new Error("deadline fired"));
          const ok = engine0.cancel(h.runId, "both-aborted-cancel");
          expect(ok).toBe(true);
          return new Promise<void>(() => {
            /* never resolves */
          });
        },
      });
      h = engine0.submit({ kind: "a", canonicalInput: "https://a.test/" });
      const started = Date.now();
      const [res] = await engine0.drain();
      const took = Date.now() - started;
      expect(res.runId).toBe(h.runId);
      expect(res.phase).toBe("cancelled");
      // Cancellation wins; the reason is the user's, not budget:time.
      expect(res.failure).toEqual({ kind: "cancel", reason: "both-aborted-cancel" });
      // Ends immediately: no 30s budget wait.
      expect(took).toBeLessThan(2_000);
    } finally {
      AbortSignal.timeout = realTimeout;
    }
  });

  it("drain() is not additive: a second call does not re-execute finished runs", async () => {
    const engine = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1 });
    const h = engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    const first = await engine.drain();
    const second = await engine.drain();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(engine.result(h.runId)?.phase).toBe("succeeded");
  });

  it("onPhaseChange observes the queued→running→succeeded transitions (P2-019 SSE)", async () => {
    const engine = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1 });
    const events: string[] = [];
    const off = engine.onPhaseChange((e) => events.push(`${e.phase}`));
    const h = engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    await engine.drain();
    off();
    expect(events).toEqual(["running", "succeeded"]);
    expect(engine.result(h.runId)?.phase).toBe("succeeded");
  });

  it("onPhaseChange reports cancelled for a run cancelled while queued (P2-019 SSE, P3-011: no running event)", async () => {
    const engine = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1 });
    const events: string[] = [];
    engine.onPhaseChange((e) => events.push(`${e.phase}`));
    const h = engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    h.cancel("user");
    // The run never started, so its only phase transition is the immediate
    // cancellation (P3-011) — there is no "running" event to report.
    expect(events).toEqual(["cancelled"]);
    expect(engine.result(h.runId)?.phase).toBe("cancelled");
  });
});

describe("RunEngine cancel-while-queued (P3-011)", () => {
  it("a queued run's cancellation is fail-closed: a throwing queue-store save mutates NOTHING — the run stays fully queued (token untouched) and later succeeds", () => {
    let failSave = false;
    const queueStore: RunQueueStore = {
      load: () => [],
      save: (_runs) => {
        if (failSave) throw new Error("disk full");
      },
    };
    const engine = new RunEngine({
      transport: fakeTransport(() => ok),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      queueStore,
    });
    const handle = engine.submit({ kind: "domain", canonicalInput: "https://c.test/x" });
    // The shrink-persist fails: cancel() must propagate the failure with nothing mutated.
    failSave = true;
    expect(() => engine.cancel(handle.runId)).toThrow("disk full");
    expect(engine.phaseOf(handle.runId)).toBe("queued");
    expect(engine.result(handle.runId)).toBeUndefined();
    // The run's cancellation token must be untouched by the failed cancel: the run
    // still executes normally once the store works again (not a zombie cancelled run).
    failSave = false;
    const drainPromise = engine.drain();
    return drainPromise.then(([result]) => {
      expect(result.phase).toBe("succeeded");
      expect(engine.phaseOf(handle.runId)).toBe("succeeded");
    });
  });

  it("transitions a queued run to cancelled immediately while every worker is busy — it never waits for a worker", async () => {
    // A transport that hangs per request until released: the two workers saturate.
    const started: string[] = [];
    let release!: () => void;
    const releasePromise = new Promise<void>((r) => (release = r));
    const transport: HttpTransport = {
      async fetch(req: TransportRequest, _signal: AbortSignal): Promise<TransportResponse> {
        started.push(req.url);
        await releasePromise;
        return ok;
      },
    };
    const engine = new RunEngine({
      transport,
      caps,
      concurrency: 2,
      random: fakeRandom(),
      retryBaseMs: 1,
    });
    const a = engine.submit({ kind: "domain", canonicalInput: "https://a.test/x" });
    const b = engine.submit({ kind: "domain", canonicalInput: "https://b.test/x" });
    const drainPromise = engine.drain();
    // Deterministic gate: both workers are inside the transport before the queued run exists.
    await new Promise<void>((resolve) => {
      const check = () => (started.length >= 2 ? resolve() : queueMicrotask(check));
      check();
    });
    const queued = engine.submit({ kind: "domain", canonicalInput: "https://c.test/x" });
    const events: string[] = [];
    engine.onPhaseChange((e) => {
      if (e.runId === queued.runId) events.push(e.phase);
    });
    expect(engine.cancel(queued.runId)).toBe(true);
    // P3-011 acceptance ("الإلغاء خلال ثانية"): the cancellation is visible immediately —
    // the queued run must NOT wait for a busy worker to pop it. Zero transport attempts.
    const result = engine.result(queued.runId);
    expect(result?.phase).toBe("cancelled");
    expect(result?.transportAttempts).toBe(0);
    expect(result?.failure).toMatchObject({ kind: "cancel" });
    expect(events).toEqual(["cancelled"]);
    // Release the workers: the cancelled run is never executed, the busy ones succeed.
    release();
    await drainPromise;
    expect(started).toEqual(["https://a.test/x", "https://b.test/x"]);
    expect(engine.result(a.runId)?.phase).toBe("succeeded");
    expect(engine.result(b.runId)?.phase).toBe("succeeded");
  });
});

describe("RunEngine retry classification (P2-025)", () => {
  it("respects a numeric Retry-After header for 429 instead of the exponential backoff", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const engine = new RunEngine({
      transport: fakeTransport(() => {
        calls++;
        if (calls === 1) return { status: 429, body: "", headers: { "retry-after": "2" } } as TransportResponse;
        return ok;
      }),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1000, // would be 1000ms on attempt 1; Retry-After 2s must win
      maxRetries: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    engine.submit({ kind: "domain", canonicalInput: "https://example.test/x" });
    const [res] = await engine.drain();
    expect(res.phase).toBe("succeeded");
    expect(sleeps).toEqual([2000]);
  });

  it("respects an HTTP-date Retry-After header", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const future = new Date(Date.now() + 1500).toUTCString();
    const engine = new RunEngine({
      transport: fakeTransport(() => {
        calls++;
        if (calls === 1) return { status: 429, body: "", headers: { "retry-after": future } } as TransportResponse;
        return ok;
      }),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1000,
      maxRetries: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    engine.submit({ kind: "domain", canonicalInput: "https://example.test/x" });
    const [res] = await engine.drain();
    expect(res.phase).toBe("succeeded");
    expect(sleeps[0]).toBeGreaterThan(0);
    expect(sleeps[0]).toBeLessThanOrEqual(1500);
  });

  it("falls back to exponential backoff when Retry-After is absent", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const engine = new RunEngine({
      transport: fakeTransport(() => {
        calls++;
        if (calls === 1) return { status: 503, body: "" } as TransportResponse;
        return ok;
      }),
      caps,
      random: fakeRandom(),
      retryBaseMs: 10,
      maxRetries: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    engine.submit({ kind: "domain", canonicalInput: "https://example.test/x" });
    const [res] = await engine.drain();
    expect(res.phase).toBe("succeeded");
    expect(sleeps).toEqual([20]); // 10 * 2^1 (attempt already incremented)
  });

  it("does not retry permanent 4xx responses (auth, not-found): returned as-is, one call", async () => {
    let calls = 0;
    const engine = new RunEngine({
      transport: fakeTransport(() => {
        calls++;
        return { status: 401, body: "" } as TransportResponse;
      }),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 3,
    });
    engine.submit({ kind: "domain", canonicalInput: "https://example.test/x" });
    const [res] = await engine.drain();
    // A 4xx is a valid HTTP response for the engine (the transform interprets it);
    // it is never retried and never treated as a transport failure.
    expect(res.phase).toBe("succeeded");
    expect(calls).toBe(1);
  });

  it("does not retry a non-retryable TransportError (dns)", async () => {
    let calls = 0;
    const engine = new RunEngine({
      transport: fakeTransport(() => {
        calls++;
        return new TransportError("transport:dns", "nx");
      }),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 3,
    });
    engine.submit({ kind: "domain", canonicalInput: "https://nx.test/" });
    const [res] = await engine.drain();
    expect(res.phase).toBe("failed");
    expect(calls).toBe(1);
  });
});

describe("RunEngine restart (P2-025)", () => {
  it("restarts a failed run as a NEW run with the same input and a fresh budget", async () => {
    let calls = 0;
    const engine = new RunEngine({
      transport: fakeTransport(() => {
        calls++;
        if (calls === 1) return { status: 500, body: "" } as TransportResponse;
        return ok;
      }),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      maxRetries: 0,
    });
    const h = engine.submit({ kind: "domain", canonicalInput: "https://example.test/x" });
    const [first] = await engine.drain();
    expect(first.phase).toBe("failed");
    const restarted = engine.restart(h.runId);
    expect(restarted).toBeDefined();
    const restartedId = restarted?.runId ?? "";
    expect(restartedId).not.toBe(h.runId);
    const [second] = await engine.drain();
    expect(second.phase).toBe("succeeded");
    expect(second.runId).toBe(restartedId);
    // The original run's result is preserved.
    expect(engine.result(h.runId)?.phase).toBe("failed");
  });

  it("returns undefined for an unknown or non-failed run", async () => {
    const engine = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1 });
    expect(engine.restart("run-nope")).toBeUndefined();
    const h = engine.submit({ kind: "domain", canonicalInput: "https://example.test/x" });
    await engine.drain();
    expect(engine.restart(h.runId)).toBeUndefined(); // succeeded, not failed
  });
});
