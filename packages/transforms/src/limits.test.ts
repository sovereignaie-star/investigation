/**
 * P2-004 — manifest limits enforcement (rps / timeoutMs / maxBytes).
 *
 * Proves the runner enforces the transform's declared limits at the execution
 * layer, deterministically (injected clock + sleep):
 * - rps: requests beyond the declared rate are throttled (spaced out), and the
 *   bucket refills over time; concurrent runs have independent buckets;
 * - timeoutMs: a request that exceeds the declared per-request timeout fails
 *   with stage "request" and kind "timeout";
 * - maxBytes: a response larger than the declared cap fails with kind
 *   "size_limit" and is never recorded as a success;
 * - a cancel during a rate-limit wait aborts the wait and fails the run.
 */
import { describe, expect, it } from "vitest";
import { defineTransform } from "./manifest.ts";
import { runTransform, TransformRunError } from "./runner.ts";
import type { HttpTransport } from "@ir/engine/transport";

function makeManifest(overrides: Partial<{ rps: number; timeoutMs: number; maxBytes: number }> = {}) {
  return {
    id: "TR-010",
    version: "1.0.0",
    inputs: ["url"],
    outputs: ["http_response"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 2, timeoutMs: 10_000, maxBytes: 1_000_000, ...overrides },
    sensitivity: "normal",
    license: "LC-B",
  };
}

function nRequests(n: number) {
  return defineTransform<{ url: string }>(makeManifest(), async (input, ctx) => {
    for (let i = 0; i < n; i++) {
      await ctx.http.get(input.url);
    }
    return { findings: [] };
  });
}

/**
 * Deterministic clock: `sleep` blocks until the test advances the clock past the
 * requested wait (or the signal aborts). No real timers, no flakiness.
 */
function fakeClock() {
  let t = 0;
  const waits: number[] = [];
  const sleepers: { ms: number; resolve: () => void; reject: (e: unknown) => void; signal: AbortSignal }[] = [];
  const now = () => t;
  const sleep = async (ms: number, signal: AbortSignal) => {
    waits.push(ms);
    await new Promise<void>((resolve, reject) => {
      const entry = { ms, resolve, reject, signal };
      sleepers.push(entry);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const advance = (ms: number) => {
    t += ms;
    for (const s of sleepers.splice(0)) {
      if (s.ms <= ms) s.resolve();
      else sleepers.push(s);
    }
  };
  return { now, sleep, waits, advance };
}

describe("manifest.limits.rps enforcement", () => {
  it("throttles requests beyond the declared rate (spaces them out)", async () => {
    const clock = fakeClock();
    let calls = 0;
    const transport: HttpTransport = {
      async fetch() {
        calls++;
        return { status: 200, body: "" };
      },
    };
    // rps=2: the first two requests are immediate, the third waits ~500ms.
    const pending = runTransform(nRequests(3), { transport, input: { url: "https://example.com/" }, now: clock.now, sleep: clock.sleep });
    await new Promise((r) => setTimeout(r, 10)); // let the first two requests land
    expect(calls).toBe(2);
    clock.advance(500); // cover the third request's wait
    const result = await pending;
    expect(calls).toBe(3);
    expect(clock.waits).toEqual([500]);
    expect(result.requestCount).toBe(3);
  });

  it("the bucket refills over time (a later request is not throttled after a pause)", async () => {
    const clock = fakeClock();
    let calls = 0;
    const transport: HttpTransport = {
      async fetch() {
        calls++;
        return { status: 200, body: "" };
      },
    };
    const def = defineTransform<{ url: string }>(makeManifest({ rps: 1 }), async (input, ctx) => {
      await ctx.http.get(input.url);
      clock.advance(1500); // more than 1s passes
      await ctx.http.get(input.url);
      return { findings: [] };
    });
    const result = await runTransform(def, { transport, input: { url: "https://example.com/" }, now: clock.now, sleep: clock.sleep });
    expect(calls).toBe(2);
    expect(clock.waits).toHaveLength(0); // the refill covered the second request
    expect(result.requestCount).toBe(2);
  });

  it("concurrent runs have independent buckets (no cross-run stealing)", async () => {
    const clock = fakeClock();
    let calls = 0;
    const transport: HttpTransport = {
      async fetch() {
        calls++;
        return { status: 200, body: "" };
      },
    };
    const def = nRequests(2);
    const [a, b] = await Promise.all([
      runTransform(def, { transport, input: { url: "https://example.com/" }, now: clock.now, sleep: clock.sleep }),
      runTransform(def, { transport, input: { url: "https://example.com/" }, now: clock.now, sleep: clock.sleep }),
    ]);
    expect(a.requestCount).toBe(2);
    expect(b.requestCount).toBe(2);
    expect(calls).toBe(4);
  });

  it("a cancel during a rate-limit wait aborts the wait and fails the run as cancelled", async () => {
    const clock = fakeClock();
    const transport: HttpTransport = {
      async fetch() {
        return { status: 200, body: "" };
      },
    };
    const controller = new AbortController();
    const def = defineTransform<{ url: string }>(makeManifest({ rps: 1 }), async (input, ctx) => {
      await ctx.http.get(input.url);
      await ctx.http.get(input.url); // second request must wait ~1s
      return { findings: [] };
    });
    const pending = runTransform(def, {
      transport,
      input: { url: "https://example.com/" },
      now: clock.now,
      sleep: clock.sleep,
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 10)); // let the first request land and the second start waiting
    expect(clock.waits.length).toBeGreaterThanOrEqual(1);
    controller.abort(new Error("stop"));
    const err = await pending.catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("cancel");
  });
});

describe("manifest.limits.timeoutMs and maxBytes", () => {
  it("a request exceeding the declared timeout fails with kind timeout", async () => {
    const transport: HttpTransport = {
      async fetch(_req, signal) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
        return { status: 200, body: "" };
      },
    };
    const def = defineTransform<{ url: string }>(makeManifest({ timeoutMs: 50 }), async (input, ctx) => {
      await ctx.http.get(input.url);
      return { findings: [] };
    });
    const err = await runTransform(def, { transport, input: { url: "https://example.com/" } }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("request");
    expect(err.evidence[0].error?.kind).toBe("timeout");
  });

  it("a response larger than maxBytes fails with kind size_limit and is not a success", async () => {
    const transport: HttpTransport = {
      async fetch() {
        return { status: 200, body: "x".repeat(1000) };
      },
    };
    const def = defineTransform<{ url: string }>(makeManifest({ maxBytes: 100 }), async (input, ctx) => {
      await ctx.http.get(input.url);
      return { findings: [] };
    });
    const err = await runTransform(def, { transport, input: { url: "https://example.com/" } }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("request");
    expect(err.evidence[0].error?.kind).toBe("size_limit");
    expect(err.evidence[0].status).toBeUndefined();
  });
});
