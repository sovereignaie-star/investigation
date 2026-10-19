import type { GraphNode } from "@ir/ledger/projections";
import { describe, expect, it } from "vitest";

import { buildEntityRows, filterEntityRows, sortEntityRows, visibleWindow, type EntityRow, type SortSpec } from "./entityTableModel";

function node(over: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    type: "domain",
    canonicalKey: `domain:${over.id}`,
    labels: { ar: "نطاق" },
    props: {},
    aliases: [],
    attributes: [],
    observations: { positive: 0, negative: 0, error: 0 },
    evidenceIds: [],
    ...over,
  };
}

const NODES: GraphNode[] = [
  node({
    id: "b",
    type: "domain",
    canonicalKey: "domain:b.example",
    labels: { ar: "نطاق ب" },
    attributes: [{ claimId: "c1", predicate: "p", value: 1, confidence: 0.5, evidenceIds: ["e1", "e2"] }],
    observations: { positive: 3, negative: 1, error: 0 },
    evidenceIds: ["e1", "e2"],
  }),
  node({
    id: "a",
    type: "bitcoin_address",
    canonicalKey: "bitcoin_address:1AAA",
    labels: { ar: "عنوان" },
    observations: { positive: 1, negative: 0, error: 0 },
  }),
  node({ id: "c", type: "domain", canonicalKey: "domain:a.example", labels: { ar: "نطاق أ" } }),
];

describe("buildEntityRows (P3-009)", () => {
  it("maps nodes to rows with claims, evidence and observation counts", () => {
    const rows = buildEntityRows(NODES);
    const b = rows.find((r) => r.id === "b");
    expect(b).toMatchObject({
      type: "domain",
      label: "نطاق ب",
      canonicalKey: "domain:b.example",
      claims: 1,
      evidence: 2,
      positive: 3,
      negative: 1,
    });
  });

  it("falls back to the canonical key when no label exists", () => {
    const rows = buildEntityRows([node({ id: "x", labels: {} })]);
    expect(rows[0].label).toBe("domain:x");
  });

  it("applies the default sort: type asc then canonicalKey asc (deterministic)", () => {
    const rows = buildEntityRows(NODES);
    expect(rows.map((r) => r.id)).toEqual(["a", "c", "b"]);
    // "bitcoin_address" < "domain" lexicographically; then "domain:a.example" < "domain:b.example"
    expect(rows.map((r) => r.type)).toEqual(["bitcoin_address", "domain", "domain"]);
  });
});

describe("sortEntityRows (P3-009)", () => {
  it("sorts by the chosen column and direction with stable tie-breaks", () => {
    const rows = buildEntityRows(NODES);
    const byClaimsDesc: SortSpec = { key: "claims", dir: "desc" };
    expect(sortEntityRows(rows, byClaimsDesc).map((r) => r.id)).toEqual(["b", "a", "c"]);
    const byLabelAsc: SortSpec = { key: "label", dir: "asc" };
    expect(sortEntityRows(rows, byLabelAsc).map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("keeps equal keys in a deterministic order (id tie-break)", () => {
    const rows = buildEntityRows([node({ id: "z2" }), node({ id: "z1" })]);
    const sorted = sortEntityRows(rows, { key: "type", dir: "asc" });
    expect(sorted.map((r) => r.id)).toEqual(["z1", "z2"]);
  });
});

describe("filterEntityRows (P3-009)", () => {
  it("empty query returns all rows unchanged", () => {
    const rows = buildEntityRows(NODES);
    expect(filterEntityRows(rows, "")).toHaveLength(3);
    expect(filterEntityRows(rows, "   ")).toHaveLength(3);
  });

  it("matches case-insensitively across type, label and canonical key", () => {
    const rows = buildEntityRows(NODES);
    expect(filterEntityRows(rows, "نطاق").map((r) => r.id)).toEqual(["c", "b"]);
    expect(filterEntityRows(rows, "BITCOIN").map((r) => r.id)).toEqual(["a"]);
    expect(filterEntityRows(rows, "a.example").map((r) => r.id)).toEqual(["c"]);
    expect(filterEntityRows(rows, "لا-تطابق")).toEqual([]);
  });
});

describe("visibleWindow (P3-009 virtualization math)", () => {
  const args = { rowHeight: 36, viewportHeight: 360, overscan: 3 };

  it("at the top shows the first viewport plus overscan", () => {
    expect(visibleWindow({ ...args, scrollTop: 0, totalRows: 100000 })).toEqual({ start: 0, end: 12 });
  });

  it("scrolling down moves the window", () => {
    expect(visibleWindow({ ...args, scrollTop: 3600, totalRows: 100000 })).toEqual({ start: 97, end: 112 });
  });

  it("clamps to the last row near the end of the list", () => {
    const w = visibleWindow({ ...args, scrollTop: 10_000_000, totalRows: 100 });
    expect(w.end).toBe(99);
  });

  it("negative scrollTop is treated as 0", () => {
    expect(visibleWindow({ ...args, scrollTop: -50, totalRows: 1000 })).toEqual({ start: 0, end: 12 });
  });

  it("empty list yields an empty window", () => {
    expect(visibleWindow({ ...args, scrollTop: 0, totalRows: 0 })).toEqual({ start: 0, end: -1 });
  });

  it("a list shorter than the viewport shows everything", () => {
    expect(visibleWindow({ ...args, scrollTop: 0, totalRows: 5 })).toEqual({ start: 0, end: 4 });
  });

  it("100,000 rows: the window stays constant regardless of list length", () => {
    const small = visibleWindow({ ...args, scrollTop: 0, totalRows: 20 });
    const huge = visibleWindow({ ...args, scrollTop: 0, totalRows: 100_000 });
    expect(huge).toEqual(small === undefined ? huge : { start: 0, end: 12 });
  });
});

describe("100k rows smoke (P3-009 acceptance: 100,000 صف بلا تجمد)", () => {
  it("builds, filters and windows 100,000 rows quickly with a constant-size window", () => {
    const many: GraphNode[] = Array.from({ length: 100_000 }, (_, i) =>
      node({ id: `n${i}`, type: i % 10 === 0 ? "domain" : "ip", canonicalKey: `key:${String(i).padStart(6, "0")}` }),
    );
    const t0 = Date.now();
    const rows: EntityRow[] = buildEntityRows(many);
    expect(rows).toHaveLength(100_000);
    const filtered = filterEntityRows(rows, "domain");
    expect(filtered.length).toBe(10_000);
    const win = visibleWindow({ scrollTop: 3600, viewportHeight: 360, rowHeight: 36, totalRows: filtered.length, overscan: 3 });
    expect(win.end - win.start).toBeLessThanOrEqual(15);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(5000); // generous CI budget; local ~<300ms
  });
});
