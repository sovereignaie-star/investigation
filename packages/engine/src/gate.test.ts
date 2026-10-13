import { describe, expect, it } from "vitest";
import { naturalPersonGate } from "./gate.ts";
import { RunEngine } from "./run.ts";
import type { HttpTransport, TransportRequest, TransportResponse } from "./transport.ts";

const caps = {
  maxNodes: 5,
  maxDepth: 3,
  maxRequests: 5,
  maxCostEstimate: 100,
  maxElapsedMs: 5_000,
};

function fakeRandom() {
  let n = 0;
  return (len: number) => `r${(++n).toString(36).padStart(len - 1, "0")}`;
}

function fakeTransport(): HttpTransport & { calls: number } {
  const t = {
    calls: 0,
    async fetch(_req: TransportRequest, _signal: AbortSignal): Promise<TransportResponse> {
      t.calls++;
      return { status: 200, body: "ok" };
    },
  };
  return t;
}

describe("natural persons gate (P2-013 / E-02 / T-ETH-002)", () => {
  it("a normal input is allowed", () => {
    expect(naturalPersonGate({ sensitivity: "normal" })).toEqual({ allowed: true });
  });

  it("a missing sensitivity is allowed at the engine level (egress enforces unclassified_data)", () => {
    expect(naturalPersonGate({})).toEqual({ allowed: true });
  });

  it("a natural_person_gate input without a purpose confirmation is refused", () => {
    const r = naturalPersonGate({ sensitivity: "natural_person_gate" });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("natural_person");
  });

  it("a natural_person_gate input WITH a purpose confirmation is allowed", () => {
    expect(naturalPersonGate({ sensitivity: "natural_person_gate" }, { purpose: "due diligence", confirmedBy: "investigator" })).toEqual({
      allowed: true,
    });
  });

  it("an empty purpose or confirmer is not a confirmation (fail-closed)", () => {
    expect(naturalPersonGate({ sensitivity: "natural_person_gate" }, { purpose: "  ", confirmedBy: "x" }).allowed).toBe(false);
    expect(naturalPersonGate({ sensitivity: "natural_person_gate" }, { purpose: "ok", confirmedBy: " " }).allowed).toBe(false);
  });

  it("a minor input is refused (E-08)", () => {
    const r = naturalPersonGate({ sensitivity: "minor" });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("minor");
  });
});

describe("engine natural persons gate (P2-013)", () => {
  it("T-ETH-002: expanding a natural-person input without a purpose confirmation is refused and recorded", async () => {
    const engine = new RunEngine({ transport: fakeTransport(), caps, random: fakeRandom() });
    const handle = engine.submit({
      kind: "email",
      canonicalInput: "person@example.com",
      sensitivity: "natural_person_gate",
    });
    await engine.drain();
    const res = engine.result(handle.runId);
    expect(res?.phase).toBe("failed");
    expect(res?.transportAttempts).toBe(0); // never reached the transport
    if (res?.failure?.kind === "transform") {
      expect(res.failure.message).toContain("purpose confirmation");
    } else {
      throw new Error("expected a transform failure");
    }
  });

  it("a natural-person input WITH a purpose confirmation runs", async () => {
    const engine = new RunEngine({
      transport: fakeTransport(),
      caps,
      random: fakeRandom(),
      purposeConfirmation: { purpose: "due diligence", confirmedBy: "investigator" },
    });
    const handle = engine.submit({
      kind: "email",
      canonicalInput: "person@example.com",
      sensitivity: "natural_person_gate",
    });
    await engine.drain();
    const res = engine.result(handle.runId);
    expect(res?.phase).toBe("succeeded");
    expect(res?.transportAttempts).toBe(1);
  });

  it("a normal input runs without a confirmation", async () => {
    const engine = new RunEngine({ transport: fakeTransport(), caps, random: fakeRandom() });
    const handle = engine.submit({ kind: "domain", canonicalInput: "example.com", sensitivity: "normal" });
    await engine.drain();
    const res = engine.result(handle.runId);
    expect(res?.phase).toBe("succeeded");
  });
});
