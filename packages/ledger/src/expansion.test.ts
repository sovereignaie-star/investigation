import { manualClock, seededRandom, ulidFactory } from "@ir/core";
import { describe, expect, it } from "vitest";
import { Ledger } from "./index.ts";
import { project } from "./projections/index.ts";
import { expandFindings, expandForParents, isIdentifierType, recordOutcome } from "./expansion.ts";

const T0 = "2026-10-10T08:00:00.000Z";

function fixture(seed = 1) {
  const clock = manualClock(T0);
  const id = ulidFactory(clock, seededRandom(seed));
  const ledger = new Ledger({ actor: "tester", clock });
  const add = (kind: Parameters<Ledger["append"]>[0], payload: unknown) => {
    clock.advance(1000);
    return ledger.append(kind, payload);
  };
  const entity = (type: string, value: string, label = value) => {
    const e = { id: id(), type, canonicalKey: `${type}:${value}`, labels: { en: label }, props: {} };
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
  return { ledger, add, id, entity, evidence, clock };
}

describe("expansion (P2-002)", () => {
  it("isIdentifierType: catalog identifier types are edges, others are attributes", () => {
    expect(isIdentifierType("ipv4")).toBe(true);
    expect(isIdentifierType("domain")).toBe(true);
    expect(isIdentifierType("email")).toBe(true);
    expect(isIdentifierType("technology")).toBe(false);
    expect(isIdentifierType("http_status")).toBe(false);
  });

  it("a typed identifier finding creates an entity, an edge claim and a positive observation", () => {
    const f = fixture();
    const subject = f.entity("domain", "example.com");
    const ev = f.evidence("tr-dns");
    const out = {
      findings: [
        {
          predicate: "resolves_to",
          objectType: "ipv4",
          objectValue: "192.0.2.7",
          confidence: 1,
          explanation: "A record for example.com",
        },
      ],
    };
    const res = expandFindings(out, subject, {
      ledger: f.ledger,
      transformId: "tr-dns",
      evidenceId: ev,
      clock: f.clock,
    });
    expect(res.claimIds).toHaveLength(1);
    expect(res.objectEntityIds).toHaveLength(1);
    expect(res.attributeCount).toBe(0);
    expect(res.rejectedCount).toBe(0);

    const p = project(f.ledger.entries());
    expect(p.counts).toMatchObject({ entities: 2, nodes: 2, claims: 1, edges: 1, observations: 1, evidence: 1 });
    const edge = p.graph.edges[0];
    expect(edge).toMatchObject({ source: subject, target: res.objectEntityIds[0], predicate: "resolves_to" });
    expect(p.graph.nodes.find((n) => n.id === res.objectEntityIds[0])?.canonicalKey).toBe("ipv4:192.0.2.7");
    expect(p.issues).toEqual([]);
  });

  it("D-019: the same finding expanded against two parents yields two edges (graph, not tree)", () => {
    const f = fixture();
    const parentA = f.entity("domain", "a.example.com");
    const parentB = f.entity("domain", "b.example.com");
    const ev = f.evidence("tr-dns");
    const out = {
      findings: [
        {
          predicate: "resolves_to",
          objectType: "ipv4",
          objectValue: "192.0.2.7",
          confidence: 1,
          explanation: "shared A record",
        },
      ],
    };
    const results = expandForParents(out, [parentA, parentB], {
      ledger: f.ledger,
      transformId: "tr-dns",
      evidenceId: ev,
      clock: f.clock,
    });
    expect(results).toHaveLength(2);
    expect(results[0].claimIds).toHaveLength(1);
    expect(results[1].claimIds).toHaveLength(1);

    const p = project(f.ledger.entries());
    // 4 raw entity records (2 parents + 2 object records for the same key), but 3 nodes after
    // D-020 aliasing; 2 claims, 2 edges — the object keeps BOTH edges.
    expect(p.counts).toMatchObject({ entities: 4, nodes: 3, claims: 2, edges: 2 });
    const objectNode = p.graph.nodes.find((n) => n.canonicalKey === "ipv4:192.0.2.7");
    expect(objectNode).toBeDefined();
    const edgesToObject = p.graph.edges.filter((e) => e.target === objectNode?.id);
    expect(edgesToObject).toHaveLength(2);
    expect(new Set(edgesToObject.map((e) => e.source))).toEqual(new Set([parentA, parentB]));
    expect(p.issues).toEqual([]);
  });

  it("a literal attribute finding becomes a value claim (node attribute), not an edge", () => {
    const f = fixture();
    const subject = f.entity("domain", "example.com");
    const ev = f.evidence("tr-http");
    const out = {
      findings: [
        {
          predicate: "has_technology",
          objectType: "technology",
          objectValue: "server: nginx",
          confidence: 0.9,
          explanation: "server header",
        },
      ],
    };
    const res = expandFindings(out, subject, {
      ledger: f.ledger,
      transformId: "tr-http",
      evidenceId: ev,
      clock: f.clock,
    });
    expect(res.attributeCount).toBe(1);
    expect(res.objectEntityIds).toHaveLength(0);

    const p = project(f.ledger.entries());
    expect(p.counts).toMatchObject({ entities: 1, nodes: 1, claims: 1, edges: 0 });
    const node = p.graph.nodes.find((n) => n.id === subject);
    expect(node?.attributes).toEqual([expect.objectContaining({ predicate: "has_technology", value: "server: nginx", confidence: 0.9 })]);
    expect(p.issues).toEqual([]);
  });

  it("a finding whose object value is not a valid identifier is an error observation, never a claim", () => {
    const f = fixture();
    const subject = f.entity("domain", "example.com");
    const ev = f.evidence("tr-dns");
    const out = {
      findings: [
        {
          predicate: "resolves_to",
          objectType: "ipv4",
          objectValue: "not-an-ip",
          confidence: 1,
          explanation: "bad value",
        },
      ],
    };
    const res = expandFindings(out, subject, {
      ledger: f.ledger,
      transformId: "tr-dns",
      evidenceId: ev,
      clock: f.clock,
    });
    expect(res.rejectedCount).toBe(1);
    expect(res.claimIds).toHaveLength(0);

    const p = project(f.ledger.entries());
    expect(p.counts).toMatchObject({ entities: 1, nodes: 1, claims: 0, edges: 0, observations: 1 });
    expect(p.graph.nodes.find((n) => n.id === subject)?.observations).toEqual({ positive: 0, negative: 0, error: 1 });
    expect(p.issues).toEqual([]);
  });

  it("re-expanding the same value aliases onto the existing node (D-020), no duplicate node", () => {
    const f = fixture();
    const subject = f.entity("domain", "example.com");
    const ev = f.evidence("tr-dns");
    const out = {
      findings: [
        {
          predicate: "resolves_to",
          objectType: "ipv4",
          objectValue: "192.0.2.7",
          confidence: 1,
          explanation: "A record",
        },
      ],
    };
    expandFindings(out, subject, {
      ledger: f.ledger,
      transformId: "tr-dns",
      evidenceId: ev,
      clock: f.clock,
    });
    expandFindings(out, subject, {
      ledger: f.ledger,
      transformId: "tr-dns",
      evidenceId: ev,
      clock: f.clock,
    });
    const p = project(f.ledger.entries());
    // Two claims (one per expansion), but ONE object node (D-020).
    expect(p.counts).toMatchObject({ entities: 3, nodes: 2, claims: 2, edges: 2 });
    expect(p.graph.nodes.filter((n) => n.canonicalKey === "ipv4:192.0.2.7")).toHaveLength(1);
    expect(p.issues).toEqual([]);
  });

  it("P2-006: recordOutcome records a negative observation (D3: searched, found nothing)", () => {
    const f = fixture();
    const subject = f.entity("domain", "example.com");
    const ev = f.evidence("tr-dns");
    const obsId = recordOutcome(subject, "negative", {
      ledger: f.ledger,
      transformId: "tr-dns",
      evidenceId: ev,
      clock: f.clock,
    });
    expect(obsId).toBeTruthy();
    const p = project(f.ledger.entries());
    expect(p.counts).toMatchObject({ entities: 1, nodes: 1, claims: 0, edges: 0, observations: 1 });
    expect(p.graph.nodes.find((n) => n.id === subject)?.observations).toEqual({ positive: 0, negative: 1, error: 0 });
    // D3: a negative observation is coverage — the cell is checked-with-no-result, not untouched.
    expect(p.coverage.cells.find((c) => c.entityId === subject && c.transformId === "tr-dns")).toMatchObject({
      negative: 1,
      last: "negative",
    });
    expect(p.coverage.untouched).toEqual([]);
    expect(p.issues).toEqual([]);
  });

  it("P2-006: recordOutcome records an error observation with a note (D3: failure is not emptiness)", () => {
    const f = fixture();
    const subject = f.entity("domain", "example.com");
    const ev = f.evidence("tr-dns");
    recordOutcome(
      subject,
      "error",
      {
        ledger: f.ledger,
        transformId: "tr-dns",
        evidenceId: ev,
        clock: f.clock,
      },
      "rate limited",
    );
    const p = project(f.ledger.entries());
    expect(p.graph.nodes.find((n) => n.id === subject)?.observations).toEqual({ positive: 0, negative: 0, error: 1 });
    // D3: failure is never mixed with emptiness — the cell is error, not negative.
    expect(p.coverage.cells.find((c) => c.entityId === subject && c.transformId === "tr-dns")).toMatchObject({
      error: 1,
      last: "error",
    });
    expect(p.issues).toEqual([]);
  });
});
