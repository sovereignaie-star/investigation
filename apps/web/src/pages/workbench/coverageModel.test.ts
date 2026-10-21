import type { Coverage, CoverageCell, Graph, GraphNode } from "@ir/ledger/projections";
import { describe, expect, it } from "vitest";

import { buildCoverageRows, cellState, type CoverageRow } from "./coverageModel";

/**
 * P4-010 (UC-21): خريطة التغطية — معيار القبول: «ما فُحص وما لم يُفحص» و«كل
 * محوّل فارغ يظهر».
 *
 * العقد (D3، P2-017): الخلية كيان×محوّل بعدّادات positive/negative/error وآخر
 * نوع وآخر وقت. «بحثنا ولم نجد» رصد سالب = تغطية لا فراغ؛ الخطأ ≠ الفراغ؛
 * الكيان بلا أي رصد = untouched. الكون: محوّلات هذا الإسقاط (كل محوّل أنتج خلية
 * في القضية) — والمحوّل ذو النتائج السالبة فقط يظهر دائماً، لا يُفلتر بعدد
 * النتائج الموجبة. التاريخ المختلط لا يُختزل: العدادات و`last` معروضان منفصلين.
 * الرسم الكامل للقضية من اللقطة نفسها (لا الرسم بعد إخفاء العقد) — إخفاء عقدة
 * عرضياً لا يمحو تغطيتها.
 *
 * صادق الأدلة: كُتب هذا الملف قبل أي تنفيذ؛ التشغيل الأحمر الأول هيكلي
 * (الوحدة غير موجودة) وموثق كذلك في WORKLOG — الحاجة السلوكية يقودها معيار
 * UC-21 أعلاه.
 */

function node(id: string, type = "domain"): GraphNode {
  return {
    id,
    type,
    canonicalKey: `${type}:${id}`,
    labels: { ar: `عقدة ${id}` },
    props: {},
    aliases: [],
    attributes: [],
    observations: { positive: 0, negative: 0, error: 0 },
    evidenceIds: [],
  };
}

const T1 = "2026-10-10T08:00:00.000Z";
const T2 = "2026-10-11T08:00:00.000Z";

function cell(over: Partial<CoverageCell> & { entityId: string; transformId: string }): CoverageCell {
  return {
    positive: 0,
    negative: 0,
    error: 0,
    last: "positive",
    lastAt: T1,
    ...over,
  };
}

function graphOf(...nodes: GraphNode[]): Graph {
  return { nodes, edges: [] };
}

function rowFor(rows: CoverageRow[], entityId: string): CoverageRow {
  const row = rows.find((r) => r.entityId === entityId);
  if (row === undefined) throw new Error(`no row for ${entityId}`);
  return row;
}

describe("buildCoverageRows (P4-010 — «ما فُحص وما لم يُفحص»)", () => {
  it("a positive-only cell is checked with results — counts and last shown, never reduced", () => {
    const coverage: Coverage = {
      cells: [cell({ entityId: "n1", transformId: "tr-dns", positive: 2, last: "positive", lastAt: T2 })],
      transforms: ["tr-dns"],
      untouched: ["n2"],
    };
    const { rows, transforms } = buildCoverageRows(graphOf(node("n1"), node("n2")), coverage);
    expect(transforms).toEqual(["tr-dns"]);
    const r = rowFor(rows, "n1");
    expect(r.untouched).toBe(false);
    expect(r.checked).toHaveLength(1);
    expect(r.checked[0]).toMatchObject({ transformId: "tr-dns", positive: 2, negative: 0, error: 0, last: "positive", lastAt: T2 });
    expect(r.unchecked).toEqual([]);
  });

  it("THE ACCEPTANCE — a transform whose only result is negative is shown, never filtered by positive count", () => {
    const coverage: Coverage = {
      cells: [cell({ entityId: "n1", transformId: "tr-empty", negative: 3, last: "negative", lastAt: T1 })],
      transforms: ["tr-empty"],
      untouched: [],
    };
    const { rows, transforms } = buildCoverageRows(graphOf(node("n1")), coverage);
    // the transform stays in the universe and its cell stays on the row
    expect(transforms).toEqual(["tr-empty"]);
    const r = rowFor(rows, "n1");
    expect(r.checked).toHaveLength(1);
    expect(r.checked[0]).toMatchObject({ transformId: "tr-empty", positive: 0, negative: 3, last: "negative" });
    expect(r.unchecked).toEqual([]);
  });

  it("an error-only cell is a failed check — never mixed with emptiness", () => {
    const coverage: Coverage = {
      cells: [cell({ entityId: "n1", transformId: "tr-x", error: 1, last: "error", lastAt: T1 })],
      transforms: ["tr-x"],
      untouched: [],
    };
    const { rows } = buildCoverageRows(graphOf(node("n1")), coverage);
    expect(rowFor(rows, "n1").checked[0]).toMatchObject({ error: 1, last: "error" });
    expect(cellState(rowFor(rows, "n1").checked[0])).toBe("failed");
  });

  it("an entity with no observation at all is untouched — its row shows the whole transform universe as unchecked", () => {
    const coverage: Coverage = {
      cells: [cell({ entityId: "n1", transformId: "tr-a", positive: 1 })],
      transforms: ["tr-a", "tr-b"],
      untouched: ["n2"],
    };
    const { rows } = buildCoverageRows(graphOf(node("n1"), node("n2")), coverage);
    const r = rowFor(rows, "n2");
    expect(r.untouched).toBe(true);
    expect(r.checked).toEqual([]);
    // the unchecked transforms of an untouched entity are VISIBLE — «ما لم يُفحص»
    expect(r.unchecked).toEqual(["tr-a", "tr-b"]);
  });

  it("an entity×transform pair with no observation shows as unchecked on that entity's row", () => {
    const coverage: Coverage = {
      cells: [cell({ entityId: "n1", transformId: "tr-a", positive: 1 })],
      transforms: ["tr-a", "tr-b"],
      untouched: ["n2"],
    };
    const { rows } = buildCoverageRows(graphOf(node("n1"), node("n2")), coverage);
    // tr-b ran on the case (universe) but never on n1 — n1 must show it as unchecked
    expect(rowFor(rows, "n1").unchecked).toEqual(["tr-b"]);
  });

  it("a mixed-history cell keeps its counts separate from its last result — the history is not collapsed", () => {
    const coverage: Coverage = {
      cells: [
        // two positives then one error: counts stay (2, 0, 1), last = error at the later time
        cell({ entityId: "n1", transformId: "tr-m", positive: 2, error: 1, last: "error", lastAt: T2 }),
      ],
      transforms: ["tr-m"],
      untouched: [],
    };
    const { rows } = buildCoverageRows(graphOf(node("n1")), coverage);
    const c = rowFor(rows, "n1").checked[0];
    expect(c).toMatchObject({ positive: 2, negative: 0, error: 1, last: "error", lastAt: T2 });
    expect(cellState(c)).toBe("mixed");
  });

  it("deterministic ordering — entities by id, transforms sorted, cells by transformId", () => {
    const coverage: Coverage = {
      cells: [
        cell({ entityId: "n2", transformId: "tr-b", positive: 1 }),
        cell({ entityId: "n2", transformId: "tr-a", positive: 1 }),
        cell({ entityId: "n1", transformId: "tr-b", positive: 1 }),
      ],
      transforms: ["tr-b", "tr-a"],
      untouched: [],
    };
    const { rows, transforms } = buildCoverageRows(graphOf(node("n2"), node("n1")), coverage);
    expect(rows.map((r) => r.entityId)).toEqual(["n1", "n2"]);
    expect(transforms).toEqual(["tr-a", "tr-b"]);
    expect(rowFor(rows, "n2").checked.map((c) => c.transformId)).toEqual(["tr-a", "tr-b"]);
  });

  it("a cell whose entity is not in the graph still appears — checked entities are never hidden", () => {
    const coverage: Coverage = {
      cells: [cell({ entityId: "ghost", transformId: "tr-a", positive: 1 })],
      transforms: ["tr-a"],
      untouched: [],
    };
    const { rows } = buildCoverageRows(graphOf(node("n1")), coverage);
    const r = rowFor(rows, "ghost");
    expect(r.checked).toHaveLength(1);
    expect(r.label).toBe("ghost"); // no node → the honest raw id, never a fabricated label
  });

  it("cellState classifies honestly — no-results is not failed, with-results is not no-results", () => {
    expect(cellState(cell({ entityId: "x", transformId: "t", positive: 0, negative: 2, last: "negative" }))).toBe("no-results");
    expect(cellState(cell({ entityId: "x", transformId: "t", positive: 3, last: "positive" }))).toBe("with-results");
    expect(cellState(cell({ entityId: "x", transformId: "t", positive: 0, negative: 1, error: 2, last: "error" }))).toBe("mixed");
  });

  it("an empty coverage (valid, zero cells) yields untouched rows for every entity — distinct from unavailable", () => {
    const coverage: Coverage = { cells: [], transforms: [], untouched: ["n1", "n2"] };
    const { rows } = buildCoverageRows(graphOf(node("n1"), node("n2")), coverage);
    expect(rows.map((r) => r.untouched)).toEqual([true, true]);
    expect(rows.every((r) => r.checked.length === 0 && r.unchecked.length === 0)).toBe(true);
  });
});
