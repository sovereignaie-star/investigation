import type { Graph } from "@ir/ledger/projections";

/**
 * P3-008: the pure model behind the node detail panel. The panel shows a node's
 * claims (attributes and relations) and — the acceptance criterion, "كل حقل
 * يحيل إلى دليل" — each claim carries the evidence ids recorded against it in
 * the projection (@ir/ledger graphView). A claim with no observation stays
 * evidence-less: the panel says so honestly; it never invents a link.
 */

export interface NodeDetailAttribute {
  claimId: string;
  predicate: string;
  value: string | number | boolean;
  confidence: number;
  evidenceIds: string[];
}

export interface NodeDetailRelation {
  edgeId: string;
  predicate: string;
  /** "out" = the selected node is the source, "in" = it is the target. */
  direction: "out" | "in";
  otherId: string;
  otherLabel: string;
  confidence: number;
  /** P3-020 / UC-03: the edge's source note («كل حافة لها ملاحظة مصدرية») — verbatim. */
  explanation: string | null;
  evidenceIds: string[];
}

/**
 * P4-017 — one contradiction: claims on the SAME predicate of this node with
 * DIFFERENT literal values, shown side by side (المناقض ظاهر جنباً إلى جنب). Each
 * side keeps its own confidence and evidence ids — no side is hidden for the other
 * (ADR-12: contradictions are displayed, never subtracted). Relations to different
 * targets under one predicate are NOT contradictions (multiple targets are legal).
 */
export interface NodeDetailContradiction {
  predicate: string;
  claims: NodeDetailAttribute[];
}

export interface NodeDetail {
  id: string;
  type: string;
  label: string;
  canonicalKey: string;
  aliases: string[];
  observations: { positive: number; negative: number; error: number };
  attributes: NodeDetailAttribute[];
  relations: NodeDetailRelation[];
  /** P4-017: the node's conflicting claims, one group per predicate. */
  contradictions: NodeDetailContradiction[];
  evidenceIds: string[];
}

/** P4-017: groups the node's literal claims by predicate; a group with more than one
 * distinct value is a contradiction. JSON keys keep 7 and "7" distinct (no type guessing). */
function contradictionsOf(attributes: readonly NodeDetailAttribute[]): NodeDetailContradiction[] {
  const byPredicate = new Map<string, NodeDetailAttribute[]>();
  for (const a of attributes) {
    const list = byPredicate.get(a.predicate) ?? [];
    list.push(a);
    byPredicate.set(a.predicate, list);
  }
  return [...byPredicate.entries()]
    .filter(([, list]) => new Set(list.map((a) => JSON.stringify(a.value))).size > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([predicate, claims]) => ({ predicate, claims }));
}

function labelOf(labels: { ar?: string; en?: string }, fallback: string): string {
  return labels.ar ?? labels.en ?? fallback;
}

export function buildNodeDetail(graph: Graph, nodeId: string): NodeDetail | null {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const labelOfId = (id: string): string => {
    const other = graph.nodes.find((n) => n.id === id);
    return other ? labelOf(other.labels, other.canonicalKey) : id;
  };
  const relations: NodeDetailRelation[] = graph.edges
    .filter((e) => e.source === nodeId || e.target === nodeId)
    .map((e) => {
      const direction = e.source === nodeId ? "out" : "in";
      const otherId = direction === "out" ? e.target : e.source;
      return {
        edgeId: e.id,
        predicate: e.predicate,
        direction,
        otherId,
        otherLabel: labelOfId(otherId),
        // P3-020 / UC-03: the source note travels with the relation — never invented
        explanation: e.explanation ?? null,
        confidence: e.confidence,
        evidenceIds: e.evidenceIds,
      };
    });
  return {
    id: node.id,
    type: node.type,
    label: labelOf(node.labels, node.canonicalKey),
    canonicalKey: node.canonicalKey,
    aliases: node.aliases,
    observations: node.observations,
    attributes: node.attributes,
    relations,
    contradictions: contradictionsOf(node.attributes),
    evidenceIds: node.evidenceIds,
  };
}

/** The evidence record under examination: which claims in the graph cite it. */
export interface EvidenceDetail {
  evidenceId: string;
  /** Claims citing this evidence: attributes and relations, with their node labels. */
  citedBy: { predicate: string; nodeLabel: string }[];
}

export function buildEvidenceDetail(graph: Graph, evidenceId: string): EvidenceDetail | null {
  const citedBy: EvidenceDetail["citedBy"] = [];
  for (const n of graph.nodes) {
    const label = labelOf(n.labels, n.canonicalKey);
    for (const a of n.attributes) {
      if (a.evidenceIds.includes(evidenceId)) citedBy.push({ predicate: a.predicate, nodeLabel: label });
    }
  }
  for (const e of graph.edges) {
    if (!e.evidenceIds.includes(evidenceId)) continue;
    for (const side of [e.source, e.target]) {
      const other = side === e.source ? e.target : e.source;
      citedBy.push({ predicate: e.predicate, nodeLabel: labelOfId(graph, other) });
    }
  }
  if (citedBy.length === 0) return null;
  return { evidenceId, citedBy };
}

function labelOfId(graph: Graph, id: string): string {
  const other = graph.nodes.find((n) => n.id === id);
  return other ? labelOf(other.labels, other.canonicalKey) : id;
}
