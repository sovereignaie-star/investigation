import type { InvestigationEdge, InvestigationStats, SmartInvestigatorCallbacks } from "../types";
import { IDENTIFIER_LIST } from "./identifierList";
import { fetchIdentifier, buildNode, detectType } from "./resultFetcher";
import { canonicalKey, NormalizeError } from "@ir/core";
import { detect } from "@ir/core/identifiers";

let stopFlag = false;

/** Ranked candidates (P1-006): the investigator follows the best one; the rest remain available to the UI. */
export function detectAll(value: string, context?: string) {
  const byId = new Map(IDENTIFIER_LIST.map((t) => [t.id, t]));
  return detect(value, { context }).flatMap((c) => {
    const t = byId.get(c.type);
    return t ? [{ ...t, score: c.score, validated: c.validated }] : [];
  });
}

/**
 * Node id = canonical key (P1-007): full normalized value, so "Example.com" and "example.com" are one node (D-020)
 * and long or symbol-heavy values never collide (D-021). Values that fail their detected type fall back to "text".
 */
export function makeNodeId(value: string, type: string) {
  try {
    return canonicalKey(type, value);
  } catch (err) {
    if (err instanceof NormalizeError) return canonicalKey("text", value);
    throw err;
  }
}

function makeEdgeId(source: string, target: string) {
  return `edge:${source}--${target}`;
}

export const smartInvestigator = {
  stop() {
    stopFlag = true;
  },

  async investigate(rootValue: string, callbacks: SmartInvestigatorCallbacks, maxDepth = 3, maxNodes = 50) {
    stopFlag = false;
    const visited = new Set<string>();
    const stats: InvestigationStats = {
      nodeCount: 0,
      edgeCount: 0,
      maxDepth: 0,
      errorCount: 0,
      elapsed: 0,
      identifierTypes: {},
      status: "investigating",
    };
    const startTime = Date.now();

    const queue: Array<{ value: string; depth: number; parentId?: string }> = [{ value: rootValue.trim(), depth: 0, parentId: undefined }];

    while (queue.length > 0 && !callbacks.shouldStop() && !stopFlag) {
      if (stats.nodeCount >= maxNodes) break;

      const item = queue.shift();
      if (!item) break;
      const { value, depth, parentId } = item;

      if (depth > maxDepth) continue;

      const identifierTypeId = detectType(value);

      // D-020: dedupe on the canonical key, not the raw string.
      const nodeId = makeNodeId(value, identifierTypeId);
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      try {
        const result = await fetchIdentifier(value, identifierTypeId);
        const node = buildNode(nodeId, value, identifierTypeId, result, depth, parentId);

        callbacks.onNodeFetched(node);
        stats.nodeCount++;
        stats.maxDepth = Math.max(stats.maxDepth, depth);
        stats.identifierTypes[identifierTypeId] = (stats.identifierTypes[identifierTypeId] || 0) + 1;

        if (node.error) stats.errorCount++;

        if (parentId) {
          const edge: InvestigationEdge = {
            id: makeEdgeId(parentId, nodeId),
            source: parentId,
            target: nodeId,
            animated: true,
          };
          callbacks.onEdgeAdded(edge);
          stats.edgeCount++;
        }

        stats.elapsed = Date.now() - startTime;
        callbacks.onProgress({ ...stats });

        if (depth < maxDepth && result.childIdentifiers) {
          for (const child of result.childIdentifiers) {
            if (!visited.has(makeNodeId(child.value, child.type))) {
              queue.push({ value: child.value, depth: depth + 1, parentId: nodeId });
            }
          }
        }
      } catch (err) {
        stats.errorCount++;
        callbacks.onError(nodeId, String(err));
      }

      await new Promise((r) => setTimeout(r, 150));
    }

    stats.elapsed = Date.now() - startTime;
    stats.status = stopFlag ? "stopped" : "done";
    callbacks.onComplete({ ...stats });
  },
};
