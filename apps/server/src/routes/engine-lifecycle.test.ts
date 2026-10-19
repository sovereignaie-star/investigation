import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  RunEngine,
  type HttpTransport,
  type PersistedRun,
  type RunQueueStore,
  type TransportRequest,
  type TransportResponse,
} from "@ir/engine";
import { createApp } from "../app";
import { engineRouter } from "./engine";

/**
 * P3-011 (تقدم التشغيل الحي): the run lifecycle over the real routes — the route
 * itself must move a submitted run to a terminal phase (nothing in production
 * called engine.drain() before this task), the SSE stream must be isolated per
 * run and carry a snapshot for late subscribers, and a queued run must cancel
 * within a second even while every worker is busy.
 *
 * The transports are deterministic gates (no sleeps drive the assertions):
 * a hanging transport resolves only when released, and every wait is anchored on
 * a real signal (a started transport call, an emitted phase) instead of time.
 */

const ADMIN_TOKEN = "admin-token-123";
const ENABLED = { IR_ADMIN_TOKEN: ADMIN_TOKEN };

const CAPS = { maxNodes: 5, maxDepth: 3, maxRequests: 5, maxCostEstimate: 100, maxElapsedMs: 5_000 };

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

function withAdmin(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  return { ...init, headers };
}

/**
 * A deterministic gated transport: every call is recorded; calls whose URL matches
 * `hang` park until release() is called. `whenCallsStarted(n)` resolves once n
 * calls have started — the tests' deterministic anchor instead of timers.
 */
function gatedTransport(hang: (url: string) => boolean) {
  const started: string[] = [];
  const startWaiters: Array<(count: number) => void> = [];
  let release!: () => void;
  const releasePromise = new Promise<void>((r) => (release = r));
  const transport: HttpTransport = {
    async fetch(req: TransportRequest, _signal: AbortSignal): Promise<TransportResponse> {
      started.push(req.url);
      for (const w of startWaiters.splice(0)) w(started.length);
      if (hang(req.url)) await releasePromise;
      return { status: 200, body: "ok" };
    },
  };
  return {
    transport,
    started: () => [...started],
    whenCallsStarted: (n: number) =>
      n <= started.length
        ? Promise.resolve()
        : new Promise<void>((resolve) =>
            startWaiters.push((count) => {
              if (count >= n) resolve();
            }),
          ),
    release,
  };
}

/** Rejects after `ms` — every open-ended wait in these tests must be bounded. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms)),
  ]);
}

async function startWith(engine: RunEngine) {
  const app = createApp(engineRouter(() => engine, { env: ENABLED }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(base + p, init);
    const text = await res.text();
    return { status: res.status, text };
  };
  return { call, base };
}

async function submitRun(
  call: (p: string, init?: RequestInit) => Promise<{ status: number; text: string }>,
  input: { kind?: string; canonicalInput?: string },
): Promise<string> {
  const res = await call(
    "/runs",
    withAdmin({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: input.kind ?? "lookup",
        canonicalInput: input.canonicalInput ?? "https://example.com/a",
      }),
    }),
  );
  expect(res.status).toBe(202);
  return (JSON.parse(res.text) as { runId: string }).runId;
}

/**
 * Polls GET /runs/:id until the phase is terminal (or the deadline passes — every
 * real wait stays bounded). Returns the last observation, terminal or not.
 */
async function pollTerminal(
  call: (p: string, init?: RequestInit) => Promise<{ status: number; text: string }>,
  runId: string,
  timeoutMs: number,
): Promise<{ status: number; phase: string | null }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await call(`/runs/${runId}`, withAdmin());
    const body = res.status === 200 ? (JSON.parse(res.text) as { phase: string }) : null;
    if (body && body.phase !== "queued") return { status: res.status, phase: body.phase };
    if (Date.now() >= deadline) return { status: res.status, phase: body ? body.phase : null };
    // 50ms cadence: the route's rate limiter allows 60 requests/min — the poller
    // must stay well under it so a red failure is never a 429.
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Reads an SSE stream: `open` awaits the connection (the listener is live); the body is drained by the caller. */
async function openStream(base: string, runId: string): Promise<Response> {
  return await fetch(`${base}/runs/${runId}/events`, withAdmin({ signal: AbortSignal.timeout(4000) }));
}

describe("engine run lifecycle (P3-011)", () => {
  it("executes a submitted run without any manual drain — the route schedules it", async () => {
    const { transport } = gatedTransport(() => false);
    const engine = new RunEngine({ transport, caps: CAPS, retryBaseMs: 1 });
    const { call } = await startWith(engine);
    const runId = await submitRun(call, {});
    const { status, phase } = await pollTerminal(call, runId, 2000);
    expect(status).toBe(200);
    expect(phase).toBe("succeeded");
  });

  it("a run's event stream carries only that run's phases and is not closed by another run's terminal phase", async () => {
    const { transport, release } = gatedTransport((url) => url.includes("a.test"));
    const engine = new RunEngine({ transport, caps: CAPS, retryBaseMs: 1 });
    const { call, base } = await startWith(engine);
    const a = await submitRun(call, { canonicalInput: "https://a.test/x" });
    const b = await submitRun(call, { canonicalInput: "https://b.test/x" });
    // Open BOTH streams before releasing: a is running (hanging transport, its
    // drain is busy) and b is queued behind it — the exact moment the isolation
    // rule must hold. Awaiting the fetch means the route already wrote its
    // snapshot and registered its listener.
    const aRes = await openStream(base, a);
    const bRes = await openStream(base, b);
    release();
    const [aText, bText] = await Promise.all([aRes.text(), bRes.text()]);
    expect(aText).toContain('"phase":"running"');
    expect(aText).toContain('"phase":"succeeded"');
    expect(aText).not.toContain(b);
    expect(bText).toContain('"phase":"queued"');
    expect(bText).toContain('"phase":"running"');
    expect(bText).toContain('"phase":"succeeded"');
    expect(bText).not.toContain(a);
  });

  it("a stream opened after the run started delivers the current phase first (late subscriber snapshot)", async () => {
    const { transport, release, whenCallsStarted } = gatedTransport(() => true);
    const engine = new RunEngine({ transport, caps: CAPS, retryBaseMs: 1 });
    const { call, base } = await startWith(engine);
    const runId = await submitRun(call, {});
    // The run is inside the transport — running — BEFORE the stream is opened.
    // The transport start is the deterministic anchor (the phase was set to running
    // before the fetch began), with no dependency on catching the event live.
    await withTimeout(whenCallsStarted(1), 2000, "first transport call");
    const res = await fetch(`${base}/runs/${runId}/events`, withAdmin({ signal: AbortSignal.timeout(4000) }));
    expect(res.status).toBe(200);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no stream body");
    const decoder = new TextDecoder();
    const first = await withTimeout(reader.read(), 2000, "first stream chunk");
    expect(first.done).toBe(false);
    expect(decoder.decode(first.value)).toContain('"phase":"running"');
    release();
    let rest = "";
    for (;;) {
      const chunk = await withTimeout(reader.read(), 2000, "stream end");
      if (chunk.done) break;
      rest += decoder.decode(chunk.value);
    }
    expect(rest).toContain('"phase":"succeeded"');
  });

  it("cancels a queued run within a second while the engine's drain is busy — it is never executed", async () => {
    // One hanging run keeps the active drain busy (its workers are inside the
    // transport); a second submission therefore stays QUEUED — the exact state
    // whose cancellation must not wait for any worker. Full worker saturation
    // (concurrency 4) is covered deterministically at the engine level.
    const { transport, started, release, whenCallsStarted } = gatedTransport((url) => url.includes("busy.test"));
    const engine = new RunEngine({ transport, caps: CAPS, retryBaseMs: 1 });
    const { call } = await startWith(engine);
    const busy = await submitRun(call, { canonicalInput: "https://busy.test/x" });
    // The busy run is inside the transport before the queued run is submitted.
    await withTimeout(whenCallsStarted(1), 2000, "busy run started");
    const queued = await submitRun(call, { canonicalInput: "https://queued.test/x" });
    const startedAt = Date.now();
    const del = await call(`/runs/${queued}`, withAdmin({ method: "DELETE" }));
    expect(del.status).toBe(202);
    const { status, phase } = await pollTerminal(call, queued, 1000);
    expect(status).toBe(200);
    expect(phase).toBe("cancelled");
    expect(Date.now() - startedAt).toBeLessThan(1000);
    release();
    // The cancelled run never reached the transport — only the busy run did.
    expect(started()).toEqual(["https://busy.test/x"]);
    const { phase: busyPhase } = await pollTerminal(call, busy, 2000);
    expect(busyPhase).toBe("succeeded");
  });

  it("a run submitted while a drain is already running still executes (serial drain scheduling)", async () => {
    const { transport, release, whenCallsStarted } = gatedTransport((url) => url.includes("a.test"));
    const engine = new RunEngine({ transport, caps: CAPS, retryBaseMs: 1 });
    const { call } = await startWith(engine);
    const busyRunId = await submitRun(call, { canonicalInput: "https://a.test/x" });
    // The busy run is inside the hanging transport — the first drain is still busy.
    // The transport start is the deterministic anchor for "the drain is running".
    await withTimeout(whenCallsStarted(1), 2000, "first run inside transport");
    const b = await submitRun(call, { canonicalInput: "https://b.test/x" });
    release();
    const { status, phase } = await pollTerminal(call, b, 2000);
    expect(status).toBe(200);
    expect(phase).toBe("succeeded");
    void busyRunId;
  });

  it("a drain failure (persist error) does not disable later submissions", async () => {
    const saved: PersistedRun[] = [];
    let failedOnce = false;
    // Fail the FIRST shrink-save (the worker's pop persist) exactly once: the drain
    // rejects loudly and the run stays queued per the store contract; every later
    // save succeeds, so the next submission's drain must recover and run everything.
    const store: RunQueueStore = {
      save(pending) {
        const shrink = pending.length < saved.length;
        if (shrink && !failedOnce) {
          failedOnce = true;
          throw new Error("persist down");
        }
        saved.length = 0;
        saved.push(...pending);
      },
      load() {
        return [];
      },
    };
    const { transport } = gatedTransport(() => false);
    const engine = new RunEngine({ transport, caps: CAPS, retryBaseMs: 1, queueStore: store });
    const { call } = await startWith(engine);
    const a = await submitRun(call, { canonicalInput: "https://a.test/x" });
    const b = await submitRun(call, { canonicalInput: "https://b.test/x" });
    void a;
    // The submission that arrives AFTER the failed drain is the recovery proof.
    const c = await submitRun(call, { canonicalInput: "https://c.test/x" });
    void c;
    const { status, phase } = await pollTerminal(call, b, 2000);
    expect(status).toBe(200);
    expect(phase).toBe("succeeded");
  });
});
