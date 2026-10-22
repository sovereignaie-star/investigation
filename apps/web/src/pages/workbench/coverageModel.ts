import type { Coverage, CoverageCell, Graph, GraphNode, NotRunCell } from "@ir/ledger/projections";

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

/**
 * One never-run pair as the web shows it — the audit record plus its honest
 * classification. `policy` = the engine's own decision (source disabled on the
 * case, excluded by the operator, input refused — D3's «محظور بسياسة»);
 * `operational` = a stop outside anyone's policy (depth/budget/cancelled).
 */
export type BlockedCell = NotRunCell & { kind: "policy" | "operational" };

/**
 * Classifies a not_run record from its VERBATIM recorded reason — the reasons
 * are the engine's own strings (packages/cli/src/investigate.ts), matched
 * conservatively: anything unrecognized stays operational, never fabricated as
 * a policy decision it may not be.
 */
export function notRunKind(cell: NotRunCell): "policy" | "operational" {
  if (
    cell.reason.startsWith("disabled:") ||
    cell.reason.startsWith("excluded by the operator") ||
    cell.reason.startsWith("input refused")
  ) {
    return "policy";
  }
  return "operational";
}

/** One entity's row in the map: what ran on it, what was blocked, and what has no record. */
export interface CoverageRow {
  entityId: string;
  /** The node's label (ar ?? en ?? canonicalKey); a cell entity missing from the graph keeps its raw id. */
  label: string;
  type: string;
  /** No observation at all — nothing has been tried on this entity (D3). */
  untouched: boolean;
  /** Cells of the transforms that ran on this entity, sorted by transformId. */
  checked: CoverageCellView[];
  /** Never-run pairs recorded against this entity — «محظور بسياسة» from its proven record. */
  blocked: BlockedCell[];
  /** Transforms of the case's universe with NO record on this entity — «لا فحص مسجل». */
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
  const byKey = new Map(graph.nodes.map((n) => [n.canonicalKey, n] as const));
  const byEntity = new Map<string, CoverageCellView[]>();
  for (const c of coverage.cells) {
    const list = byEntity.get(c.entityId) ?? [];
    list.push(c);
    byEntity.set(c.entityId, list);
  }
  // P4-010: the not_run records — the audited key is the node's canonicalKey;
  // a record that matches no graph node becomes its own row (never hidden).
  const blockedByEntity = new Map<string, BlockedCell[]>();
  for (const record of coverage.notRun) {
    const node = byKey.get(record.key);
    const entityId = node ? node.id : record.key;
    const list = blockedByEntity.get(entityId) ?? [];
    list.push({ ...record, kind: notRunKind(record) });
    blockedByEntity.set(entityId, list);
  }
  const entityIds = [...new Set([...nodes.keys(), ...byEntity.keys(), ...blockedByEntity.keys()])].sort();
  const rows: CoverageRow[] = entityIds.map((entityId) => {
    const node = nodes.get(entityId);
    const checked = [...(byEntity.get(entityId) ?? [])].sort((a, b) =>
      a.transformId < b.transformId ? -1 : a.transformId > b.transformId ? 1 : 0,
    );
    const blocked = [...(blockedByEntity.get(entityId) ?? [])].sort((a, b) =>
      a.transformId < b.transformId ? -1 : a.transformId > b.transformId ? 1 : 0,
    );
    const recorded = new Set([...checked.map((c) => c.transformId), ...blocked.map((b) => b.transformId)]);
    return {
      entityId,
      label: node ? labelOf(node) : entityId,
      type: node ? node.type : "",
      // a recorded decision (blocked) is NOT "nothing has been tried yet"
      untouched: checked.length === 0 && blocked.length === 0,
      checked,
      blocked,
      unchecked: transforms.filter((t) => !recorded.has(t)),
    };
  });
  return { rows, transforms };
}
