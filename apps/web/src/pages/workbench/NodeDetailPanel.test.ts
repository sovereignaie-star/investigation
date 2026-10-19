import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Graph, GraphNode } from "@ir/ledger/projections";

import { NodeDetailPanel } from "./NodeDetailPanel";
import { buildEvidenceDetail, buildNodeDetail } from "./nodeDetailModel";

/**
 * P3-008 acceptance (ROADMAP 6.4, literal): "كل حقل يحيل إلى دليل" — in the
 * rendered panel every claim row (attribute or relation) exposes its evidence as
 * usable links, and an evidence-less claim says so honestly. Rendering is checked
 * headlessly via static markup (the app's established web test pattern, P3-002/P3-007);
 * the panel is presentational, so the store wiring is not needed here (zustand's
 * server snapshot is the initial state, which would hide the selection anyway).
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
    observations: { positive: 3, negative: 1, error: 0 },
    evidenceIds: ["ev-node"],
  };
}

const GRAPH: Graph = {
  nodes: [
    node("n1", [
      {
        claimId: "c-registrar",
        predicate: "whois.registrar",
        value: "Example Registrar",
        confidence: 0.8,
        evidenceIds: ["ev-whois-1", "ev-whois-2"],
      },
      { claimId: "c-created", predicate: "whois.created", value: "2020-01-01", confidence: 0.7, evidenceIds: [] },
    ]),
    node("n2"),
  ],
  edges: [
    {
      id: "e-resolves",
      source: "n1",
      target: "n2",
      predicate: "dns.a",
      confidence: 0.9,
      validFrom: null,
      validTo: null,
      explanation: "test",
      evidenceIds: ["ev-edge"],
    },
  ],
};

const noop = () => {};

function panel(graph: Graph, nodeId: string | null, evidenceId?: string | null): string {
  const detail = nodeId ? buildNodeDetail(graph, nodeId) : null;
  const evidenceDetail = evidenceId ? buildEvidenceDetail(graph, evidenceId) : null;
  return renderToStaticMarkup(
    React.createElement(NodeDetailPanel, { detail, evidenceDetail, onSelectEvidence: noop, onCloseEvidence: noop }),
  );
}

describe("NodeDetailPanel (P3-008)", () => {
  it("renders the node header: label, type, canonical key and aliases", () => {
    const html = panel(GRAPH, "n1");
    expect(html).toContain("عقدة n1");
    expect(html).toContain("domain");
    expect(html).toContain("n1");
  });

  it("renders every attribute with its evidence as links (كل حقل يحيل إلى دليل)", () => {
    const html = panel(GRAPH, "n1");
    expect(html).toContain("whois.registrar");
    expect(html).toContain("Example Registrar");
    // each evidence id of the registrar claim appears as a link
    expect(html).toMatch(/data-testid="evidence-link"[^>]*>[^<]*ev-whois-1/);
    expect(html).toMatch(/data-testid="evidence-link"[^>]*>[^<]*ev-whois-2/);
  });

  it("says honestly when a claim has no evidence — لا دليل مسجل", () => {
    const html = panel(GRAPH, "n1");
    expect(html).toContain("لا دليل مسجل");
  });

  it("renders relations with predicate, other node label and evidence links", () => {
    const html = panel(GRAPH, "n2");
    expect(html).toContain("dns.a");
    expect(html).toContain("عقدة n1");
    expect(html).toMatch(/data-testid="evidence-link"[^>]*>[^<]*ev-edge/);
  });

  it("shows the evidence under examination with the claims that cite it (evidence-detail region)", () => {
    const html = panel(GRAPH, "n1", "ev-whois-1");
    // assert the evidence-detail region itself, not text that the plain panel already contains
    const region = html.match(/<div[^>]*data-testid="evidence-detail"[^>]*>([\s\S]*?)<\/aside>/);
    expect(region).not.toBeNull();
    expect(region?.[1]).toContain("ev-whois-1");
    expect(region?.[1]).toContain("whois.registrar"); // the claim citing it
    // without a selected evidence, the region is absent
    const noEvidence = panel(GRAPH, "n1");
    expect(noEvidence).not.toContain('data-testid="evidence-detail"');
  });

  it("renders the confidence of every claim (attributes and relations) beside it", () => {
    const html = panel(GRAPH, "n1");
    // each attribute row shows its own confidence, no invented node-level aggregate
    expect(html).toMatch(/data-testid="claim-confidence"[^>]*>[^<]*0\.8/);
    expect(html).toMatch(/data-testid="claim-confidence"[^>]*>[^<]*0\.7/);
    const rel = panel(GRAPH, "n2");
    expect(rel).toMatch(/data-testid="claim-confidence"[^>]*>[^<]*0\.9/);
  });

  it("renders nothing when no node is selected", () => {
    const html = panel(GRAPH, null);
    expect(html).toBe("");
  });
});
