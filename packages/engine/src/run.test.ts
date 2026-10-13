import { describe, expect, it } from "vitest";
import { RunEngine } from "./run.ts";
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

  it("cancelling a queued run before drain produces cancelled with zero transport attempts (D-022)", async () => {
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
    const [res] = await engine.drain();
    expect(res.phase).toBe("cancelled");
    expect(res.transportAttempts).toBe(0);
    expect(transport.calls).toBe(0);
    expect(res.failure).toMatchObject({ kind: "cancel", reason: "owner" });
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
    const [res] = await engine.drain();
    expect(res.phase).toBe("cancelled");
    expect(res.transportAttempts).toBe(0);
    expect(res.failure).toMatchObject({ kind: "cancel" });
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

  it("onPhaseChange reports cancelled for a run cancelled while queued (P2-019 SSE)", async () => {
    const engine = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1 });
    const events: string[] = [];
    engine.onPhaseChange((e) => events.push(`${e.phase}`));
    const h = engine.submit({ kind: "a", canonicalInput: "https://a.test/" });
    h.cancel("user");
    await engine.drain();
    expect(events).toEqual(["running", "cancelled"]);
  });
});
