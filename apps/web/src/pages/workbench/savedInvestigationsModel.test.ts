import { describe, expect, it } from "vitest";

import { canOpenCase, parseProjection, type OpenedCase } from "./savedInvestigationsModel";
import type { CaseSummary } from "@workspace/api-client-react";

/**
 * P3-015 red-first: the saved-investigations model — «فتح قضية بعد إعادة
 * التشغيل». The workbench keeps NO browser storage (D-033): after a restart
 * the case is re-opened from the server, and the graph the workbench renders
 * is the case's own projection snapshot fetched over the API — never a browser
 * rebuild. The model below is fail-closed: a malformed projection response is
 * an honest error, never a fabricated empty case.
 */

const ACTIVE: CaseSummary = {
  id: "01M58XF9ZKJT50S8E8JYXF6P3X",
  title: "شبكة تجارة إلكترونية مشبوهة",
  purpose: "تتبع شبكة شركات لتحقيق صحفي موثق الغرض",
  legalBasis: "journalism",
  createdAt: "2026-10-10T12:00:00.000Z",
  archivedAt: null,
  sensitivity: "standard",
  tags: [],
  encrypted: false,
  status: "active",
  lastActivityAt: "2026-10-11T12:00:00.000Z",
};

const LOCKED: CaseSummary = {
  ...ACTIVE,
  id: "01M58XF9ZKJT50S8E8JYXF6P3YB",
  title: null,
  purpose: null,
  legalBasis: null,
  sensitivity: null,
  tags: null,
  encrypted: true,
  status: "locked-encrypted",
};

describe("canOpenCase (P3-015 — which saved cases are openable)", () => {
  it("an active case is openable into the workbench", () => {
    expect(canOpenCase(ACTIVE)).toBe(true);
  });

  it("a locked case (J-17) is not openable — no silent filtering, the row itself says locked", () => {
    expect(canOpenCase(LOCKED)).toBe(false);
  });
});

describe("parseProjection (P3-015 — fail-closed parse of the served snapshot)", () => {
  const node = {
    id: "n1",
    type: "domain",
    canonicalKey: "domain:example.com",
    labels: { ar: "example.com" },
    props: {},
    aliases: [],
    attributes: [],
    observations: { positive: 0, negative: 0, error: 0 },
    evidenceIds: [],
  };
  const edge = {
    id: "e1",
    source: "n1",
    target: "n2",
    predicate: "dns.a",
    confidence: 0.9,
    validFrom: null,
    validTo: null,
    explanation: "A record",
    evidenceIds: ["ev1"],
  };
  const SNAPSHOT = {
    seq: 4,
    graph: { nodes: [node, { ...node, id: "n2", type: "ipv4" }], edges: [edge] },
    table: [],
    coverage: {},
    networkLog: {},
    counts: { entities: 2, nodes: 2, claims: 1, edges: 1, observations: 1, evidence: 1, merges: 0, notes: 0 },
    sha256: "a".repeat(64),
  };

  it("accepts the served snapshot and returns the case's own graph — the graph the workbench renders", () => {
    const opened = parseProjection(SNAPSHOT as unknown as Record<string, unknown>);
    expect(opened).not.toBeNull();
    expect((opened as OpenedCase).graph.nodes).toHaveLength(2);
    expect((opened as OpenedCase).graph.edges).toHaveLength(1);
    expect((opened as OpenedCase).seq).toBe(4);
  });

  it("rejects a body without graph nodes/edges arrays — never a fabricated empty case", () => {
    expect(parseProjection({ seq: 1, sha256: "b".repeat(64) })).toBeNull();
    expect(parseProjection({ ...SNAPSHOT, graph: { nodes: "no", edges: [] } })).toBeNull();
  });

  it("rejects a body without a number seq or a 64-hex sha256 — the identity of the opened case is displayed, so it must be real", () => {
    expect(parseProjection({ ...SNAPSHOT, seq: "4" })).toBeNull();
    expect(parseProjection({ ...SNAPSHOT, sha256: "short" })).toBeNull();
    expect(parseProjection({ ...SNAPSHOT, sha256: 42 })).toBeNull();
  });

  it("rejects a non-object body outright", () => {
    expect(parseProjection(null)).toBeNull();
    expect(parseProjection("nope")).toBeNull();
  });

  // P4-010/UC-21 red first: the served projection carries the coverage map
  // (cells/transforms/untouched — P2-017), and "every empty transform shows"
  // starts with the parser not dropping it. A transform whose only result is
  // negative ("searched, found nothing" — D3) is coverage, never untouched.
  it("keeps the served coverage — a transform whose only result is negative is carried, not dropped", () => {
    const coverage = {
      cells: [
        {
          entityId: "n1",
          transformId: "tr-dns",
          positive: 0,
          negative: 1,
          error: 0,
          last: "negative",
          lastAt: "2026-10-10T08:00:00.000Z",
        },
      ],
      transforms: ["tr-dns"],
      untouched: ["n2"],
    };
    const opened = parseProjection({ ...SNAPSHOT, coverage } as unknown as Record<string, unknown>);
    expect(opened).not.toBeNull();
    expect((opened as OpenedCase & { coverage?: unknown }).coverage).toEqual(coverage);
  });

  // P4-010 strengthening (pass on this implementation — documented as coverage
  // strengthening, not red): the fail-closed contract around the coverage field.
  it("absent or corrupt coverage reads as null (unavailable) — never a fabricated empty map", () => {
    // absent (an older server): the case still opens, coverage honestly unavailable
    const noField = parseProjection({ ...SNAPSHOT, coverage: undefined } as unknown as Record<string, unknown>);
    expect(noField).not.toBeNull();
    expect((noField as OpenedCase).coverage).toBeNull();
    // corrupt cells: the whole field is rejected as one, never partially kept
    const badCells = parseProjection({
      ...SNAPSHOT,
      coverage: {
        cells: [{ entityId: "n1", transformId: "t", positive: 0, negative: 1, error: 0, last: "negative", lastAt: "x" }, { entityId: 42 }],
        transforms: ["t"],
        untouched: [],
      },
    } as unknown as Record<string, unknown>);
    expect(badCells).not.toBeNull();
    expect((badCells as OpenedCase).coverage).toBeNull();
    // non-integer/negative counts are rejected
    const badCount = parseProjection({
      ...SNAPSHOT,
      coverage: {
        cells: [{ entityId: "n1", transformId: "t", positive: -1, negative: 0, error: 0, last: "positive", lastAt: "x" }],
        transforms: ["t"],
        untouched: [],
      },
    } as unknown as Record<string, unknown>);
    expect(badCount).not.toBeNull();
    expect((badCount as OpenedCase).coverage).toBeNull();
  });

  it("a valid EMPTY coverage is a Coverage object — distinct from null (unavailable)", () => {
    const empty = parseProjection({
      ...SNAPSHOT,
      coverage: { cells: [], transforms: [], untouched: ["n1", "n2"] },
    } as unknown as Record<string, unknown>);
    expect(empty).not.toBeNull();
    const cov = (empty as OpenedCase).coverage;
    expect(cov).not.toBeNull();
    if (cov === null) throw new Error("unreachable");
    expect(cov.cells).toEqual([]);
    expect(cov.transforms).toEqual([]);
    expect(cov.untouched).toEqual(["n1", "n2"]);
  });
});
