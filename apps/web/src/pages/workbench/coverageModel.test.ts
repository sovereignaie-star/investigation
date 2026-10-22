import type { Coverage, CoverageCell, Graph, GraphNode, NotRunCell } from "@ir/ledger/projections";
import { describe, expect, it } from "vitest";

import { buildCoverageRows, cellState, notRunKind, type CoverageRow } from "./coverageModel";

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
      notRun: [],
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
      notRun: [],
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
      notRun: [],
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
      notRun: [],
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
      notRun: [],
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
      notRun: [],
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
      notRun: [],
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
      notRun: [],
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
    const coverage: Coverage = { cells: [], transforms: [], untouched: ["n1", "n2"], notRun: [] };
    const { rows } = buildCoverageRows(graphOf(node("n1"), node("n2")), coverage);
    expect(rows.map((r) => r.untouched)).toEqual([true, true]);
    expect(rows.every((r) => r.checked.length === 0 && r.unchecked.length === 0)).toBe(true);
  });

  // ---- P4-010 advisor round: not_run pairs — «محظور بسياسة» from its proven record

  const notRunOf = (over: Partial<NotRunCell> & { key: string; transformId: string }): NotRunCell => ({
    reason: "disabled: policy — source disabled on this case",
    at: T1,
    ...over,
  });

  it("a policy-blocked pair lands on its entity's row as its own state — never in the unchecked list", () => {
    // the audited key is the node's canonicalKey — the model resolves it to the entity
    const coverage: Coverage = {
      cells: [cell({ entityId: "n1", transformId: "tr-a", positive: 1 })],
      transforms: ["tr-a", "tr-disabled"],
      untouched: [],
      notRun: [notRunOf({ key: "domain:n1", transformId: "tr-disabled" })],
    };
    const { rows } = buildCoverageRows(graphOf(node("n1")), coverage);
    const r = rowFor(rows, "n1");
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0]).toMatchObject({
      transformId: "tr-disabled",
      reason: "disabled: policy — source disabled on this case",
      kind: "policy",
    });
    // the blocked pair is NOT listed as unchecked — a decision was recorded for it
    expect(r.unchecked).toEqual([]);
    // and it is not a checked cell either — nothing ran
    expect(r.checked.map((c) => c.transformId)).toEqual(["tr-a"]);
  });

  it("notRunKind classifies only what the engine actually says — an unrecognized reason is never guessed into a category", () => {
    // the producer's verified strings (packages/cli/src/investigate.ts):
    // policy = `disabled: ...` / `excluded by the operator (--exclude)`;
    // operational stops = `depth N > maxDepth N` / `budget: ...` / `cancelled`.
    // Everything else — input refused, setup refused, any future reason — is
    // NOT ours to classify: a neutral fallback, never a guessed category.
    expect(notRunKind(notRunOf({ key: "k", transformId: "t", reason: "disabled: no reason recorded" }))).toBe("policy");
    expect(notRunKind(notRunOf({ key: "k", transformId: "t", reason: "excluded by the operator (--exclude)" }))).toBe("policy");
    expect(notRunKind(notRunOf({ key: "k", transformId: "t", reason: "depth 3 > maxDepth 2" }))).toBe("operational");
    expect(notRunKind(notRunOf({ key: "k", transformId: "t", reason: "budget: requests" }))).toBe("operational");
    expect(notRunKind(notRunOf({ key: "k", transformId: "t", reason: "cancelled" }))).toBe("operational");
    // refused inputs are NOT the operator's policy and NOT a budget stop — the
    // engine's own words are shown verbatim, never asserted into a category
    expect(notRunKind(notRunOf({ key: "k", transformId: "t", reason: "input refused: unsupported value" }))).toBe("unclassified");
    expect(notRunKind(notRunOf({ key: "k", transformId: "t", reason: "setup refused: --network: TR-043 requires" }))).toBe("unclassified");
    // a reason the engine never said (a future string) — neutral, never guessed
    expect(notRunKind(notRunOf({ key: "k", transformId: "t", reason: "something the engine never said" }))).toBe("unclassified");
  });

  it("a transform known ONLY from its not_run record stays in the universe — the blocked decision is never invisible", () => {
    // a case where the only record of tr-disabled is a not_run decision: the
    // displayed universe must include it (count 1, not 0), the blocked entity
    // shows its recorded decision, and the other entity lists the transform
    // under «لا فحص مسجل» — dropping it would hide the decision from the map
    const coverage: Coverage = {
      cells: [],
      transforms: [],
      untouched: [],
      notRun: [notRunOf({ key: "domain:n1", transformId: "tr-disabled" })],
    };
    const { rows, transforms } = buildCoverageRows(graphOf(node("n1"), node("n2")), coverage);
    expect(transforms).toEqual(["tr-disabled"]);
    const r1 = rowFor(rows, "n1");
    expect(r1.blocked).toHaveLength(1);
    expect(r1.unchecked).toEqual([]);
    const r2 = rowFor(rows, "n2");
    expect(r2.unchecked).toEqual(["tr-disabled"]);
  });

  it("an entity whose only record is a not_run decision is NOT badged untouched — a decision was recorded against it", () => {
    const coverage: Coverage = {
      cells: [],
      transforms: [],
      untouched: ["n1"],
      notRun: [notRunOf({ key: "domain:n1", transformId: "tr-disabled" })],
    };
    const { rows } = buildCoverageRows(graphOf(node("n1")), coverage);
    const r = rowFor(rows, "n1");
    expect(r.untouched).toBe(false); // a decision exists — «لم يُفحص بعد» would be false for it
    expect(r.blocked).toHaveLength(1);
  });

  it("a not_run record whose key matches no graph node still appears — the record is never hidden", () => {
    const coverage: Coverage = {
      cells: [],
      transforms: [],
      untouched: [],
      notRun: [notRunOf({ key: "domain:ghost", transformId: "tr-x" })],
    };
    const { rows } = buildCoverageRows(graphOf(node("n1")), coverage);
    const ghost = rowFor(rows, "domain:ghost");
    expect(ghost.blocked).toHaveLength(1);
    expect(ghost.untouched).toBe(false);
  });
});
