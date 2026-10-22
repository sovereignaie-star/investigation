import { manualClock, seededRandom, ulidFactory } from "@ir/core";
import { describe, expect, it } from "vitest";
import { Ledger } from "../index.ts";
import { project } from "./index.ts";

const T0 = "2026-10-10T08:00:00.000Z";

function fixture(seed = 1) {
  const clock = manualClock(T0);
  const id = ulidFactory(clock, seededRandom(seed));
  const ledger = new Ledger({ actor: "tester", clock });
  const add = (kind: Parameters<Ledger["append"]>[0], payload: unknown) => {
    clock.advance(1000);
    return ledger.append(kind, payload);
  };
  const entity = (type: string, value: string) => {
    const e = { id: id(), type, canonicalKey: `${type}:${value}`, labels: { en: value }, props: {} };
    add("entity.added", e);
    return e.id;
  };
  const evidence = (transformId = "tr-dns") => {
    const sha = "ab".repeat(32);
    const ev = {
      id: id(),
      sha256: sha,
      mime: "application/json",
      size: 2,
      blobRef: `blobs/ab/${sha}`,
      fetchedAt: T0,
      request: { method: "LOCAL", url: "local://fixture", headers: {} },
      transformId,
      version: "1",
    };
    add("evidence.stored", ev);
    return ev.id;
  };
  const observe = (
    target: { entityId: string } | { claimId: string },
    kind: "positive" | "negative" | "error",
    evidenceId: string,
    transformId = "tr-dns",
  ) => {
    add("observation.added", { id: id(), ...target, transformId, evidenceId, observedAt: T0, kind });
  };
  return { ledger, add, id, entity, evidence, observe };
}

/**
 * T-COV-001..008 — coverage projection and negative evidence (P2-017, D3).
 * Every transform that returns empty shows in the map; failure is never mixed with emptiness.
 */
describe("coverage projection (P2-017 / T-COV)", () => {
  it("T-COV-009 (red first — P4-010/UC-21): a policy-blocked pair is served as not_run with its recorded reason — never inferred from absence", () => {
    // The REAL path the engine writes (P2-029): a source disabled on the case (or
    // excluded by the operator, or its input refused) is never invoked and the
    // CLI audits `investigate.not_run` with the reason on the case's chain. The
    // coverage map must SERVE that proven record — D3's map shows «محظور بسياسة»
    // as its own state; silence (an absent pair) must never stand for it.
    const f = fixture();
    f.entity("domain", "blocked.example");
    f.add("audit.event", {
      id: f.id(),
      at: T0,
      actor: "tester",
      action: "investigate.not_run",
      target: "domain:blocked.example",
      purposeRef: f.id(),
      detail: { transform: "tr-disabled", reason: "disabled: policy — source disabled on this case", depth: 0 },
    });
    const p = project(f.ledger.entries());
    expect(p.coverage.notRun).toEqual([
      {
        key: "domain:blocked.example",
        transformId: "tr-disabled",
        reason: "disabled: policy — source disabled on this case",
        at: T0,
      },
    ]);
    // the pair is served as its OWN state — never folded into the observation-based
    // cells — and the reason rides along verbatim, never paraphrased into a
    // fabricated one. (untouched keeps P2-017's documented semantics — observation-
    // based; the ROW-level badge logic is the web model's, proven in its tests.)
    expect(p.coverage.cells.filter((c) => c.transformId === "tr-disabled")).toHaveLength(0);
    expect(p.coverage.notRun).toHaveLength(1);
  });

  it("T-COV-001: an empty chain projects to empty coverage", () => {
    const p = project([]);
    expect(p.coverage).toEqual({ cells: [], transforms: [], untouched: [], notRun: [] });
  });

  it("T-COV-002: a positive observation is a checked cell, not untouched", () => {
    const f = fixture();
    const domain = f.entity("domain", "example.com");
    const ev = f.evidence("tr-dns");
    f.observe({ entityId: domain }, "positive", ev, "tr-dns");
    const p = project(f.ledger.entries());
    expect(p.coverage.cells).toEqual([expect.objectContaining({ entityId: domain, transformId: "tr-dns", positive: 1, last: "positive" })]);
    expect(p.coverage.untouched).toEqual([]);
    expect(p.coverage.transforms).toEqual(["tr-dns"]);
  });

  it("T-COV-003: a negative observation (searched, found nothing) is coverage, not untouched (D3)", () => {
    const f = fixture();
    const domain = f.entity("domain", "example.com");
    const ev = f.evidence("tr-dns");
    f.observe({ entityId: domain }, "negative", ev, "tr-dns");
    const p = project(f.ledger.entries());
    expect(p.coverage.cells).toEqual([expect.objectContaining({ entityId: domain, transformId: "tr-dns", negative: 1, last: "negative" })]);
    expect(p.coverage.untouched).toEqual([]);
  });

  it("T-COV-004: an error observation is a failed cell, never mixed with emptiness", () => {
    const f = fixture();
    const domain = f.entity("domain", "example.com");
    const ev = f.evidence("tr-dns");
    f.observe({ entityId: domain }, "error", ev, "tr-dns");
    const p = project(f.ledger.entries());
    expect(p.coverage.cells).toEqual([expect.objectContaining({ entityId: domain, transformId: "tr-dns", error: 1, last: "error" })]);
    // The cell is error, not negative — failure is never reported as "searched, found nothing".
    expect(p.coverage.cells[0]?.negative).toBe(0);
    expect(p.coverage.untouched).toEqual([]);
  });

  it("T-COV-005: a node with no observation at all is untouched", () => {
    const f = fixture();
    const domain = f.entity("domain", "example.com");
    const ip = f.entity("ipv4", "192.0.2.7");
    const ev = f.evidence("tr-dns");
    f.observe({ entityId: domain }, "positive", ev, "tr-dns");
    const p = project(f.ledger.entries());
    expect(p.coverage.untouched).toEqual([ip]);
  });

  it("T-COV-006: multiple transforms on one node produce separate cells", () => {
    const f = fixture();
    const domain = f.entity("domain", "example.com");
    const ev1 = f.evidence("tr-dns");
    const ev2 = f.evidence("tr-whois");
    f.observe({ entityId: domain }, "positive", ev1, "tr-dns");
    f.observe({ entityId: domain }, "negative", ev2, "tr-whois");
    const p = project(f.ledger.entries());
    expect(p.coverage.cells).toHaveLength(2);
    expect(p.coverage.cells.map((c) => c.transformId).sort()).toEqual(["tr-dns", "tr-whois"]);
    expect(p.coverage.transforms).toEqual(["tr-dns", "tr-whois"]);
  });

  it("T-COV-007: an observation on a claim counts for its subject", () => {
    const f = fixture();
    const email = f.entity("email", "a@example.com");
    const domain = f.entity("domain", "example.com");
    const claim = {
      id: f.id(),
      subjectId: email,
      predicate: "email.domain",
      objectId: domain,
      confidence: 0.8,
      explanation: "test",
    };
    f.add("claim.added", claim);
    const ev = f.evidence("tr-mx");
    f.observe({ claimId: claim.id }, "positive", ev, "tr-mx");
    const p = project(f.ledger.entries());
    expect(p.coverage.cells.find((c) => c.entityId === email && c.transformId === "tr-mx")).toMatchObject({
      positive: 1,
    });
  });

  it("T-COV-008: failure and emptiness are distinct cells on the same node (never merged)", () => {
    const f = fixture();
    const domain = f.entity("domain", "example.com");
    const ev1 = f.evidence("tr-dns");
    const ev2 = f.evidence("tr-dns");
    // Same transform, two runs: one error, one negative.
    f.observe({ entityId: domain }, "error", ev1, "tr-dns");
    f.observe({ entityId: domain }, "negative", ev2, "tr-dns");
    const p = project(f.ledger.entries());
    const cell = p.coverage.cells.find((c) => c.entityId === domain && c.transformId === "tr-dns");
    expect(cell).toMatchObject({ error: 1, negative: 1, last: "negative" });
    // Both are counted distinctly — failure is never reported as emptiness.
    expect(cell?.error).toBe(1);
    expect(cell?.negative).toBe(1);
  });
});
