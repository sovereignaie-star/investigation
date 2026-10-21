import type { Coverage, CoverageCell, Graph, GraphNode } from "@ir/ledger/projections";

/**
 * P4-010 (UC-21): the coverage map's pure model — «ما فُحص وما لم يُفحص».
 *
 * العقد (D3، P2-017): الخلية كيان×محوّل بعدّادات positive/negative/error وآخر
 * نوع وآخر وقت. «بحثنا ولم نجد» رصد سالب = تغطية (لا فراغ)، والخطأ ≠ الفراغ،
 * والكيان بلا أي رصد untouched. كون المحوّلات: كل محوّل أنتج خلية في قضية هذا
 * الإسقاط — والمحوّل ذو النتائج السالبة فقط يظهر دائماً (لا فلترة بعدد
 * النتائج الموجبة). التاريخ المختلط لا يُختزل: العدادات و`last` يعرضان منفصلين.
 * الرسم هنا هو رسم القضية الكامل من اللقطة نفسها — لا الرسم بعد إخفاء العقد؛
 * إخفاء عقدة عرضياً لا يمحو تغطيتها.
 */

/** One checked pair — the counts and the last result, separately (never collapsed). */
export type CoverageCellView = CoverageCell;

/** The honest state of one pair: what happened, without hiding any count. */
export type CellState = "with-results" | "no-results" | "failed" | "mixed";

/**
 * Classifies a cell for display. «فُحص بنتيجة» مقابل «فُحص بلا نتيجة» مقابل
 * «فشل» — والخلية التي تجمع فشلاً مع نتائج أو بحثاً فارغاً «مختلطة» لا تُسقط
 * أي عدّاد؛ «فشل» الصرفة هي التي لا تحمل سوى أخطاء.
 */
export function cellState(cell: CoverageCellView): CellState {
  const hasResults = cell.positive > 0;
  const hasEmpty = cell.negative > 0;
  const hasFailures = cell.error > 0;
  if (hasFailures && (hasResults || hasEmpty)) return "mixed";
  if (hasResults) return "with-results";
  if (hasFailures) return "failed";
  return "no-results";
}

/** One entity's row in the map: what ran on it, and what never did. */
export interface CoverageRow {
  entityId: string;
  /** The node's label (ar ?? en ?? canonicalKey); a cell entity missing from the graph keeps its raw id. */
  label: string;
  type: string;
  /** No observation at all — nothing has been tried on this entity (D3). */
  untouched: boolean;
  /** Cells of the transforms that ran on this entity, sorted by transformId. */
  checked: CoverageCellView[];
  /** Transforms of the case's universe that never ran on this entity — «لم يُفحص». */
  unchecked: string[];
}

/** The whole map: every case entity (deterministic order) and the case's transform universe. */
export interface CoverageMap {
  rows: CoverageRow[];
  /** Every transform that produced a cell anywhere in the case, sorted. */
  transforms: string[];
}

const labelOf = (n: GraphNode): string => n.labels.ar ?? n.labels.en ?? n.canonicalKey;

/**
 * Builds the coverage map from the case's own full graph and its coverage
 * projection. Pure and deterministic: entities sorted by id, cells sorted by
 * transformId, the transform universe sorted. Nothing is filtered by result
 * counts — a negative-only transform stays visible (the acceptance).
 */
export function buildCoverageRows(graph: Graph, coverage: Coverage): CoverageMap {
  const transforms = [...new Set(coverage.transforms)].sort();
  const nodes = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const byEntity = new Map<string, CoverageCellView[]>();
  for (const c of coverage.cells) {
    const list = byEntity.get(c.entityId) ?? [];
    list.push(c);
    byEntity.set(c.entityId, list);
  }
  const entityIds = [...new Set([...nodes.keys(), ...byEntity.keys()])].sort();
  const rows: CoverageRow[] = entityIds.map((entityId) => {
    const node = nodes.get(entityId);
    const checked = [...(byEntity.get(entityId) ?? [])].sort((a, b) =>
      a.transformId < b.transformId ? -1 : a.transformId > b.transformId ? 1 : 0,
    );
    const checkedTransforms = new Set(checked.map((c) => c.transformId));
    return {
      entityId,
      label: node ? labelOf(node) : entityId,
      type: node ? node.type : "",
      untouched: checked.length === 0,
      checked,
      unchecked: transforms.filter((t) => !checkedTransforms.has(t)),
    };
  });
  return { rows, transforms };
}
