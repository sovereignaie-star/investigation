/**
 * Time-based SSRF cases (T-SEC-SSRF-023 total deadline, T-SEC-SSRF-034 connect timeout), P2-003.
 *
 * Each case drives a gateway built by the given factory under vitest fake timers and returns the list of mismatches
 * (empty = the case holds). `ssrf-matrix.test.ts` runs them against the real gateway; `ssrf-mutation.test.ts` runs
 * them against copies with the deadline or the connect timeout removed, and requires a mismatch. A case that never
 * settles is reported as a mismatch ("still pending"), so a removed deadline cannot hang the run.
 *
 * TEST-ONLY module: not exported from `index.ts`, no network code.
 */
import { vi } from "vitest";
import type { EgressResult } from "./egress";
import { BASE_REQUEST, type Factory } from "./ssrf-cases";

export interface TimingCase {
  readonly id: "T-SEC-SSRF-023" | "T-SEC-SSRF-034";
  readonly title: string;
  run(factory: Factory): Promise<string[]>;
}

const PUB = "93.184.216.34";
const resolver = { resolve: async () => [PUB] };

/** Track whether a promise settled, without awaiting it. */
function track(p: Promise<EgressResult>): { settled: () => boolean; value: () => EgressResult | undefined } {
  let done = false;
  let v: EgressResult | undefined;
  void p.then((r) => {
    done = true;
    v = r;
  });
  return { settled: () => done, value: () => v };
}

function expectDenied(r: EgressResult | undefined, reason: string, transportCalls: number): string[] {
  if (r === undefined) return ["still pending: the request was not cut"];
  const out: string[] = [];
  if (r.ok) out.push("ok: expected false, got true");
  if (r.reason !== reason) out.push(`reason: expected ${reason}, got ${r.reason ?? "-"}`);
  if (r.transportCalls !== transportCalls) out.push(`transportCalls: expected ${transportCalls}, got ${r.transportCalls}`);
  return out;
}

async function withFakeTimers(fn: () => Promise<string[]>): Promise<string[]> {
  vi.useFakeTimers();
  try {
    return await fn();
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
}

export const TIMING_CASES: readonly TimingCase[] = [
  {
    id: "T-SEC-SSRF-023",
    title: "a server that trickles past the total deadline is cut at timeoutMs (fake clock) and reported timeout_total",
    run: (factory) =>
      withFakeTimers(async () => {
        const signals: AbortSignal[] = [];
        const g = factory({
          resolver,
          limits: { timeoutMs: 15_000, connectTimeoutMs: 5_000 },
          transport: {
            // redirects keep the request alive hop after hop; each hop takes 4.9 s (under the per-hop limit)
            fetch: (r) =>
              new Promise((resolve) => {
                signals.push(r.signal as AbortSignal);
                setTimeout(() => resolve({ status: 302, headers: { location: `https://example.com/${signals.length}` } }), 4_900);
              }),
          },
        });
        const t = track(g.request({ ...BASE_REQUEST, url: "https://example.com/0" }));
        await vi.advanceTimersByTimeAsync(16_000);
        const out = expectDenied(t.settled() ? t.value() : undefined, "timeout_total", 4);
        // 3 full hops (14.7 s) + the 4th cut by the 15 s deadline
        if (signals.length !== 4) out.push(`hops: expected 4, got ${signals.length}`);
        if (signals[3]?.aborted !== true) out.push("the 4th hop's signal was not aborted at the deadline");
        return out;
      }),
  },
  {
    id: "T-SEC-SSRF-023",
    title: "a resolver that never answers is bounded by the same deadline (no hanging request)",
    run: (factory) =>
      withFakeTimers(async () => {
        let transportCalls = 0;
        const g = factory({
          resolver: { resolve: () => new Promise<string[]>(() => {}) },
          limits: { timeoutMs: 15_000, connectTimeoutMs: 5_000 },
          transport: {
            fetch: async () => {
              transportCalls++;
              return { status: 200 };
            },
          },
        });
        const t = track(g.request({ ...BASE_REQUEST }));
        await vi.advanceTimersByTimeAsync(15_001);
        const out = expectDenied(t.settled() ? t.value() : undefined, "timeout_total", 0);
        if (transportCalls !== 0) out.push(`transport calls: expected 0, got ${transportCalls}`);
        return out;
      }),
  },
  {
    id: "T-SEC-SSRF-034",
    title: "a server that never completes the connection is cut at the 5 s connect timeout (fake clock)",
    run: (factory) =>
      withFakeTimers(async () => {
        let signal: AbortSignal | undefined;
        const g = factory({
          resolver,
          transport: {
            fetch: (r) =>
              new Promise((_resolve, reject) => {
                signal = r.signal;
                r.signal?.addEventListener("abort", () => reject(new Error("connect aborted")));
              }),
          },
        });
        const t = track(g.request({ ...BASE_REQUEST }));
        await vi.advanceTimersByTimeAsync(4_999);
        const out: string[] = [];
        if (signal?.aborted !== false) out.push("the hop was aborted before 5 s");
        await vi.advanceTimersByTimeAsync(2);
        out.push(...expectDenied(t.settled() ? t.value() : undefined, "timeout_connect", 1));
        if (signal?.aborted !== true) out.push("the hop's signal was not aborted at 5 s");
        return out;
      }),
  },
];
