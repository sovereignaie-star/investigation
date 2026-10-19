import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { RunEngine, type HttpTransport, type RunResult } from "@ir/engine";
import { createApp } from "./app";
import { engineRouter } from "./routes/engine";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { submitRun, getRun, cancelRun } from "@workspace/api-client-react";

const ADMIN_TOKEN = "admin-token-123";
const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  setBaseUrl(null);
  setAuthTokenGetter(null);
});

async function start(transportOverride?: HttpTransport) {
  const transport = {
    async fetch(req: { method: string; url: string }, _signal: AbortSignal) {
      return { status: 200, body: `ok:${req.url}` };
    },
  };
  const engine = new RunEngine({
    transport: transportOverride ?? transport,
    caps: { maxNodes: 5, maxDepth: 3, maxRequests: 5, maxCostEstimate: 100, maxElapsedMs: 5_000 },
    retryBaseMs: 1,
  });
  const app = createApp(engineRouter(() => engine, { env: { IR_ADMIN_TOKEN: ADMIN_TOKEN } }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  setBaseUrl(base);
  setAuthTokenGetter(() => ADMIN_TOKEN);
  return { engine, base };
}

/** Bounded wait for the run's result (the route's auto-drain settles it asynchronously). */
async function waitForResult(engine: RunEngine, runId: string): Promise<RunResult> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const result = engine.result(runId);
    if (result) return result;
    if (Date.now() >= deadline) throw new Error("run result never appeared");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("generated API client against the live engine server (P2-019)", () => {
  it("submitRun returns a queued runId, getRun reports succeeded (P3-011 auto-drain)", async () => {
    const { engine } = await start();
    const submitted = await submitRun({ kind: "lookup", canonicalInput: "https://example.com/a" });
    expect(submitted.runId).toMatch(/^run-/);
    expect(submitted.status).toBe("queued");
    // No manual drain: the route schedules it (P3-011); wait for the result.
    const result = await waitForResult(engine, submitted.runId);
    expect(result.phase).toBe("succeeded");
    expect(result.transportAttempts).toBe(1);
    const viaApi = await getRun(submitted.runId);
    expect(viaApi.phase).toBe("succeeded");
  });

  it("cancelRun cancels a live run and getRun reports cancelled", async () => {
    // A hanging transport pins the run inside the transport so the cancel targets
    // a live run deterministically (no race with the auto-drain finishing it).
    let release!: () => void;
    const releasePromise = new Promise<void>((r) => (release = r));
    const hanging: HttpTransport = {
      async fetch(): Promise<{ status: number; body: string }> {
        await releasePromise;
        return { status: 200, body: "ok" };
      },
    };
    const { engine } = await start(hanging);
    const submitted = await submitRun({ kind: "lookup", canonicalInput: "https://example.com/b" });
    const cancelled = await cancelRun(submitted.runId);
    expect(cancelled.status).toBe("cancelling");
    const result = await waitForResult(engine, submitted.runId);
    expect(result.phase).toBe("cancelled");
    const viaApi = await getRun(submitted.runId);
    expect(viaApi.phase).toBe("cancelled");
    release();
  });
});
