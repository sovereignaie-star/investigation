import { describe, expect, it } from "vitest";
import { RunEngine, type PersistedRun, type RunInput, type RunQueueStore } from "./run.ts";
import { TransportError, type HttpTransport, type TransportRequest, type TransportResponse } from "./transport.ts";

/**
 * T-ENG-012 / NFR-07 (ROADMAP section 9): "resume after a process restart resumes from
 * the saved queue". The engine accepts an injectable queue store; a NEW engine instance
 * constructed over the same store resumes the persisted pending runs with their original
 * runIds, priorities and FIFO order. A process restart is simulated by constructing a
 * fresh engine over the store the previous instance left behind.
 *
 * Semantics implemented and asserted here:
 * - submit() persists BEFORE mutating engine state (fail-closed: a submit that cannot be
 *   persisted is refused, nothing is queued in memory);
 * - a pop persists the shrink (a crash between pop and persist can only cause REPLAY,
 *   never loss — resume is at-least-once, asserted below);
 * - load() failures and malformed persisted entries abort construction (fail-closed);
 * - persisted runs are re-admitted through the natural-person gate (E-02/P2-013): a
 *   natural-person run does not resume without a purpose confirmation.
 */

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
): HttpTransport & { calls: number; urls: string[] } {
  const t = {
    calls: 0,
    urls: [] as string[],
    async fetch(req: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
      t.calls++;
      t.urls.push(req.url);
      if (signal.aborted) throw new TransportError("transport:network", "aborted");
      const out = await behavior(req, signal);
      if (out instanceof TransportError) throw out;
      return out;
    },
  };
  return t;
}

const ok: TransportResponse = { status: 200, body: "ok" };

/** In-memory store shared across engine instances: simulates the persisted queue. */
function memoryStore() {
  let pending: PersistedRun[] = [];
  const clone = (runs: readonly PersistedRun[]): PersistedRun[] => runs.map((r) => ({ runId: r.runId, input: { ...r.input } }));
  const store: RunQueueStore = {
    save(runs) {
      pending = clone(runs);
    },
    load() {
      return clone(pending);
    },
  };
  return {
    store,
    /** The persisted list as the last save() left it. */
    saved: (): readonly PersistedRun[] => pending.map((r) => ({ runId: r.runId, input: { ...r.input } })),
    /** Force the persisted list (test control, e.g. to simulate a crash before a shrink was persisted). */
    force: (runs: readonly PersistedRun[]) => {
      pending = clone(runs);
    },
  };
}

const input = (canonicalInput: string, priority?: number): RunInput => ({
  kind: "domain",
  canonicalInput,
  priority,
});

describe("RunEngine queue persistence (T-ENG-012 / NFR-07)", () => {
  it("resumes the persisted queue after a restart: same runIds, priority order and FIFO preserved", async () => {
    const m = memoryStore();
    // Engine A (the "old process"): three runs submitted, never drained, then it dies.
    const a = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1, queueStore: m.store });
    const low1 = a.submit(input("https://low1.test/x", 5));
    const high = a.submit(input("https://high.test/x", 0));
    const low2 = a.submit(input("https://low2.test/x", 5));

    // The persisted list is written on submit, in pop order (priority asc, then FIFO).
    expect(m.saved().map((r) => r.runId)).toEqual([high.runId, low1.runId, low2.runId]);

    // Engine B (the "restarted process"): fresh transport, same persisted store.
    const transport = fakeTransport(() => ok);
    const b = new RunEngine({ transport, caps, random: fakeRandom(), retryBaseMs: 1, queueStore: m.store });
    expect(b.has(high.runId)).toBe(true);
    expect(b.has(low1.runId)).toBe(true);
    expect(b.has(low2.runId)).toBe(true);

    const results = await b.drain();
    expect(results.map((r) => r.phase)).toEqual(["succeeded", "succeeded", "succeeded"]);
    // Same runIds as the original handles: the caller's references survive the restart.
    expect(results.map((r) => r.runId)).toEqual([high.runId, low1.runId, low2.runId]);
    // Execution order follows the persisted queue: priority first, FIFO within equal priority.
    expect(transport.urls).toEqual(["https://high.test/x", "https://low1.test/x", "https://low2.test/x"]);
    // The drained queue is persisted as empty.
    expect(m.saved()).toEqual([]);
  });

  it("persists BEFORE mutating engine state: a submit that cannot be saved is refused (fail-closed)", async () => {
    const failing: RunQueueStore = {
      save: () => {
        throw new Error("disk full");
      },
      load: () => [],
    };
    const engine = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1, queueStore: failing });
    expect(() => engine.submit(input("https://example.test/x"))).toThrow("disk full");
    // Nothing was queued in memory: the engine state is unchanged.
    expect(await engine.drain()).toEqual([]);
  });

  it("aborts construction when the store cannot be loaded (fail-closed)", () => {
    const failing: RunQueueStore = {
      save: () => undefined,
      load: () => {
        throw new Error("corrupt store");
      },
    };
    expect(
      () =>
        new RunEngine({
          transport: fakeTransport(() => ok),
          caps,
          random: fakeRandom(),
          retryBaseMs: 1,
          queueStore: failing,
        }),
    ).toThrow("corrupt store");
  });

  it("rejects malformed persisted entries: missing fields and duplicate runIds", () => {
    const badKind: RunQueueStore = {
      save: () => undefined,
      load: () => [{ runId: "run-x", input: { kind: "", canonicalInput: "https://example.test/x" } }],
    };
    expect(
      () => new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1, queueStore: badKind }),
    ).toThrow(RangeError);

    const dup: RunQueueStore = {
      save: () => undefined,
      load: () => [
        { runId: "run-dup", input: { kind: "domain", canonicalInput: "https://a.test/x" } },
        { runId: "run-dup", input: { kind: "domain", canonicalInput: "https://b.test/x" } },
      ],
    };
    expect(
      () => new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1, queueStore: dup }),
    ).toThrow(RangeError);
  });

  it("resume is at-least-once: a run still in the persisted store replays even if another engine already drained it", async () => {
    const m = memoryStore();
    const run: PersistedRun = { runId: "run-0001-abcabc", input: input("https://example.test/x") };
    // Simulate the persisted state a crash mid-drain can leave behind: the run was popped
    // but the shrink was never persisted.
    m.force([run]);

    const first = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1, queueStore: m.store });
    const drained = await first.drain();
    expect(drained.map((r) => r.phase)).toEqual(["succeeded"]);

    // The same persisted state reloaded after the crash: the run executes AGAIN.
    // Replaying is safe (no loss); the alternative — dropping it — would lose work.
    m.force([run]);
    const second = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1, queueStore: m.store });
    const replayed = await second.drain();
    expect(replayed.map((r) => r.runId)).toEqual([run.runId]);
    expect(replayed.map((r) => r.phase)).toEqual(["succeeded"]);
  });

  it("re-gates a persisted natural-person run on resume (E-02): refused without a confirmation, resumed with one", async () => {
    const m = memoryStore();
    m.force([{ runId: "run-0009-gated", input: { kind: "person_name", canonicalInput: "Bob", sensitivity: "natural_person_gate" } }]);

    const refused = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1, queueStore: m.store });
    await refused.drain();
    // A refusal is recorded, not queued — visible via result(), like a submit-time refusal.
    const refusal = refused.result("run-0009-gated");
    expect(refusal?.phase).toBe("failed");
    expect(refusal?.transportAttempts).toBe(0);
    expect(refusal?.failure?.kind).toBe("transform");

    m.force([{ runId: "run-0009-gated", input: { kind: "person_name", canonicalInput: "Bob", sensitivity: "natural_person_gate" } }]);
    const confirmed = new RunEngine({
      transport: fakeTransport(() => ok),
      caps,
      random: fakeRandom(),
      retryBaseMs: 1,
      queueStore: m.store,
      purposeConfirmation: { purpose: "محقق في قضية موثقة الغرض", confirmedBy: "investigator" },
    });
    const [resumed] = await confirmed.drain();
    expect(resumed.phase).toBe("succeeded");
    expect(resumed.runId).toBe("run-0009-gated");
  });

  it("a resumed queued run can still be cancelled before it starts (D-022 holds after a restart)", async () => {
    const m = memoryStore();
    const a = new RunEngine({ transport: fakeTransport(() => ok), caps, random: fakeRandom(), retryBaseMs: 1, queueStore: m.store });
    const h = a.submit(input("https://example.test/x"));

    const transport = fakeTransport(() => ok);
    const b = new RunEngine({ transport, caps, random: fakeRandom(), retryBaseMs: 1, queueStore: m.store });
    expect(b.cancel(h.runId, "operator")).toBe(true);
    const [res] = await b.drain();
    expect(res.phase).toBe("cancelled");
    expect(res.transportAttempts).toBe(0);
    expect(transport.calls).toBe(0);
  });
});
