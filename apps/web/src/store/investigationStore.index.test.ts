import { afterEach, describe, expect, it } from "vitest";
import type { InvestigationEdge, InvestigationNode } from "../types";
import { useInvestigationStore as store } from "./investigationStore";

const node = (id: string, depth = 0, identifierType = "email"): InvestigationNode => ({
  id,
  type: "text",
  identifier: id,
  identifierType,
  value: id,
  label: id,
  data: {},
  metadata: {},
  status: "pending",
  position: { x: 0, y: 0 },
  depth,
  timestamp: 0,
});
const edge = (id: string, source = "a", target = "b"): InvestigationEdge => ({ id, source, target });

afterEach(() => store.getState().clearInvestigation());

describe("P1-022: id indexes in the view store (D-034)", () => {
  it("batch adds equal the same single adds: duplicates skipped, first wins, stats counted once", () => {
    const items = [node("a", 0), node("b", 2, "domain"), node("a", 5, "ipv4"), node("c", 1), node("b", 9)];
    const s = store.getState();
    for (const n of items) s.addNode(n);
    s.addEdge(edge("e1"));
    s.addEdge(edge("e1", "x", "y"));
    const single = store.getState();
    s.clearInvestigation();
    s.addNodes(items);
    s.addEdges([edge("e1"), edge("e1", "x", "y")]);
    const batch = store.getState();
    expect(batch.nodes).toEqual(single.nodes);
    expect(batch.edges).toEqual(single.edges);
    expect(batch.stats).toEqual(single.stats);
    expect(batch.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(batch.nodes[0]?.depth).toBe(0);
    expect(batch.stats).toMatchObject({ nodeCount: 3, edgeCount: 1, maxDepth: 2, identifierTypes: { email: 2, domain: 1 } });
  });

  it("an add that changes nothing keeps the same state (no re-render)", () => {
    const s = store.getState();
    s.addNodes([node("a")]);
    const before = store.getState();
    s.addNode(node("a"));
    s.addNodes([]);
    s.updateNode("missing", { status: "error" });
    expect(store.getState()).toBe(before);
  });

  it("updateNode finds the node by index and keeps the index valid for later adds", () => {
    const s = store.getState();
    s.addNodes([node("a"), node("b")]);
    s.updateNode("b", { status: "error", error: "timeout" });
    s.addNode(node("b"));
    s.addNode(node("c"));
    s.updateNode("c", { status: "done" });
    const { nodes } = store.getState();
    expect(nodes.map((n) => [n.id, n.status])).toEqual([
      ["a", "pending"],
      ["b", "error"],
      ["c", "done"],
    ]);
  });

  it("the index follows arrays replaced outside the store's own appends (load, setState)", () => {
    const s = store.getState();
    s.addNodes([node("a"), node("b")]);
    s.loadInvestigation([node("x"), node("y")], [edge("ex")], { ...store.getState().stats, nodeCount: 2, edgeCount: 1 });
    s.addNode(node("a")); // "a" is not in the loaded case any more
    s.addNode(node("x")); // "x" is
    s.addEdge(edge("ex"));
    expect(store.getState().nodes.map((n) => n.id)).toEqual(["x", "y", "a"]);
    expect(store.getState().edges).toHaveLength(1);
    store.setState({ nodes: [node("z")] });
    s.updateNode("z", { label: "zed" });
    s.addNode(node("z"));
    expect(store.getState().nodes).toEqual([{ ...node("z"), label: "zed" }]);
  });

  it("acceptance: 100,000 nodes and 99,999 edges added in batches in under 2 s", () => {
    const s = store.getState();
    const t = performance.now();
    for (let i = 0; i < 100_000; i += 1000) {
      s.addNodes(Array.from({ length: 1000 }, (_, k) => node(`n${i + k}`, (i + k) % 7)));
      s.addEdges(Array.from({ length: 1000 }, (_, k) => edge(`e${i + k}`, `n${i + k - 1}`, `n${i + k}`)).filter((e) => e.id !== "e0"));
    }
    const ms = performance.now() - t;
    const st = store.getState();
    expect(st.nodes).toHaveLength(100_000);
    expect(st.edges).toHaveLength(99_999);
    expect(st.stats).toMatchObject({ nodeCount: 100_000, edgeCount: 99_999, maxDepth: 6 });
    expect(ms).toBeLessThan(2000);
  });
});
