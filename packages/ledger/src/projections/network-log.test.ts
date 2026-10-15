/**
 * P2-014 — the per-case network log (E-06 / T-ETH-006): every external request the case made must be
 * visible in it. Two sources, both already written per case by the production paths:
 *   - gateway decisions: `audit.event` entries with action `egress.*` (one per outbound request —
 *     INCLUDING robots.txt fetches, allowed and refused — written by the CLI's audit sink, network.ts);
 *   - request outcomes: `evidence.stored` entries with a real request (URL, status) — LOCAL run records
 *     (`local://ir-run`) are run records, not external requests, and stay out of the log.
 *
 * Red first: this test was written before `networkLogView` existed and fails on the missing module.
 */
import { describe, expect, it } from "vitest";
import { isoNow, ulidFactory, manualClock } from "@ir/core";
import { storeEvidence } from "../evidence.ts";
import { type Entry, type Kind } from "../ledger.ts";
import { Projector } from "./state.ts";
import { networkLogView } from "./views.ts";

const clock = manualClock("2026-10-16T00:00:00.000Z");
const newId = ulidFactory(clock);
const ISO = isoNow(clock);

/** A minimal appendable chain stub: apply() is what the Projector consumes. */
function entry(seq: number, kind: Kind, payload: unknown): Entry {
  return { seq, prevHash: null, entryHash: "h", kind, payload, at: ISO, actor: "test" } as Entry;
}

function auditEntry(seq: number, action: string, target: string, detail?: Record<string, unknown>): Entry {
  return entry(seq, "audit.event", {
    id: newId(),
    at: ISO,
    actor: "test",
    action,
    target,
    purposeRef: newId(),
    ...(detail ? { detail } : {}),
  });
}

describe("network log view (P2-014 / T-ETH-006)", () => {
  const blobs = {
    put: (b: Uint8Array) => ({ sha256: "a".repeat(64), size: b.length, blobRef: `blobs/aa/${"a".repeat(64)}` }),
  } as never;

  it("every outbound request appears: robots.txt and the page (gateway decisions), each with host and transform", () => {
    const p = new Projector();
    p.apply(auditEntry(0, "egress.allowed", "source.example", { transform: "TR-010@1.0.0", transportCalls: 1 }));
    p.apply(auditEntry(1, "egress.allowed", "source.example", { transform: "TR-010@1.0.0", transportCalls: 1 }));
    const log = networkLogView(p);
    expect(log.requests).toHaveLength(2);
    expect(log.requests[0]).toMatchObject({ seq: 0, decision: "allowed", host: "source.example", transportCalls: 1 });
    expect(log.requests.map((r) => r.host)).toEqual(["source.example", "source.example"]);
  });

  it("a refused request (denied before the transport) is in the log with its reason and zero calls", () => {
    const p = new Projector();
    p.apply(auditEntry(0, "egress.denied", "evil.example", { transform: "TR-010@1.0.0", reason: "host_not_allowed", transportCalls: 0 }));
    const log = networkLogView(p);
    expect(log.requests).toHaveLength(1);
    expect(log.requests[0]).toMatchObject({ decision: "denied", host: "evil.example", reason: "host_not_allowed", transportCalls: 0 });
  });

  it("stored responses appear with method, url, status and evidence id; LOCAL run records do not", () => {
    const p = new Projector();
    const ledger = { append: (k: Kind, payload: unknown) => p.apply(entry(p.seq + 1, k, payload)) };
    storeEvidence(ledger, blobs, {
      bytes: new TextEncoder().encode("<html>ok</html>"),
      mime: "text/html",
      request: { method: "GET", url: "https://source.example/", headers: {}, status: 200 },
      transformId: "tr-010",
      version: "1.0.0",
    });
    p.apply(auditEntry(2, "egress.allowed", "source.example", { transform: "TR-010@1.0.0", transportCalls: 1 }));
    storeEvidence(ledger, blobs, {
      bytes: new TextEncoder().encode("{}"),
      mime: "application/json",
      request: { method: "LOCAL", url: "local://ir-run", headers: {} },
      transformId: "tr-010",
      version: "1.0.0",
    });
    const log = networkLogView(p);
    expect(log.responses).toHaveLength(1);
    expect(log.responses[0]).toMatchObject({
      method: "GET",
      url: "https://source.example/",
      status: 200,
      transformId: "tr-010",
    });
  });

  it("a failed request (no status) still appears in the responses with its url", () => {
    const p = new Projector();
    const ledger = { append: (k: Kind, payload: unknown) => p.apply(entry(p.seq + 1, k, payload)) };
    storeEvidence(ledger, blobs, {
      bytes: new TextEncoder().encode(""),
      mime: "text/plain",
      request: { method: "GET", url: "https://down.example/", headers: {} },
      transformId: "tr-010",
      version: "1.0.0",
    });
    const log = networkLogView(p);
    expect(log.responses).toHaveLength(1);
    expect(log.responses[0]).toMatchObject({ url: "https://down.example/" });
    expect(log.responses[0].status).toBeUndefined();
  });

  it("rows are in ledger (seq) order and the log is empty for a chain with no network activity", () => {
    const p = new Projector();
    expect(networkLogView(p)).toEqual({ requests: [], hops: [], responses: [] });
    p.apply(auditEntry(0, "egress.timeout", "slow.example", { transform: "TR-010@1.0.0", transportCalls: 1 }));
    p.apply(auditEntry(1, "egress.rate_limited", "busy.example", { transform: "TR-010@1.0.0", transportCalls: 0 }));
    const log = networkLogView(p);
    expect(log.requests.map((r) => r.seq)).toEqual([0, 1]);
    expect(log.requests.map((r) => r.decision)).toEqual(["timeout", "rate_limited"]);
  });

  it("non-egress audit events (case lifecycle, robots policy) are not network requests", () => {
    const p = new Projector();
    p.apply(auditEntry(0, "case.updated", "case-1", { fields: ["purpose"] }));
    p.apply(auditEntry(1, "robots.policy", "source.example", { basis: "no_file" }));
    const log = networkLogView(p);
    expect(log.requests).toHaveLength(0);
    expect(log.hops).toHaveLength(0);
  });

  it("a completed redirect-target hop is its own row with its full URL and status", () => {
    const p = new Projector();
    p.apply(auditEntry(0, "egress.allowed", "a.example", { transform: "TR-010@1.0.0", transportCalls: 1 }));
    p.apply(
      auditEntry(1, "egress.hop", "b.example", { transform: "TR-010@1.0.0", url: "https://b.example/x", status: 200, transportCalls: 2 }),
    );
    const log = networkLogView(p);
    expect(log.requests).toHaveLength(1); // the entry request (its first hop)
    expect(log.hops).toHaveLength(1); // the redirect-target call
    expect(log.hops[0]).toMatchObject({ url: "https://b.example/x", status: 200, host: "b.example" });
  });

  it('a simulated outcome is marked origin "sim" — a recorded outcome, not a real connection', () => {
    const p = new Projector();
    const ledger = { append: (k: Kind, payload: unknown) => p.apply(entry(p.seq + 1, k, payload)) };
    storeEvidence(ledger, blobs, {
      bytes: new TextEncoder().encode("<html>sim</html>"),
      mime: "text/html",
      request: { method: "GET", url: "https://sim.example/", headers: {}, status: 200 },
      transformId: "tr-010",
      version: "1.0.0",
      origin: "sim",
    });
    const log = networkLogView(p);
    expect(log.responses).toHaveLength(1);
    expect(log.responses[0].origin).toBe("sim");
    expect(log.requests).toHaveLength(0); // no gateway was involved
  });
});
