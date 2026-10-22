import { manualClock, seededRandom, ulidFactory } from "@ir/core";
import { Ledger } from "@ir/ledger";
import { project, type Graph, type GraphNode } from "@ir/ledger/projections";
import { describe, expect, it } from "vitest";

import { buildNodeDetail } from "./nodeDetailModel";

/**
 * P3-008 acceptance (ROADMAP 6.4, literal): "كل حقل يحيل إلى دليل" — every field
 * shown in the node detail panel links to its evidence. The panel is fed by a pure
 * model over the real projection graph (@ir/ledger graphView), so the linkage is
 * tested here red-first: attributes carry their claim observations' evidence ids,
 * relations carry the edge's evidence ids, and a claim with no observation shows
 * honestly as evidence-less (never invents a link).
 */

function node(id: string, attrs: GraphNode["attributes"] = []): GraphNode {
  return {
    id,
    type: "domain",
    canonicalKey: id,
    labels: { ar: `عقدة ${id}`, en: id },
    props: {},
    aliases: [],
    attributes: attrs,
    observations: { positive: 0, negative: 0, error: 0 },
    evidenceIds: [],
  };
}

const N1 = "n1";
const N2 = "n2";

/** Two attributes, each with its own single evidence — for per-row swap testing. */
function twoAttributeFixture(evRegistrar: string, evCreated: string): Graph {
  return {
    nodes: [
      node(N1, [
        { claimId: "c-registrar", predicate: "whois.registrar", value: "Example Registrar", confidence: 0.8, evidenceIds: [evRegistrar] },
        { claimId: "c-created", predicate: "whois.created", value: "2020-01-01", confidence: 0.7, evidenceIds: [evCreated] },
      ]),
      node(N2),
    ],
    edges: [],
  };
}

function fixture(evidenceForAttr1: string[], evidenceForEdge = "ev-edge"): Graph {
  return {
    nodes: [
      node(N1, [
        {
          claimId: "c-registrar",
          predicate: "whois.registrar",
          value: "Example Registrar",
          confidence: 0.8,
          evidenceIds: evidenceForAttr1,
        },
        { claimId: "c-created", predicate: "whois.created", value: "2020-01-01", confidence: 0.7, evidenceIds: [] },
      ]),
      node(N2),
    ],
    edges: [
      {
        id: "e-resolves",
        source: N1,
        target: N2,
        predicate: "dns.a",
        confidence: 0.9,
        validFrom: null,
        validTo: null,
        explanation: "test",
        evidenceIds: [evidenceForEdge],
      },
    ],
  };
}

function must<T>(v: T | null): T {
  if (v === null) throw new Error("expected non-null detail");
  return v;
}

describe("buildNodeDetail (P3-008)", () => {
  it("carries each attribute's evidence ids from the claim observations", () => {
    const registrar = must(buildNodeDetail(fixture(["ev-whois-1", "ev-whois-2"]), N1)).attributes.find((a) => a.claimId === "c-registrar");
    expect(registrar?.evidenceIds).toEqual(["ev-whois-1", "ev-whois-2"]);
  });

  it("keeps an evidence-less claim evidence-less — never invents a link", () => {
    const created = must(buildNodeDetail(fixture(["ev-whois-1"]), N1)).attributes.find((a) => a.claimId === "c-created");
    expect(created?.evidenceIds).toEqual([]);
  });

  it("lists relations in both directions with the other node's label and the edge evidence", () => {
    const out = must(buildNodeDetail(fixture(["ev-whois-1"]), N1));
    expect(out.relations).toHaveLength(1);
    expect(out.relations[0]).toMatchObject({ direction: "out", otherId: N2, otherLabel: "عقدة n2", evidenceIds: ["ev-edge"] });

    const inc = must(buildNodeDetail(fixture(["ev-whois-1"]), N2));
    expect(inc.relations).toHaveLength(1);
    expect(inc.relations[0]).toMatchObject({ direction: "in", otherId: N1, otherLabel: "عقدة n1", evidenceIds: ["ev-edge"] });
  });

  it("swaps evidence between two claim rows and each row reflects its own evidence (fidelity)", () => {
    const attr = (g: Graph, claim: string) => must(must(buildNodeDetail(g, N1)).attributes.find((a) => a.claimId === claim)).evidenceIds;
    const before = twoAttributeFixture("ev-registrar", "ev-created");
    expect(attr(before, "c-registrar")).toEqual(["ev-registrar"]);
    expect(attr(before, "c-created")).toEqual(["ev-created"]);
    const after = twoAttributeFixture("ev-created", "ev-registrar"); // the two assignments swapped
    expect(attr(after, "c-registrar")).toEqual(["ev-created"]);
    expect(attr(after, "c-created")).toEqual(["ev-registrar"]);
  });

  it("carries evidence from a real Projector projection, not just hand-built graphs", () => {
    const clock = manualClock("2026-10-19T08:00:00.000Z");
    const id = ulidFactory(clock, seededRandom(7));
    const ledger = new Ledger({ actor: "web-test", clock });
    const entityId = id();
    const claimId = id();
    const evidenceId = id();
    ledger.append("entity.added", {
      id: entityId,
      type: "domain",
      canonicalKey: "domain:proj.example.com",
      labels: { ar: "نطاق" },
      props: {},
    });
    ledger.append("claim.added", {
      id: claimId,
      subjectId: entityId,
      predicate: "whois.registrar",
      value: "Proj Registrar",
      confidence: 0.9,
      explanation: "test",
    });
    const sha = "cd".repeat(32);
    ledger.append("evidence.stored", {
      id: evidenceId,
      sha256: sha,
      mime: "application/json",
      size: 2,
      blobRef: `blobs/cd/${sha}`,
      fetchedAt: "2026-10-19T08:00:00.000Z",
      request: { method: "LOCAL", url: "local://fixture", headers: {} },
      transformId: "tr-whois",
      version: "1",
    });
    clock.advance(1000);
    ledger.append("observation.added", {
      id: id(),
      claimId,
      transformId: "tr-whois",
      evidenceId,
      observedAt: "2026-10-19T08:00:01.000Z",
      kind: "positive",
    });
    const graph = project(ledger.entries()).graph;
    const d = must(buildNodeDetail(graph, entityId));
    const registrar = must(d.attributes.find((a) => a.claimId === claimId));
    expect(registrar.evidenceIds).toEqual([evidenceId]);
  });

  it("returns null for an unknown node id", () => {
    expect(buildNodeDetail(fixture(["ev-a"]), "missing")).toBeNull();
  });

  /**
   * P3-020 / UC-03 acceptance: «كل حافة لها ملاحظة مصدرية» — every edge has a source note.
   * The projection edge carries its explanation; the detail model must carry it through to
   * the relation (it was dropped before P3-020 — this test was written red-first).
   */
  it("carries the edge's explanation (the source note) on each relation (P3-020)", () => {
    const out = must(buildNodeDetail(fixture(["ev-whois-1"]), N1));
    expect(out.relations).toHaveLength(1);
    expect(out.relations[0].explanation).toBe("test"); // the edge's explanation, verbatim
  });
});

describe("buildNodeDetail contradictions (P4-017 — الادعاءات المتناقضة)", () => {
  it("same predicate with two different values is ONE contradiction carrying both claims side by side", () => {
    const graph: Graph = {
      nodes: [
        node(N1, [
          { claimId: "c-a", predicate: "whois.registrar", value: "Example Registrar", confidence: 0.8, evidenceIds: ["ev-1"] },
          { claimId: "c-b", predicate: "whois.registrar", value: "Other Registrar", confidence: 0.6, evidenceIds: ["ev-2"] },
        ]),
        node(N2),
      ],
      edges: [],
    };
    const detail = buildNodeDetail(graph, N1);
    expect(detail).not.toBeNull();
    expect(detail?.contradictions).toHaveLength(1);
    const contradiction = detail?.contradictions[0];
    expect(contradiction?.predicate).toBe("whois.registrar");
    expect(contradiction?.claims.map((c) => c.value)).toEqual(["Example Registrar", "Other Registrar"]);
    expect(contradiction?.claims.map((c) => c.claimId)).toEqual(["c-a", "c-b"]);
    // كل طرف يحمل أدلته وثقته — لا يُخفى طرف لصالح آخر
    expect(contradiction?.claims[0]).toMatchObject({ confidence: 0.8, evidenceIds: ["ev-1"] });
    expect(contradiction?.claims[1]).toMatchObject({ confidence: 0.6, evidenceIds: ["ev-2"] });
  });

  it("same predicate with the SAME value twice is not a contradiction", () => {
    const graph: Graph = {
      nodes: [
        node(N1, [
          { claimId: "c-a", predicate: "whois.registrar", value: "Example Registrar", confidence: 0.8, evidenceIds: ["ev-1"] },
          { claimId: "c-b", predicate: "whois.registrar", value: "Example Registrar", confidence: 0.6, evidenceIds: ["ev-2"] },
        ]),
        node(N2),
      ],
      edges: [],
    };
    expect(buildNodeDetail(graph, N1)?.contradictions).toEqual([]);
  });

  it('different predicates are never contradictions, and number 7 is not string "7"', () => {
    const graph: Graph = {
      nodes: [
        node(N1, [
          { claimId: "c-a", predicate: "dns.ttl", value: 7, confidence: 0.8, evidenceIds: [] },
          { claimId: "c-b", predicate: "dns.ttl", value: "7", confidence: 0.6, evidenceIds: [] },
          { claimId: "c-c", predicate: "whois.registrar", value: "Example Registrar", confidence: 0.7, evidenceIds: [] },
          { claimId: "c-d", predicate: "whois.created", value: "2020-01-01", confidence: 0.7, evidenceIds: [] },
        ]),
        node(N2),
      ],
      edges: [],
    };
    const contradictions = buildNodeDetail(graph, N1)?.contradictions ?? [];
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]?.predicate).toBe("dns.ttl");
    expect(contradictions[0]?.claims.map((c) => c.value)).toEqual([7, "7"]);
  });

  it("relations (edges) with the same predicate to different targets are NOT contradictions", () => {
    const graph: Graph = {
      nodes: [node(N1), node(N2), { ...node("n3"), id: "n3", canonicalKey: "n3" }],
      edges: [
        {
          id: "e1",
          source: N1,
          target: N2,
          predicate: "resolves_to",
          confidence: 0.9,
          validFrom: null,
          validTo: null,
          explanation: "test",
          evidenceIds: [],
        },
        {
          id: "e2",
          source: N1,
          target: "n3",
          predicate: "resolves_to",
          confidence: 0.8,
          validFrom: null,
          validTo: null,
          explanation: "test",
          evidenceIds: [],
        },
      ],
    };
    expect(buildNodeDetail(graph, N1)?.contradictions).toEqual([]);
  });

  it("contradictions are ordered deterministically: predicate then claimId", () => {
    const graph: Graph = {
      nodes: [
        node(N1, [
          { claimId: "c-z", predicate: "zz.last", value: 1, confidence: 0.5, evidenceIds: [] },
          { claimId: "c-y", predicate: "aa.first", value: 1, confidence: 0.5, evidenceIds: [] },
          { claimId: "c-x", predicate: "aa.first", value: 2, confidence: 0.5, evidenceIds: [] },
          { claimId: "c-w", predicate: "zz.last", value: 2, confidence: 0.5, evidenceIds: [] },
        ]),
        node(N2),
      ],
      edges: [],
    };
    const contradictions = buildNodeDetail(graph, N1)?.contradictions ?? [];
    expect(contradictions.map((c) => c.predicate)).toEqual(["aa.first", "zz.last"]);
    expect(contradictions[0]?.claims.map((c) => c.claimId)).toEqual(["c-y", "c-x"]);
  });

  it("contradictions surface from a real Projector projection too, not just hand-built graphs", () => {
    const clock = manualClock("2026-10-22T08:00:00.000Z");
    const newId = ulidFactory(clock, seededRandom(11));
    const ledger = new Ledger({ actor: "analyst", clock });
    const append = (kind: Parameters<Ledger["append"]>[0], payload: unknown) => {
      clock.advance(1000);
      return ledger.append(kind, payload);
    };
    append("case.created", {
      id: newId(),
      createdAt: "2026-10-22T08:00:00.000Z",
      title: "قضية",
      purpose: "غرض التحقيق النظامي",
      legalBasis: "due_diligence",
    });
    const subject = newId();
    append("entity.added", { id: subject, type: "domain", canonicalKey: "domain:example.com", labels: { en: "example.com" }, props: {} });
    const claim = (value: string) =>
      append("claim.added", {
        id: newId(),
        subjectId: subject,
        predicate: "whois.registrar",
        value,
        validFrom: null,
        validTo: null,
        occurredFrom: null,
        occurredTo: null,
        confidence: 0.8,
        explanation: "اختبار تناقض",
      });
    claim("Example Registrar");
    claim("Other Registrar");
    const view = project(ledger.entries()).graph;
    const nodeId = view.nodes.find((n) => n.canonicalKey === "domain:example.com")?.id;
    expect(nodeId).toBeDefined();
    const contradictions = buildNodeDetail(view, nodeId ?? "")?.contradictions ?? [];
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]?.claims.map((c) => String(c.value)).sort()).toEqual(["Example Registrar", "Other Registrar"]);
  });
});
