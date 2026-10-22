#!/usr/bin/env python3
"""P4-011/P4-018 — frozen NetworkX reference for the graph analytics module.

Generates `fixtures/graph/networkx-reference.json`: a deterministic seeded
graph (LCG, no external randomness) plus the NetworkX 3.7 results for every
analytic the module must match (degree / betweenness / closeness centrality,
PageRank, semi-synchronous label-propagation communities, shortest paths;
P4-018 adds cut vertices, bridges and bounded-length all simple paths).

The committed fixture is the reference of record; re-running this script must
reproduce it byte-for-byte (checked by the test suite). The raw edge list in
the fixture deliberately contains one self-loop and one duplicate edge: the
normalization contract (drop self-loops, deduplicate, ignore unknown
endpoints) is exercised against the reference, which is computed on the
cleaned simple graph.

Usage: python3 tools/graph/networkx_reference.py [--check]
  --check  verify the committed fixture matches a fresh computation (exit 1)
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "fixtures" / "graph" / "networkx-reference.json"

# Deterministic LCG (glibc constants) — no external randomness anywhere.
_SEED = 20261022
_state = _SEED


def rand() -> float:
    """Next LCG step, mapped to [0, 1)."""
    global _state
    _state = (1103515245 * _state + 12345) % (1 << 31)
    return _state / (1 << 31)


def build_graph():
    """45 nodes in 3 planted communities of 15, plus one isolated node."""
    nodes = [f"n{i:02d}" for i in range(45)]
    # Isolated node appended last: exercises degree/closeness 0, its own
    # single-node community, and the dangling-node PageRank path.
    nodes.append("n45")
    edges = []
    for i in range(45):
        for j in range(i + 1, 45):
            same = i // 15 == j // 15
            p = 0.50 if same else 0.015
            if rand() < p:
                edges.append([nodes[i], nodes[j]])
    # Raw input pollution (normalization contract): one duplicate edge and
    # one self-loop. Expected values are computed on the cleaned graph.
    if edges:
        edges.append(list(edges[0]))
    edges.append(["n00", "n00"])
    return nodes, edges


def clean(nodes, edges):
    """The module's normalization: drop self-loops, dedupe, keep order."""
    known = set(nodes)
    seen = set()
    kept = []
    for a, b in edges:
        if a == b or a not in known or b not in known:
            continue
        key = (a, b) if a < b else (b, a)
        if key in seen:
            continue
        seen.add(key)
        kept.append([a, b])
    return kept


def main():
    import networkx as nx

    nodes, raw_edges = build_graph()
    edges = clean(nodes, raw_edges)

    G = nx.Graph()
    G.add_nodes_from(nodes)
    G.add_edges_from(edges)

    # --- Analytics the TS module must reproduce ---
    degree = nx.degree_centrality(G)
    betweenness = nx.betweenness_centrality(G, normalized=True)
    closeness = nx.closeness_centrality(G, wf_improved=True)
    pagerank = nx.pagerank(G, alpha=0.85, max_iter=100, tol=1e-06)
    communities = [sorted(c) for c in nx.community.label_propagation_communities(G)]
    communities.sort()

    # P4-018: bounded-length all simple paths on the main reference graph.
    simple_pairs = [("n00", "n22"), ("n07", "n31"), ("n15", "n44"), ("n00", "n45")]
    simple_paths = [
        {"source": a, "target": b, "cutoff": 4, "paths": sorted(nx.all_simple_paths(G, a, b, cutoff=4))}
        for a, b in simple_pairs
    ]

    # P4-018: a dedicated deterministic graph for cut vertices and bridges — the
    # dense main graph has none, so this one is built to have both: two K5 cliques
    # joined by a single bridge, a 3-node chain hanging off one clique (its edges
    # are bridges and its inner nodes are cut vertices), plus one isolated node.
    p18_nodes = [f"a{i}" for i in range(5)] + [f"b{i}" for i in range(5)] + [f"c{i}" for i in range(3)] + ["iso"]
    p18_edges = (
        [[f"a{i}", f"a{j}"] for i in range(5) for j in range(i + 1, 5)]
        + [[f"b{i}", f"b{j}"] for i in range(5) for j in range(i + 1, 5)]
        + [["a0", "b0"], ["a1", "c0"], ["c0", "c1"], ["c1", "c2"]]
    )
    H = nx.Graph()
    H.add_nodes_from(p18_nodes)
    H.add_edges_from(p18_edges)
    p18 = {
        "nodes": p18_nodes,
        "edges": p18_edges,
        "expected": {
            "articulationPoints": sorted(nx.articulation_points(H)),
            "bridges": sorted(list(sorted((u, v))) for u, v in nx.bridges(H)),
            "allSimplePaths": [
                {"source": a, "target": b, "cutoff": k, "paths": sorted(nx.all_simple_paths(H, a, b, cutoff=k))}
                for a, b, k in [("a2", "b2", 5), ("a2", "c2", 6), ("a2", "iso", 3)]
            ],
        },
    }

    sources = ["n00", "n07", "n23", "n45"]
    lengths = {s: nx.shortest_path_length(G, s) for s in sources}
    pairs = [("n00", "n22"), ("n07", "n31"), ("n15", "n44"), ("n02", "n45"), ("n23", "n07")]
    paths = [
        {
            "source": s,
            "target": t,
            "path": nx.shortest_path(G, s, t) if nx.has_path(G, s, t) else None,
        }
        for s, t in pairs
    ]

    fixture = {
        "generator": "tools/graph/networkx_reference.py",
        "seed": _SEED,
        "networkx_version": nx.__version__,
        "nodes": nodes,
        "edges": raw_edges,
        "expected": {
            "degreeCentrality": degree,
            "betweennessCentrality": betweenness,
            "closenessCentrality": closeness,
            "pageRank": pagerank,
            "communities": communities,
            "shortestPathLengths": lengths,
            "shortestPaths": paths,
            "allSimplePaths": simple_paths,
        },
        "p4018": p18,
    }

    if "--check" in sys.argv:
        committed = json.loads(OUT.read_text(encoding="utf-8"))
        if committed != fixture:
            print("networkx reference fixture is stale", file=sys.stderr)
            return 1
        print("networkx reference fixture is up to date")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(nodes)} nodes, {len(edges)} clean edges)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
