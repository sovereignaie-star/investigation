import Graph from "graphology";
import type { Graph as ProjectionGraph, GraphEdge, GraphNode } from "@ir/ledger/projections";

/**
 * P3-005: the projection → graphology adapter and the deterministic bench generator.
 *
 * Adapter rules (owner's data model, ROADMAP 5.4):
 * - A graph edge is a **claim**, not a fact: parallel edges between the same endpoints are kept
 *   as distinct claims (multi-graph, keyed by the projection edge id) — deduplication must never
 *   discard separate claims.
 * - Nodes get deterministic circular INITIAL positions only; the real layout (ForceAtlas2 in a
 *   Web Worker) is P3-007.
 * - Colors are a deterministic palette per node type; labels fall back ar → en → id.
 *
 * The bench generator is the reproducible input for the NFR-02 measurement (10,000 nodes /
 * 20,000 edges ≥ 30fps on the reference device) — same seed, same graph.
 */

const PALETTE = ["#2563eb", "#7c3aed", "#0891b2", "#059669", "#ca8a04", "#ea580c", "#dc2626", "#db2777"] as const;

/** Deterministic small-string hash → palette index. */
function hashIndex(text: string, buckets: number): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return h % buckets;
}

export function typeColorOf(type: string): string {
  return PALETTE[hashIndex(type, PALETTE.length)];
}

function labelOf(node: GraphNode): string {
  return node.labels.ar ?? node.labels.en ?? node.id;
}

/** Edge width from the claim's confidence (0..1 → 0.5..2.5px — Sigma v3 pixel units).
 * Sigma v4 was measured 80–100× slower than v3 on the same 10k/20k workload (see WORKLOG) —
 * v3.0.3 is the renderer this adapter targets. */
function edgeSizeOf(confidence: number): number {
  const c = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  return 0.5 + 2 * c;
}

/** Node size in Sigma v3 pixels — smaller as the graph grows. */
function nodeSizeOf(total: number): number {
  if (total <= 100) return 8;
  if (total <= 1_000) return 6;
  return 5;
}

/** Deterministic mulberry32 PRNG (seeded) — no Math.random in the bench. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a graphology multi-graph from a ledger projection. Dangling edges are skipped. */
export function toGraphologyGraph(graph: ProjectionGraph): Graph {
  const g = new Graph({ multi: true });
  const total = graph.nodes.length;
  for (let i = 0; i < total; i += 1) {
    const node = graph.nodes[i];
    // Deterministic circular initial positions on the unit circle (layout is P3-007).
    const angle = total > 1 ? (2 * Math.PI * i) / total : 0;
    const radius = total > 1 ? 1 : 0;
    g.addNode(node.id, {
      label: labelOf(node),
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      size: nodeSizeOf(total),
      color: typeColorOf(node.type),
    });
  }
  for (const e of graph.edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    g.addEdgeWithKey(e.id, e.source, e.target, {
      label: e.predicate,
      size: edgeSizeOf(e.confidence),
      color: "#64748b",
    });
  }
  return g;
}

const BENCH_TYPES: Array<{ type: string; ar: string; en: string }> = [
  { type: "domain", ar: "اسم النطاق", en: "Domain" },
  { type: "ip_private", ar: "عنوان IP خاص", en: "Private IP" },
  { type: "email_corporate", ar: "بريد مؤسسي", en: "Corporate email" },
  { type: "phone_sa", ar: "هاتف سعودي", en: "Saudi phone" },
  { type: "gmail", ar: "جيميل", en: "Gmail" },
  { type: "ethereum_address", ar: "عنوان إيثيريوم", en: "Ethereum address" },
  { type: "twitter_username", ar: "اسم مستخدم", en: "Username" },
  { type: "wifi_ssid", ar: "شبكة لاسلكية", en: "Wi-Fi SSID" },
];

const BENCH_PREDICATES = ["resolves_to", "shares_registrant", "communicates_with", "links_to", "mentions"] as const;

/**
 * Deterministic synthetic graph for the NFR-02 workload. Default: 10,000 nodes / 20,000 edges.
 * Edges connect distinct existing nodes; every node has ≥1 edge in expectation.
 */
export function generateBenchGraph(nodeCount: number, edgeCount: number, seed = 42): ProjectionGraph {
  const rng = mulberry32(seed);
  const nodes: GraphNode[] = [];
  for (let i = 0; i < nodeCount; i += 1) {
    const t = BENCH_TYPES[Math.floor(rng() * BENCH_TYPES.length)];
    nodes.push({
      id: `n${i}`,
      type: t.type,
      canonicalKey: `n${i}`,
      labels: { ar: t.ar, en: t.en },
      props: {},
      aliases: [],
      attributes: [],
      observations: { positive: 0, negative: 0, error: 0 },
      evidenceIds: [],
    });
  }
  const edges: GraphEdge[] = [];
  for (let i = 0; i < edgeCount; i += 1) {
    const source = Math.floor(rng() * nodeCount);
    let target = Math.floor(rng() * nodeCount);
    if (target === source) target = (target + 1) % nodeCount;
    edges.push({
      id: `e${i}`,
      source: `n${source}`,
      target: `n${target}`,
      predicate: BENCH_PREDICATES[Math.floor(rng() * BENCH_PREDICATES.length)],
      confidence: 0.3 + 0.65 * rng(),
      validFrom: null,
      validTo: null,
      explanation: "bench-synthetic-claim",
      evidenceIds: [],
    });
  }
  return { nodes, edges };
}
