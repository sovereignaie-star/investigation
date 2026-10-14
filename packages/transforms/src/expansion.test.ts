/**
 * P2-023 — expansion strategies (T-EXP): BFS / DFS / priority ordering, depth /
 * node / time / cost limits, custom stop rules, dedup, and deterministic
 * integration with `@ir/sim` (P2-008). No external connections. Lives in
 * `@ir/transforms` (P2-033) so `@ir/engine` keeps no test-only edge back to
 * its dependants (that edge made the workspace graph cyclic).
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim";
import { defineTransform } from "./manifest.ts";
import { runTransform } from "./runner.ts";
import { ExpansionEngine, defaultExpand, defaultScore, type ExpansionNode, type Finding } from "@ir/engine/expansion";

const MANIFEST = {
  id: "TR-999",
  version: "1.0.0",
  inputs: ["url"],
  outputs: ["http_response"],
  network: { mode: "public", allow: [] },
  secrets: [],
  limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 },
  sensitivity: "normal",
  license: "LC-B",
};

/** A transform that returns one finding per link in the page body. */
function linkTransform() {
  return defineTransform<{ url: string }>(MANIFEST, async (input, ctx) => {
    const res = await ctx.http.get(input.url);
    const links = (res.body.match(/href="([^"]+)"/g) ?? []).map((m) => m.slice(6, -1));
    return {
      findings: links.map((href, i) => ({
        predicate: "links_to",
        objectType: "url",
        objectValue: href,
        confidence: 1,
        explanation: `link ${i} from ${input.url}`,
      })),
    };
  });
}

/** A sim world: each page lists its children as hrefs. */
function linkWorld(pages: Record<string, string[]>): ReturnType<typeof createSimServer> {
  return createSimServer(
    Object.entries(pages).map(([url, children]) => ({
      match: url,
      response: { status: 200, body: children.map((c) => `<a href="${c}">x</a>`).join("") },
    })),
  );
}

function node(id: string, depth: number, extra: Partial<ExpansionNode> = {}): ExpansionNode {
  return { id, kind: "url", canonicalInput: id, depth, ...extra };
}

/** Executor that runs the real transform against a sim transport. */
function simExecutor(sim: ReturnType<typeof createSimServer>) {
  return {
    async run(n: ExpansionNode): Promise<Finding[]> {
      const result = await runTransform(linkTransform(), { transport: sim.transport, input: { url: n.canonicalInput } });
      return result.output.findings;
    },
  };
}

const limits = { maxDepth: 3, maxNodes: 100, maxCostEstimate: 1_000, maxElapsedMs: 5_000 };

describe("T-EXP strategy ordering", () => {
  it("bfs expands breadth-first: all depth-1 nodes before any depth-2 node", async () => {
    const sim = linkWorld({
      "https://sim.test/root": ["https://sim.test/a", "https://sim.test/b"],
      "https://sim.test/a": ["https://sim.test/a1"],
      "https://sim.test/b": ["https://sim.test/b1"],
      "https://sim.test/a1": [],
      "https://sim.test/b1": [],
    });
    const engine = new ExpansionEngine({ strategy: "bfs", limits, executor: simExecutor(sim) });
    const res = await engine.run(node("https://sim.test/root", 0));
    const depths = res.visited.map((n) => n.depth);
    // BFS: 0, then 1,1, then 2,2
    expect(depths).toEqual([0, 1, 1, 2, 2]);
    expect(res.nodesExpanded).toBe(5);
    expect(res.stopped).toBe(false);
  });

  it("dfs expands depth-first: the newest child is expanded before its siblings", async () => {
    const sim = linkWorld({
      "https://sim.test/root": ["https://sim.test/a", "https://sim.test/b"],
      "https://sim.test/a": ["https://sim.test/a1"],
      "https://sim.test/b": ["https://sim.test/b1"],
      "https://sim.test/a1": [],
      "https://sim.test/b1": [],
    });
    const engine = new ExpansionEngine({ strategy: "dfs", limits, executor: simExecutor(sim) });
    const res = await engine.run(node("https://sim.test/root", 0));
    const order = res.visited.map((n) => n.id);
    // DFS: root, then a (last pushed child of root is b, but a was pushed first and
    // LIFO pops the last pushed... actually root pushes a then b; LIFO pops b first).
    // root -> b -> b1 -> a -> a1
    expect(order[0]).toBe("https://sim.test/root");
    expect(order[1]).toBe("url:https://sim.test/b");
    expect(order[2]).toBe("url:https://sim.test/b1");
    expect(order[3]).toBe("url:https://sim.test/a");
    expect(order[4]).toBe("url:https://sim.test/a1");
  });

  it("priority expands by value per cost: high-value cheap nodes first", async () => {
    const sim = linkWorld({
      "https://sim.test/root": ["https://sim.test/low", "https://sim.test/high"],
      "https://sim.test/low": [],
      "https://sim.test/high": [],
    });
    const engine = new ExpansionEngine({
      strategy: "priority",
      limits,
      executor: simExecutor(sim),
      expand: (f, parent) => {
        const child = defaultExpand(f, parent);
        if (!child) return null;
        // high-value node: confidence 1, cheap; low-value: confidence 0.1, expensive
        const high = child.canonicalInput === "https://sim.test/high";
        return { ...child, typeValue: high ? 1 : 0.1, transformCost: high ? 1 : 10 };
      },
    });
    const res = await engine.run(node("https://sim.test/root", 0));
    expect(res.visited[1].id).toBe("url:https://sim.test/high");
    expect(res.visited[2].id).toBe("url:https://sim.test/low");
  });
});

describe("T-EXP limits and stop rules", () => {
  it("dedups: a node discovered from several parents is expanded once", async () => {
    const sim = linkWorld({
      "https://sim.test/root": ["https://sim.test/a", "https://sim.test/b"],
      "https://sim.test/a": ["https://sim.test/shared"],
      "https://sim.test/b": ["https://sim.test/shared"],
      "https://sim.test/shared": [],
    });
    const engine = new ExpansionEngine({ strategy: "bfs", limits, executor: simExecutor(sim) });
    const res = await engine.run(node("https://sim.test/root", 0));
    const shared = res.visited.filter((n) => n.id === "url:https://sim.test/shared");
    expect(shared).toHaveLength(1);
    expect(res.nodesExpanded).toBe(4);
  });

  it("maxDepth: nodes deeper than the cap are leaves, never expanded", async () => {
    const sim = linkWorld({
      "https://sim.test/root": ["https://sim.test/a"],
      "https://sim.test/a": ["https://sim.test/b"],
      "https://sim.test/b": ["https://sim.test/c"],
      "https://sim.test/c": [],
    });
    const engine = new ExpansionEngine({
      strategy: "bfs",
      limits: { ...limits, maxDepth: 1 },
      executor: simExecutor(sim),
    });
    const res = await engine.run(node("https://sim.test/root", 0));
    // root (0) and a (1) expanded; b (2) is visited as a leaf but never expanded.
    expect(res.nodesExpanded).toBe(2);
    expect(res.visited.map((n) => n.id)).toEqual(["https://sim.test/root", "url:https://sim.test/a", "url:https://sim.test/b"]);
  });

  it("maxNodes: stops expanding once the global node cap is reached", async () => {
    const sim = linkWorld({
      "https://sim.test/root": ["https://sim.test/a", "https://sim.test/b", "https://sim.test/c"],
      "https://sim.test/a": [],
      "https://sim.test/b": [],
      "https://sim.test/c": [],
    });
    const engine = new ExpansionEngine({
      strategy: "bfs",
      limits: { ...limits, maxNodes: 2 },
      executor: simExecutor(sim),
    });
    const res = await engine.run(node("https://sim.test/root", 0));
    expect(res.nodesExpanded).toBe(2);
    expect(res.stopped).toBe(true);
    expect(res.stopReason).toBe("nodes");
  });

  it("maxCostEstimate: stops when the cumulative cost would exceed the cap", async () => {
    const sim = linkWorld({
      "https://sim.test/root": ["https://sim.test/a"],
      "https://sim.test/a": [],
    });
    const engine = new ExpansionEngine({
      strategy: "bfs",
      limits: { ...limits, maxCostEstimate: 5 },
      executor: simExecutor(sim),
      expand: (f, parent) => {
        const child = defaultExpand(f, parent);
        return child ? { ...child, costEstimate: 4 } : null;
      },
    });
    const res = await engine.run(node("https://sim.test/root", 0, { costEstimate: 4 }));
    // root costs 4 (<=5), child would push total to 8 (>5) → stop.
    expect(res.nodesExpanded).toBe(1);
    expect(res.stopped).toBe(true);
    expect(res.stopReason).toBe("cost");
  });

  it("maxElapsedMs: stops when the injectable clock passes the time cap", async () => {
    let t = 0;
    const sim = linkWorld({
      "https://sim.test/root": ["https://sim.test/a"],
      "https://sim.test/a": [],
    });
    const origRun = simExecutor(sim).run;
    const engine = new ExpansionEngine({
      strategy: "bfs",
      limits: { ...limits, maxElapsedMs: 10 },
      executor: {
        async run(n) {
          const out = await origRun(n);
          t = 100; // the next loop iteration sees elapsed > cap
          return out;
        },
      },
      now: () => t,
    });
    const res = await engine.run(node("https://sim.test/root", 0));
    expect(res.nodesExpanded).toBe(1);
    expect(res.stopped).toBe(true);
    expect(res.stopReason).toBe("time");
  });

  it("custom stop rule halts expansion", async () => {
    const sim = linkWorld({
      "https://sim.test/root": ["https://sim.test/a", "https://sim.test/b"],
      "https://sim.test/a": [],
      "https://sim.test/b": [],
    });
    const engine = new ExpansionEngine({
      strategy: "bfs",
      limits,
      executor: simExecutor(sim),
      stop: (ctx) => ctx.nodesExpanded >= 1,
    });
    const res = await engine.run(node("https://sim.test/root", 0));
    expect(res.nodesExpanded).toBe(1);
    expect(res.stopped).toBe(true);
    expect(res.stopReason).toBe("stop-rule");
  });

  it("cancellation aborts expansion", async () => {
    const sim = linkWorld({
      "https://sim.test/root": ["https://sim.test/a"],
      "https://sim.test/a": [],
    });
    const engine = new ExpansionEngine({ strategy: "bfs", limits, executor: simExecutor(sim) });
    const ac = new AbortController();
    ac.abort();
    const res = await engine.run(node("https://sim.test/root", 0), ac.signal);
    expect(res.nodesExpanded).toBe(0);
    expect(res.stopped).toBe(true);
    expect(res.stopReason).toBe("cancelled");
  });

  it("rejects invalid limits", () => {
    expect(
      () =>
        new ExpansionEngine({
          strategy: "bfs",
          limits: { ...limits, maxNodes: -1 },
          executor: simExecutor(linkWorld({})),
        }),
    ).toThrow(RangeError);
  });
});

describe("T-EXP scoring", () => {
  it("defaultScore is value per unit of cost", () => {
    expect(defaultScore({ id: "a", kind: "k", canonicalInput: "a", depth: 0, typeValue: 1, transformCost: 0 })).toBe(1);
    expect(defaultScore({ id: "b", kind: "k", canonicalInput: "b", depth: 0, typeValue: 1, transformCost: 1 })).toBe(0.5);
    expect(defaultScore({ id: "c", kind: "k", canonicalInput: "c", depth: 0 })).toBe(0);
  });
});
