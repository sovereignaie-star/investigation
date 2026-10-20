import type { Graph as ProjectionGraph } from "@ir/ledger/projections";

/**
 * P3-021: the branch of a node — its descendant closure over outgoing edges. A
 * cycle-safe BFS from the target collects the node itself plus every node reachable
 * from it through directed edges; nodes shared with other branches (in-degree from
 * elsewhere) are still part of THIS branch's closure — the removal that uses this
 * set is reversible view state («إظهار كل العقد» restores everything), so an
 * over-approximation costs one command, while an under-approximation would remove a
 * node's descendants without removing it.
 */
export function branchClosure(graph: ProjectionGraph, nodeId: string): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }
  const seen = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return [...seen];
}
