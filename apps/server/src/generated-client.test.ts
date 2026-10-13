import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { RunEngine } from "@ir/engine";
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

async function start() {
  const transport = {
    async fetch(req: { method: string; url: string }, _signal: AbortSignal) {
      return { status: 200, body: `ok:${req.url}` };
    },
  };
  const engine = new RunEngine({
    transport,
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

describe("generated API client against the live engine server (P2-019)", () => {
  it("submitRun returns a queued runId, getRun reports succeeded after drain", async () => {
    const { engine } = await start();
    const submitted = await submitRun({ kind: "lookup", canonicalInput: "https://example.com/a" });
    expect(submitted.runId).toMatch(/^run-/);
    expect(submitted.status).toBe("queued");
    await engine.drain();
    const result = await getRun(submitted.runId);
    expect(result.phase).toBe("succeeded");
    expect(result.transportAttempts).toBe(1);
  });

  it("cancelRun cancels a queued run and getRun reports cancelled", async () => {
    const { engine } = await start();
    const submitted = await submitRun({ kind: "lookup", canonicalInput: "https://example.com/b" });
    const cancelled = await cancelRun(submitted.runId);
    expect(cancelled.status).toBe("cancelling");
    await engine.drain();
    const result = await getRun(submitted.runId);
    expect(result.phase).toBe("cancelled");
  });
});
