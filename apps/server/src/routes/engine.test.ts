import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { RunEngine, type HttpTransport, type TransportRequest, type TransportResponse } from "@ir/engine";
import { createApp } from "../app";
import { engineRouter } from "./engine";

const ADMIN_TOKEN = "admin-token-123";
const ENABLED = { IR_ADMIN_TOKEN: ADMIN_TOKEN };
const servers: Server[] = [];
const restoreFns: Array<() => void> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const r of restoreFns.splice(0)) r();
});

function withAdmin(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  return { ...init, headers };
}

/** Deterministic fake transport: serves a canned response, records calls. */
function fakeTransport(): HttpTransport & { calls: number } {
  const t = {
    calls: 0,
    async fetch(req: TransportRequest, _signal: AbortSignal): Promise<TransportResponse> {
      t.calls++;
      return { status: 200, body: `ok:${req.url}` };
    },
  };
  return t;
}

async function start() {
  const transport = fakeTransport();
  const engine = new RunEngine({
    transport,
    caps: { maxNodes: 5, maxDepth: 3, maxRequests: 5, maxCostEstimate: 100, maxElapsedMs: 5_000 },
    retryBaseMs: 1,
  });
  const app = createApp(engineRouter(() => engine, { env: ENABLED }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(base + p, init);
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
  };
  return { call, engine, transport, base };
}

async function submitRun(call: (p: string, init?: RequestInit) => Promise<{ status: number; text: string }>): Promise<string> {
  const res = await call(
    "/runs",
    withAdmin({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "lookup", canonicalInput: "https://example.com/a" }),
    }),
  );
  expect(res.status).toBe(202);
  return (JSON.parse(res.text) as { runId: string }).runId;
}

describe("engine routes (P2-019)", () => {
  it("submits a run and returns a queued runId (202)", async () => {
    const { call } = await start();
    const runId = await submitRun(call);
    expect(runId).toMatch(/^run-/);
  });

  it("rejects a run without kind or canonicalInput (400)", async () => {
    const { call } = await start();
    const res = await call(
      "/runs",
      withAdmin({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "lookup" }) }),
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text)).toMatchObject({ error: "canonicalInput is required" });
  });

  it("reports a run result after drain (succeeded)", async () => {
    const { call, engine } = await start();
    const runId = await submitRun(call);
    await engine.drain();
    const res = await call(`/runs/${runId}`, withAdmin());
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as { runId: string; phase: string; transportAttempts: number };
    expect(body.phase).toBe("succeeded");
    expect(body.transportAttempts).toBe(1);
  });

  it("returns 404 for an unknown run", async () => {
    const { call } = await start();
    const res = await call("/runs/run-unknown", withAdmin());
    expect(res.status).toBe(404);
  });

  it("cancels a queued run (202) and reports cancelled after drain", async () => {
    const { call, engine } = await start();
    const runId = await submitRun(call);
    const del = await call(`/runs/${runId}`, withAdmin({ method: "DELETE" }));
    expect(del.status).toBe(202);
    await engine.drain();
    const res = await call(`/runs/${runId}`, withAdmin());
    expect(JSON.parse(res.text)).toMatchObject({ phase: "cancelled" });
  });

  it("streams phase events over SSE and closes on the terminal phase", async () => {
    const { call, engine, base } = await start();
    const runId = await submitRun(call);
    // Open the SSE stream before draining so the listener is registered.
    const controller = new AbortController();
    const streamPromise = (async () => {
      const res = await fetch(`${base}/runs/${runId}/events`, withAdmin({ signal: controller.signal }));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const text = await res.text();
      return text;
    })();
    // Give the stream a tick to register the listener, then drain.
    await new Promise((r) => setTimeout(r, 20));
    await engine.drain();
    const text = await streamPromise;
    controller.abort();
    expect(text).toContain("event: phase");
    expect(text).toContain('"phase":"running"');
    expect(text).toContain('"phase":"succeeded"');
  });

  it("requires admin auth (401 without token)", async () => {
    const { call } = await start();
    const res = await call("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "lookup", canonicalInput: "https://example.com/a" }),
    });
    expect(res.status).toBe(401);
  });
});
